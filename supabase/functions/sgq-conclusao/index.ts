import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const cors={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
 {auth:{persistSession:false}});
type Failure={error:string;message:string};
function answer(body:Record<string,unknown>,status=200){
 return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
}
async function secret(name:string):Promise<string|null>{
 const env=Deno.env.get(name);
 if(env)return env;
 const {data,error}=await admin.rpc("edge_get_integration_secret",{p_name:name});
 if(error)console.error("sgq-conclusao: secret lookup failed",{name,code:error.code});
 return data?String(data):null;
}
function publicError(status:number,providerCode:string):Failure{
 if(status===401||status===403||providerCode==="API_KEY_INVALID"||providerCode==="PERMISSION_DENIED")
  return {error:"ai_provider_auth",message:"A chave da IA não foi aceita pelo provedor."};
 if(status===429||providerCode==="RESOURCE_EXHAUSTED")
  return {error:"ai_provider_quota",message:"A cota do provedor de IA foi atingida."};
 if(status===404||providerCode==="NOT_FOUND")
  return {error:"ai_model_unavailable",message:"O modelo configurado não está disponível."};
 if(status===400||providerCode==="INVALID_ARGUMENT")
  return {error:"ai_invalid_request",message:"O provedor recusou os parâmetros da solicitação."};
 return {error:"ai_provider_unavailable",message:"O provedor de IA está temporariamente indisponível."};
}
type Attempt={text?:string;failure?:Failure;status?:number};
async function generate(apiKey:string,model:string,prompt:string):Promise<Attempt>{
 // Do not consume the response budget in silent thought tokens. Gemini 2.5 Flash
 // accepts thinkingBudget=0; Gemini 3.5/3.6 Flash accepts thinkingLevel=minimal.
 const generationConfig:Record<string,unknown>={
  maxOutputTokens:1536,
  ...(model.startsWith("gemini-2.5-flash")
   ? {thinkingConfig:{thinkingBudget:0},temperature:0.2}
   : model.startsWith("gemini-3.")&&!model.includes("-pro")
     ? {thinkingConfig:{thinkingLevel:"minimal"}}
     : {})
 };
 try{
  const response=await fetch(
   `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
   {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig}),
    signal:AbortSignal.timeout(25000)}
  );
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
   const code=String(body?.error?.status??"");
   console.error("sgq-conclusao Gemini failure",{model,http:response.status,code});
   return {failure:publicError(response.status,code),status:response.status};
  }
  const text=body?.candidates?.[0]?.content?.parts
    ?.filter((part:{thought?:boolean,text?:string})=>part?.thought!==true)
    ?.map((part:{text?:string})=>part.text??"").join("").trim()??"";
  if(text)return {text};
  console.warn("sgq-conclusao empty AI output",{
   model,finishReason:body?.candidates?.[0]?.finishReason??"unknown",
   thoughtsUsed:body?.usageMetadata?.thoughtsTokenCount??0
  });
  return {failure:{error:"ai_empty_response",message:"A IA não retornou texto utilizável."},status:200};
 }catch(e){
  console.error("sgq-conclusao request exception",{model,name:e instanceof Error?e.name:"unknown"});
  return {failure:{error:"ai_provider_unavailable",message:"Não foi possível conectar ao provedor de IA."}};
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return answer({error:"method_not_allowed",message:"Somente POST."},405);
 try{
  const context=await req.json();
  if(!context||typeof context!=="object"||Array.isArray(context))
   return answer({error:"ai_invalid_request",message:"Dados da inspeção inválidos."},400);
  const [key,modelSecret]=await Promise.all([secret("GEMINI_API_KEY"),secret("GEMINI_MODEL")]);
  if(!key)return answer({error:"ai_not_configured",message:"GEMINI_API_KEY não configurada."},503);
  const prompt=[
   "Você é um profissional de Qualidade responsável por sugerir conclusões de inspeções de produtos.",
   "Com base somente nos dados registrados, escreva um parágrafo técnico, natural e auditável em português brasileiro.",
   "Não invente medições, não conformidades, resultados de testes, datas nem quantidades.",
   "A ausência de um registro não equivale a resultado conforme nem a zero unidades inspecionadas.",
   "Se houver informações insuficientes, mencione que a avaliação ainda depende de complementação.",
   "Não afirme aprovação ou reprovação: essa decisão é exclusiva do responsável pela inspeção.",
   "Cite apenas as observações, amostragens, verificações, não conformidades, dimensionais e testes que constarem dos dados.",
   "Evite fórmulas mecânicas, plural entre parênteses, listas e repetir campos não relevantes.",
   "Retorne somente o texto da sugestão, sem títulos, aspas ou comentários adicionais.",
   "",
   JSON.stringify(context)
  ].join("\n");
  const primary=(modelSecret||"gemini-3.5-flash-lite").trim();
  // Keep the configured model if it works; recover when old or restricted model
  // names return 400/404 or spend the token budget without visible text.
  const models=[primary,...["gemini-3.5-flash-lite","gemini-3.6-flash"].filter(x=>x!==primary)].slice(0,2);
  let failure:Failure={error:"ai_provider_unavailable",message:"A geração da conclusão não está disponível."};
  for(let i=0;i<models.length;i++){
   const result=await generate(key,models[i],prompt);
   if(result.text)return answer({text:result.text,model:models[i]});
   failure=result.failure??failure;
   if(!["ai_model_unavailable","ai_invalid_request","ai_empty_response"].includes(failure.error))break;
  }
  return answer(failure,503);
 }catch(e){
  console.error("sgq-conclusao unexpected error",{name:e instanceof Error?e.name:"unknown"});
  return answer({error:"ai_provider_unavailable",message:"Erro ao processar a solicitação à IA."},503);
 }
});
