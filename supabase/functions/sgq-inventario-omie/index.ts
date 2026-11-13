import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {createClient} from 'npm:@supabase/supabase-js@2.57.4'

const supabaseUrl=Deno.env.get('SUPABASE_URL')||''
const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false}})
const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const sourceBucket='sgq-inventario-cego'
const catalogBucket='sgq-catalogo-omie'
const omieUrl='https://app.omie.com.br/api/v1/geral/produtos/'
const json=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...cors,'Content-Type':'application/json'}})
const clean=(value:unknown)=>String(value??'').trim()
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
function safeError(err:unknown){
 const message=err instanceof Error?err.message:clean(err)
 // Do not return integration credentials, raw HTTP responses or internal SQL details.
 if(/^Omie:|^Foto:|^Produto:|^A imagem|^Não foi possível/.test(message))return message.slice(0,350)
 return 'Não foi possível concluir a sincronização. A imagem permanece salva no SGQ.'
}
async function integrationSecret(name:string){
 const env=Deno.env.get(name)
 if(env)return env.trim()
 const {data,error}=await admin.rpc('edge_get_integration_secret',{p_name:name})
 if(error||!data)throw new Error('Não foi possível carregar as credenciais da integração Omie.')
 return clean(data)
}
async function omie(call:string,param:Record<string,unknown>,appKey:string,appSecret:string){
 const controller=new AbortController()
 const timeout=setTimeout(()=>controller.abort(),18000)
 try{
  const response=await fetch(omieUrl,{
   method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
   body:JSON.stringify({call,param:[param],app_key:appKey,app_secret:appSecret})
  })
  const value=await response.json().catch(()=>null)
  if(!response.ok||!value||value.faultcode||value.faultstring)
   throw new Error('Omie: operação de '+call+' recusada. Verifique a integração ou o cadastro do produto.')
  return value
 }finally{clearTimeout(timeout)}
}
type PhotoRow={
 id:string;inventario_id:string;codigo_omie:string;descricao_omie:string
 foto_storage_path:string|null;foto_para_omie:boolean
 foto_status:string;foto_omie_url:string|null
}
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
 if(request.method!=='POST')return json({ok:false,error:'Método não permitido.'},405)
 const bearer=request.headers.get('Authorization')||''
 const token=bearer.startsWith('Bearer ')?bearer.slice(7).trim():''
 if(!token)return json({ok:false,error:'Sessão não autorizada.'},401)
 const {data:{user},error:authError}=await admin.auth.getUser(token)
 if(authError||!user)return json({ok:false,error:'Sessão inválida.'},401)
 const {data:profile,error:profileError}=await admin.from('profiles')
  .select('perfil,ativo').eq('id',user.id).single()
 if(profileError||!profile?.ativo||!['administrador','gestor'].includes(profile.perfil))
  return json({ok:false,error:'Somente gestores podem aprovar a foto do Omie.'},403)
 const payload=await request.json().catch(()=>null)
 const itemId=clean(payload?.item_id)
 if(!uuid(itemId))return json({ok:false,error:'Identificação da contagem inválida.'},400)
 const {data:row,error:readError}=await admin.from('sgq_inventario_cego_itens')
  .select('id,inventario_id,codigo_omie,descricao_omie,foto_storage_path,foto_para_omie,foto_status,foto_omie_url')
  .eq('id',itemId).single()
 if(readError||!row)return json({ok:false,error:'Foto da contagem não encontrada.'},404)
 const item=row as PhotoRow
 if(item.foto_status==='sincronizada')return json({ok:true,already_synced:true,url:item.foto_omie_url})
 if(!item.foto_para_omie||!item.foto_storage_path)
  return json({ok:false,error:'Foto não marcada para atualização do catálogo.'},409)
 const {data:session,error:sessionError}=await admin.from('sgq_inventarios_cegos')
  .select('status').eq('id',item.inventario_id).single()
 if(sessionError||session?.status!=='fechado')
  return json({ok:false,error:'Conclua o inventário antes de publicar fotos no Omie.'},409)
 if(!item.codigo_omie||item.codigo_omie.length>60||/[\x00-\x1f]/.test(item.codigo_omie))
  return json({ok:false,error:'Código Omie inválido.'},422)

 // Acquire one-shot claim: concurrent approvals cannot write the same product twice.
 const {data:claimed,error:claimError}=await admin.from('sgq_inventario_cego_itens')
  .update({foto_status:'enviando',foto_omie_erro:null}).eq('id',item.id)
  .in('foto_status',['pendente','erro']).select('id').maybeSingle()
 if(claimError||!claimed)
  return json({ok:false,error:'A sincronização já foi iniciada. Atualize o inventário.'},409)

 let catalogUrl:string|null=null
 let oldImages:Array<{url_imagem:string}>=[]
 try{
  // The user supplies only the item ID. The image path and product code are read from
  // authenticated, audited SGQ records; no arbitrary URL can be injected by a client.
  const {data:image,error:downloadError}=await admin.storage.from(sourceBucket).download(item.foto_storage_path)
  if(downloadError||!image)throw new Error('Foto: arquivo original não localizado no SGQ.')
  const mime=image.type|| (item.foto_storage_path.endsWith('.png')?'image/png':'image/jpeg')
  if(!['image/jpeg','image/png'].includes(mime)||image.size>8*1024*1024)
   throw new Error('Foto: arquivo inválido para publicação.')
  const ext=mime==='image/png'?'png':'jpg'
  const publicPath='produtos/'+item.id+'.'+ext
  const {error:publishError}=await admin.storage.from(catalogBucket).upload(publicPath,image,{
   contentType:mime,upsert:true,cacheControl:'3600'
  })
  if(publishError)throw new Error('Foto: falha ao disponibilizar a imagem para o Omie.')
  catalogUrl=admin.storage.from(catalogBucket).getPublicUrl(publicPath).data.publicUrl
  const check=await fetch(catalogUrl,{method:'GET'})
  if(!check.ok)throw new Error('A imagem ainda não está acessível para o Omie.')
  await check.body?.cancel().catch(()=>undefined)

  const key=await integrationSecret('OMIE_APP_KEY')
  const secret=await integrationSecret('OMIE_APP_SECRET')
  if(!key||!secret)throw new Error('Omie: credenciais não configuradas.')
  const product=await omie('ConsultarProduto',{codigo:item.codigo_omie},key,secret)
  if(clean(product.codigo).toUpperCase()!==item.codigo_omie.toUpperCase())
   throw new Error('Produto: o Omie retornou um código diferente do solicitado.')
  const productId=Number(product.codigo_produto)
  if(!Number.isSafeInteger(productId)||productId<=0)
   throw new Error('Produto: código interno do Omie ausente na consulta.')
  if(!Array.isArray(product.imagens))
   throw new Error('Produto: o Omie não retornou a lista de imagens; alteração bloqueada para evitar exclusões.')

  oldImages=product.imagens
   .map((entry:unknown)=>({url_imagem:clean((entry as {url_imagem?:string})?.url_imagem)}))
   .filter((entry:{url_imagem:string})=>/^https:\/\//i.test(entry.url_imagem))
  // If six pictures already exist, replace the old cover while retaining
  // the remaining five; otherwise append the new cover and retain every old photo.
  const retained=oldImages.length>=6?oldImages.slice(1,6):oldImages
  const updatedImages=[
   {url_imagem:catalogUrl},
   ...retained.filter(x=>x.url_imagem!==catalogUrl).slice(0,5)
  ]
  // Keep identity and mandatory product fields unchanged. Only its gallery order changes.
  const change:Record<string,unknown>={
   codigo_produto:productId,codigo:product.codigo,descricao:product.descricao,
   unidade:product.unidade,ncm:product.ncm,imagens:updatedImages
  }
  if(clean(product.codigo_produto_integracao))
   change.codigo_produto_integracao=product.codigo_produto_integracao
  await omie('AlterarProduto',change,key,secret)
  const verified=await omie('ConsultarProduto',{codigo_produto:productId},key,secret)
  const images=Array.isArray(verified.imagens)?verified.imagens:[]
  const confirmed=images.some((x:unknown)=>clean((x as {url_imagem?:string})?.url_imagem)===catalogUrl)
  if(!confirmed)
   throw new Error('Omie: atualização enviada, mas a nova foto não foi confirmada na consulta. Verifique o produto antes de repetir.')

  const {error:saveError}=await admin.from('sgq_inventario_cego_itens').update({
   foto_status:'sincronizada',foto_omie_url:catalogUrl,fotos_omie_anteriores:oldImages,
   foto_omie_sincronizada_em:new Date().toISOString(),
   foto_omie_sincronizada_por:user.id,foto_omie_erro:null
  }).eq('id',item.id)
  if(saveError)throw new Error('Omie: foto atualizada, mas o registro de retorno no SGQ falhou. Verifique antes de repetir.')
  await admin.from('sgq_inventario_cego_foto_logs').insert({
   item_id:item.id,executado_por:user.id,status:'sincronizada',
   url_publicada:catalogUrl,imagens_anteriores:oldImages
  })
  return json({ok:true,url:catalogUrl,product:item.codigo_omie})
 }catch(error){
  const reason=safeError(error)
  await admin.from('sgq_inventario_cego_itens').update({
   foto_status:'erro',foto_omie_erro:reason
  }).eq('id',item.id)
  await admin.from('sgq_inventario_cego_foto_logs').insert({
   item_id:item.id,executado_por:user.id,status:'erro',
   url_publicada:catalogUrl,imagens_anteriores:oldImages,
   detalhe:reason
  })
  return json({ok:false,error:reason},502)
 }
})
