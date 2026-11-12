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
   : /^gemini-3\.(?:5|6)-flash/.test(model)
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

function conciseQualitySummary(ctx:Record<string,unknown>):string{
 const count=(value:unknown):number|null=>{
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?Math.round(n):null;
 };
 const sample=count(ctx.tamanhoAmostra);
 const inspected=count(ctx.totalInspecionado);
 const samplingComplete=ctx.amostragemConcluida===true;
 const checks=Array.isArray(ctx.checklist)?ctx.checklist as Record<string,unknown>[]:[];
 const dimensionals=Array.isArray(ctx.dimensionais)?ctx.dimensionais as Record<string,unknown>[]:[];
 const tests=Array.isArray(ctx.testes)?ctx.testes as Record<string,unknown>[]:[];
 const nc=count(ctx.naoConformes);
 const reportedNc=checks.filter(x=>x.resultado==="nao_conforme").length+
    tests.filter(x=>x.resultado==="nao_conforme").length+
    dimensionals.filter(x=>x.conforme===false).length;
 const hasNonconformance=reportedNc>0||(nc!==null&&nc>0);
 const decision=String(ctx.resultado??"").toLowerCase();
 const finished=decision==="aprovado"||decision==="reprovado";
 const ready=samplingComplete||ctx.checklistConcluido===true||
    ctx.dimensionaisConcluidos===true||ctx.testesConcluidos===true||
    (inspected!==null&&inspected>0)||checks.length>0||dimensionals.length>0||tests.length>0;
 const sentences:string[]=[];
 if(sample!==null&&sample>0)sentences.push("Tamanho da amostra - "+sample+".");
 if(decision==="aprovado"&&!hasNonconformance)
  sentences.push("Lote aprovado sem não conformidades.");
 else if(decision==="reprovado")
  sentences.push("Lote reprovado.");
 else if(hasNonconformance){
  if(nc!==null&&nc>0)
   sentences.push(nc===1?"Registrada 1 não conformidade.":"Registradas "+nc+" não conformidades.");
  else sentences.push("Há não conformidades nos registros de inspeção.");
 }else if(ready||finished)
  sentences.push("Lote inspecionado sem não conformidades registradas.");
 return sentences.join(" ");
}
function significantObservation(ctx:Record<string,unknown>):boolean{
 const arrays=[ctx.checklist,ctx.dimensionais,ctx.testes];
 return arrays.some(v=>Array.isArray(v)&&v.some(x=>
  typeof x?.observacao==="string"&&x.observacao.trim()!=="")) ||
   (typeof ctx.textoAtual==="string"&&ctx.textoAtual.trim().length>0) ||
   (typeof ctx.contextoAdicional==="string"&&ctx.contextoAdicional.trim().length>0);
}
function shortenComplement(raw:string,baseline:string):string{
 let text=raw.replace(/[*#]/g,"").replace(/\s+/g," ").trim();
 if(!text||/^SEM_COMPLEMENTO\b/i.test(text))return "";
 text=text.replace(/^Tamanho da amostra\s*[-–:]\s*\d+\.?\s*/i,"");
 text=text.replace(/^Lote (?:aprovado|reprovado|inspecionado)[^.]*\.\s*/i,"");
 if(text.toLowerCase()===baseline.toLowerCase())return "";
 return text.length>230?text.slice(0,227).replace(/\s+\S*$/,"")+"...":text;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return answer({error:"method_not_allowed",message:"Somente POST."},405);
 try{
  const context=await req.json();
  if(!context||typeof context!=="object"||Array.isArray(context))
   return answer({error:"ai_invalid_request",message:"Dados da inspeção inválidos."},400);
  const baseline=conciseQualitySummary(context as Record<string,unknown>);
  // No narrative evidence to analyze: produce the precise verified summary
  // without an unnecessary AI request or fabricated technical considerations.
  if(baseline&&!significantObservation(context as Record<string,unknown>))
   return answer({text:baseline,source:"indicadores"});
  const [key,modelSecret]=await Promise.all([secret("GEMINI_API_KEY"),secret("GEMINI_MODEL")]);
  if(!key){
   if(baseline)return answer({text:baseline,source:"indicadores"});
   return answer({error:"ai_not_configured",message:"GEMINI_API_KEY não configurada."},503);
  }
  const prompt=[
   "Você auxilia a Qualidade a completar uma conclusão técnica extremamente objetiva.",
   "Resumo obrigatório, já calculado a partir dos registros: "+(baseline||"Não há resumo de indicadores disponível."),
   "Escreva SOMENTE uma frase complementar curta, até 25 palavras, e APENAS se houver observação real, técnica e específica que não esteja no resumo.",
   "Se não existir achado técnico adicional, responda exatamente SEM_COMPLEMENTO.",
   "Nunca repita tamanho da amostra, número de NC ou conclusão sobre aprovação.",
   "Nunca afirme 'aprovado' ou 'reprovado' sem o resultado formal da inspeção.",
   "Contexto adicional é observação fornecida pelo inspetor e não substitui medição, desenho técnico nem comprovação; não invente evidências.",
   "Não invente fatos, medições, causas, riscos, produto ou cliente.",
   "Sem listas, saudação, siglas inventadas, recomendações genéricas ou justificativas.",
   "Dados de origem, para identificar apenas o complemento relevante:",
   JSON.stringify(context)
  ].join("\n");
  const primary=(modelSecret||"gemini-3.5-flash-lite").trim();
  // Keep the configured model if it works; recover when old or restricted model
  // names return 400/404 or spend the token budget without visible text.
  const models=[primary,...["gemini-3.5-flash-lite","gemini-3.6-flash"].filter(x=>x!==primary)].slice(0,2);
  let failure:Failure={error:"ai_provider_unavailable",message:"A geração da conclusão não está disponível."};
  for(let i=0;i<models.length;i++){
   const result=await generate(key,models[i],prompt);
   if(result.text){
    const supplement=shortenComplement(result.text,baseline);
    return answer({text:[baseline,supplement].filter(Boolean).join(" ").trim(),model:models[i]});
   }
   failure=result.failure??failure;
   if(!["ai_model_unavailable","ai_invalid_request","ai_empty_response"].includes(failure.error))break;
  }
  if(baseline)return answer({text:baseline,source:"indicadores"});
  return answer(failure,503);
 }catch(e){
  console.error("sgq-conclusao unexpected error",{name:e instanceof Error?e.name:"unknown"});
  return answer({error:"ai_provider_unavailable",message:"Erro ao processar a solicitação à IA."},503);
 }
});
