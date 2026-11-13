import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {createClient} from 'npm:@supabase/supabase-js@2.57.4'

const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}})
const clean=(v:unknown)=>String(v??'').trim()
const normalizeCode=(v:unknown)=>clean(v).toUpperCase()
const url='https://app.omie.com.br/api/v1/geral/produtos/'
const readCache=new Map<string,{at:number;value:unknown}>()
async function secret(name:string){
 const value=clean(Deno.env.get(name))
 if(value)return value
 const {data,error}=await admin.rpc('edge_get_integration_secret',{p_name:name})
 if(error||!data)throw new Error('Credenciais Omie não disponíveis.')
 return clean(data)
}
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
 if(request.method!=='POST')return respond({ok:false,error:'Método não permitido.'},405)
 const authorization=request.headers.get('Authorization')||''
 if(!authorization.startsWith('Bearer '))return respond({ok:false,error:'Sessão não autenticada.'},401)
 const {data:{user},error:authError}=await admin.auth.getUser(authorization.slice(7))
 if(authError||!user)return respond({ok:false,error:'Sessão inválida.'},401)
 const {data:profile}=await admin.from('profiles').select('perfil,ativo').eq('id',user.id).maybeSingle()
 if(!profile?.ativo||!['administrador','gestor','inspetor','consulta'].includes(profile.perfil))
  return respond({ok:false,error:'Sem permissão para consultar o cadastro.'},403)
 const body=await request.json().catch(()=>null)
 const codigo=normalizeCode(body?.codigo)
 if(!/^[A-Z0-9_.\/-]{1,60}$/.test(codigo))return respond({ok:false,error:'Informe um SKU válido.'},422)
 const cached=readCache.get(codigo)
 if(cached&&Date.now()-cached.at<120000)return respond(cached.value)
 try{
  const key=await secret('OMIE_APP_KEY'),appSecret=await secret('OMIE_APP_SECRET')
  if(!key||!appSecret)throw new Error('Credenciais Omie incompletas.')
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),16000)
  let reply:Response
  try{
   reply=await fetch(url,{method:'POST',signal:controller.signal,
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({call:'ConsultarProduto',param:[{codigo}],app_key:key,app_secret:appSecret})})
  }finally{clearTimeout(timer)}
  const product=await reply.json().catch(()=>null)
  if(!reply.ok||!product||product.faultcode||product.faultstring){
   const code=clean(product?.faultcode).toLowerCase()
   const reason=clean(product?.faultstring).toLowerCase()
   const notFound=/n.o encontrado|inexistente|not found|produto n.o existe|n.o localizado/.test(reason)
    ||/not.?found|nao.?encontrado/i.test(code)
   const result={ok:true,skuInformado:codigo,situacao:notFound?'nao_localizado':'indisponivel',
    codigoOmie:null,descricaoOmie:null}
   if(notFound)readCache.set(codigo,{at:Date.now(),value:result})
   return respond(result)
  }
  const real=normalizeCode(product.codigo)
  if(!real||!Number.isFinite(Number(product.codigo_produto))||Number(product.codigo_produto)<=0)
   return respond({ok:true,skuInformado:codigo,situacao:'indisponivel',codigoOmie:null,descricaoOmie:null})
  const result={ok:true,skuInformado:codigo,situacao:real===codigo?'encontrado':'codigo_divergente',
   codigoOmie:real,descricaoOmie:clean(product.descricao)||null}
  if(readCache.size>350)readCache.clear()
  readCache.set(codigo,{at:Date.now(),value:result})
  return respond(result)
 }catch(e){
  console.warn('Inventory SKU lookup unavailable',codigo,e instanceof Error?e.name:'unknown')
  return respond({ok:true,skuInformado:codigo,situacao:'indisponivel',
   codigoOmie:null,descricaoOmie:null})
 }
})
