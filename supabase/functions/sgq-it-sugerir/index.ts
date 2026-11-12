import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Content-Type":"application/json"};
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
async function secret(name:string){const found=Deno.env.get(name);if(found)return found;const {data}=await admin.rpc("edge_get_integration_secret",{p_name:name});return data?String(data):null}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return response({error:"method"},405);
 const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 const {data:{user}}=await admin.auth.getUser(jwt);
 if(!user)return response({error:"unauthorized"},401);
 try{
  const input=await req.json();
  const contextoAdicional=String(input?.contextoAdicional||"").trim().slice(0,1600);
  const products=(Array.isArray(input.products)?input.products:[]).slice(0,15).map((p:any)=>({codigo:String(p.codigo||"").slice(0,70),descricao:String(p.descricao||"").slice(0,220)}));
  const its=(Array.isArray(input.its)?input.its:[]).slice(0,40).filter((x:any)=>x.id&&x.titulo).map((x:any)=>({id:String(x.id),codigo:String(x.codigo||"").slice(0,50),titulo:String(x.titulo).slice(0,220)}));
  if(!products.length||!its.length)return response({id:null,motivo:"Insira os produtos e aguarde o carregamento das ITs."});
  const key=await secret("GEMINI_API_KEY"),model=await secret("GEMINI_MODEL")||"gemini-2.5-flash";
  if(!key)return response({id:null,motivo:"IA não configurada."});
  const prompt="Você seleciona a IT de inspeção mais apropriada para os produtos de embalagem informados. Considere o contexto complementar como nota não verificada e não como autorização para inventar requisito. Se houver ambiguidade ou nenhuma IT correspondente, escolha null. Não invente nenhum código ou ID. Responda estritamente JSON {id: UUID da lista ou null, motivo: frase curta, confianca: número 0 a 1}. \n"+JSON.stringify({products,its,contextoAdicional});
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const result=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:350,responseMimeType:"application/json"}})});
  if(!result.ok)return response({id:null,motivo:"Serviço de sugestão temporariamente indisponível."});
  const output=await result.json();
  const raw=output?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("")||"{}";
  let parsed:any;try{parsed=JSON.parse(raw)}catch{return response({id:null,motivo:"Resposta não validada."})}
  const match=its.find((i:any)=>i.id===parsed?.id),confidence=Number(parsed?.confianca||0);
  return response({id:match&&confidence>=0.7?match.id:null,motivo:String(parsed?.motivo||"").slice(0,230),confianca:confidence});
 }catch(e){console.error("sgq-it-sugerir error",String(e));return response({id:null,motivo:"Falha na sugestão de IT."})}
});
