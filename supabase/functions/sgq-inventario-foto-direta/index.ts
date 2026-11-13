import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {imageIdentity,imagesOf,newlyImportedImage,matchesOmieUpdateTime} from './photoVerification.mjs'

const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const clean=(v:unknown)=>String(v??'').trim()
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const catalogBucket='sgq-catalogo-omie'
const sourceBucket='sgq-inventario-cego'
const productEndpoint='https://app.omie.com.br/api/v1/geral/produtos/'

type Photo={id:string;item_id:string;codigo_omie:string;storage_path:string;criado_por:string;status:string;omie_url:string|null}
type Item={id:string;codigo_omie:string;inventario_id:string;criado_por:string}

type ImageUrl={url_imagem:string}
// CDN identity and verification helpers are tested in photoVerification.mjs
const msg=(e:unknown)=>{
 const value=e instanceof Error?e.message:clean(e)
 return (/^(Omie:|Foto:|Produto:|O limite|Cadastro)/.test(value)?value:'Erro de sincronização. Foto preservada no SGQ.').slice(0,380)
}
async function secret(name:string){
 const env=Deno.env.get(name)
 if(env)return env.trim()
 const {data,error}=await admin.rpc('edge_get_integration_secret',{p_name:name})
 if(error||!data)throw new Error('Omie: credenciais indisponíveis.')
 return clean(data)
}
async function omie(call:string,param:Record<string,unknown>,key:string,secret:string){
 const ctrl=new AbortController()
 const timer=setTimeout(()=>ctrl.abort(),18000)
 try{
  const reply=await fetch(productEndpoint,{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},
   body:JSON.stringify({call,param:[param],app_key:key,app_secret:secret})})
  const body=await reply.json().catch(()=>null)
  if(!reply.ok||!body||body.faultcode||body.faultstring)
   throw new Error('Omie: operação '+call+' não concluída. Verifique o cadastro e tente novamente.')
  return body
 }finally{clearTimeout(timer)}
}
async function storeResult(photo:Photo,userId:string,omieUrl:string,previous:ImageUrl[],sourceUrl:string){
 const {data:updated,error}=await admin.from('sgq_inventario_cego_imagens').update({
  status:'sincronizada',omie_url:omieUrl,erro:null,sincronizada_em:new Date().toISOString(),atualizado_em:new Date().toISOString()
 }).eq('id',photo.id).eq('status','enviando').select('id').maybeSingle()
 if(error||!updated)throw new Error('Omie: imagem publicada, mas a confirmação local falhou. Confira antes de repetir.')
 await admin.from('sgq_inventario_cego_foto_logs').insert({
  item_id:photo.item_id,executado_por:userId,status:'sincronizada',
  url_publicada:sourceUrl,imagens_anteriores:previous,detalhe:'Foto '+photo.id+' confirmada no catálogo Omie (CDN) para o SKU '+photo.codigo_omie
 })
 return json({ok:true,sku:photo.codigo_omie,photoId:photo.id,url:omieUrl})
}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
 if(req.method!=='POST')return json({ok:false,error:'Método não permitido.'},405)
 const authHeader=req.headers.get('Authorization')||''
 const token=authHeader.startsWith('Bearer ')?authHeader.slice(7).trim():''
 if(!token)return json({ok:false,error:'Sessão não autenticada.'},401)
 const {data:{user},error:authError}=await admin.auth.getUser(token)
 if(authError||!user)return json({ok:false,error:'Sessão inválida.'},401)
 const {data:profile}=await admin.from('profiles').select('perfil,ativo').eq('id',user.id).maybeSingle()
 if(!profile?.ativo||!['administrador','gestor','inspetor'].includes(profile.perfil))
  return json({ok:false,error:'Sem permissão para sincronizar fotos.'},403)
 const payload=await req.json().catch(()=>null)
 const photoId=clean(payload?.foto_id)
 if(!uuid(photoId))return json({ok:false,error:'Identificação da foto inválida.'},400)
 const {data:record,error:readError}=await admin.from('sgq_inventario_cego_imagens')
  .select('id,item_id,codigo_omie,storage_path,criado_por,status,omie_url').eq('id',photoId).maybeSingle()
 if(readError||!record)return json({ok:false,error:'Foto não registrada no inventário.'},404)
 const photo=record as Photo
 if(photo.criado_por!==user.id&&!['administrador','gestor'].includes(profile.perfil))
  return json({ok:false,error:'A foto pertence a outro conferente.'},403)
 if(photo.status==='sincronizada')return json({ok:true,already_synced:true,url:photo.omie_url,sku:photo.codigo_omie})
 const {data:row}=await admin.from('sgq_inventario_cego_itens')
  .select('id,codigo_omie,inventario_id,criado_por').eq('id',photo.item_id).maybeSingle()
 const item=row as Item|null
 if(!item||item.codigo_omie!==photo.codigo_omie||item.criado_por!==photo.criado_por)
  return json({ok:false,error:'Foto não corresponde ao código do produto contado.'},409)
 const {data:session}=await admin.from('sgq_inventarios_cegos').select('status').eq('id',item.inventario_id).maybeSingle()
 if(!session||!['aberto','fechado'].includes(session.status))
  return json({ok:false,error:'Inventário indisponível para publicar fotos.'},409)
 if(!/^[-A-Z0-9_./]{1,60}$/i.test(item.codigo_omie))
  return json({ok:false,error:'Código do produto inválido para sincronização.'},422)
 if(!photo.storage_path.startsWith(photo.criado_por+'/'+item.inventario_id+'/'+item.id+'/'))
  return json({ok:false,error:'Foto com caminho inválido.'},409)

 // Atomic claim plus unique partial index prevents parallel photo updates to
 // the same SKU (even from different items/inventory sessions).
 const {data:claimed,error:claimError}=await admin.from('sgq_inventario_cego_imagens')
  .update({status:'enviando',erro:null,atualizado_em:new Date().toISOString()})
  .eq('id',photo.id).in('status',['pendente','erro']).select('id').maybeSingle()
 if(claimError||!claimed)
  return json({ok:false,error:'Já existe envio em andamento para esta foto ou produto. Atualize e tente novamente.'},409)

 let publicUrl:string|null=null
 let originals:{url_imagem:string}[]=[]
 try{
  const {data:image,error:downloadError}=await admin.storage.from(sourceBucket).download(photo.storage_path)
  if(downloadError||!image)throw new Error('Foto: não localizada no armazenamento privado.')
  const mime=image.type|| (photo.storage_path.endsWith('.png')?'image/png':'image/jpeg')
  if(!['image/png','image/jpeg'].includes(mime)||image.size<=0||image.size>8*1024*1024)
   throw new Error('Foto: arquivo inválido (JPG ou PNG até 8 MB).')
  const ext=mime==='image/png'?'png':'jpg'
  const path='produtos/inventario/'+photo.id+'.'+ext
  const {error:uploadError}=await admin.storage.from(catalogBucket).upload(path,image,{
   upsert:false,contentType:mime,cacheControl:'3600'
  })
  if(uploadError&&!/already exists|duplicate/i.test(clean(uploadError.message)))
   throw new Error('Foto: publicação temporária falhou.')
  publicUrl=admin.storage.from(catalogBucket).getPublicUrl(path).data.publicUrl
  const verifiedImage=await fetch(publicUrl,{method:'GET'})
  if(!verifiedImage.ok)throw new Error('Foto: a imagem não está acessível pelo Omie.')
  await verifiedImage.body?.cancel().catch(()=>undefined)

  const key=await secret('OMIE_APP_KEY'),secretValue=await secret('OMIE_APP_SECRET')
  if(!key||!secretValue)throw new Error('Omie: credenciais indisponíveis.')
  const product=await omie('ConsultarProduto',{codigo:item.codigo_omie},key,secretValue)
  if(clean(product.codigo).toUpperCase()!==item.codigo_omie.toUpperCase())
   throw new Error('Produto: Omie retornou um SKU diferente do conferido.')
  const id=Number(product.codigo_produto)
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Produto: ID do Omie indisponível.')
  if(!Array.isArray(product.imagens))
   throw new Error('Produto: lista de imagens não foi retornada pelo Omie.')
  originals=imagesOf(product)
  // A previous attempt may have succeeded in Omie but failed only because the
  // old verifier compared the source URL to Omie's rehosted CDN URL.
  // Reconcile its audited pre-write snapshot BEFORE calling AlterarProduto
  // again, so retry cannot duplicate a picture or replace earlier images.
  const {data:failures}=await admin.from('sgq_inventario_cego_foto_logs')
   .select('imagens_anteriores,url_publicada,criado_em')
   .eq('item_id',photo.item_id).eq('status','erro')
   .order('criado_em',{ascending:false}).limit(10)
  for(const log of failures||[]){
   if(clean(log.url_publicada)!==publicUrl||!Array.isArray(log.imagens_anteriores))continue
   const beforeImages=(log.imagens_anteriores as ImageUrl[])
    .filter(img=>/^https:\/\//i.test(clean(img.url_imagem)))
   const converted=newlyImportedImage(beforeImages,originals)
   if(converted&&matchesOmieUpdateTime(product,log.criado_em))
    return await storeResult(photo,user.id,converted,beforeImages,publicUrl)
  }
  // The Omie catalogue may contain the original public image URL for certain
  // products; this direct match remains a safe idempotent fast path.
  const previouslyPublished=originals.find(img=>imageIdentity(img.url_imagem)===imageIdentity(publicUrl))
  if(previouslyPublished)
   return await storeResult(photo,user.id,previouslyPublished.url_imagem,originals,publicUrl)

  // Each count contributes exactly one image. Never delete another Omie image
  // silently. At the six-image limit, preserve this evidence privately in SGQ
  // and report the limitation rather than replacing an unrelated product photo.
  const others=originals.filter(img=>img.url_imagem!==publicUrl)
  if(others.length>=6)
   throw new Error('O limite de seis fotos do Omie foi atingido. Foto preservada no SGQ; revise as imagens do produto antes de reenviar.')
  const gallery=others.length?[others[0],{url_imagem:publicUrl},...others.slice(1)]:
   [{url_imagem:publicUrl}]
  const change:Record<string,unknown>={
   codigo_produto:id,codigo:product.codigo,descricao:product.descricao,
   unidade:product.unidade,ncm:product.ncm,imagens:gallery
  }
  if(clean(product.codigo_produto_integracao))
   change.codigo_produto_integracao=product.codigo_produto_integracao
  await omie('AlterarProduto',change,key,secretValue)
  let confirmedUrl:string|null=null
  for(const delay of [0,900,1800]){
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay))
   const after=await omie('ConsultarProduto',{codigo_produto:id},key,secretValue)
   const verifiedImages=imagesOf(after)
   confirmedUrl=newlyImportedImage(originals,verifiedImages)
   if(confirmedUrl)break
  }
  if(!confirmedUrl)
   throw new Error('Omie: a atualização foi solicitada, mas a nova foto ainda não aparece na galeria do SKU. A imagem foi preservada no SGQ. Não repita a contagem.')
  return await storeResult(photo,user.id,confirmedUrl,originals,publicUrl)
 }catch(e){
  const reason=msg(e)
  await admin.from('sgq_inventario_cego_imagens').update({
   status:'erro',erro:reason,atualizado_em:new Date().toISOString()
  }).eq('id',photo.id)
  await admin.from('sgq_inventario_cego_foto_logs').insert({
   item_id:photo.item_id,executado_por:user.id,status:'erro',
   url_publicada:publicUrl,imagens_anteriores:originals,detalhe:reason
  })
  return json({ok:false,error:reason,sku:photo.codigo_omie,foto_id:photo.id},502)
 }
})
