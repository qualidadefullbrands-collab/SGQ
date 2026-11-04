import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const edge=source('supabase/functions/sgq-conclusao/index.ts')
const app=source('src/App.tsx')
const css=source('src/styles.css')

function runtime(fetchImpl,model='gemini-2.5-flash'){
 let handler
 const Deno={
  env:{get:name=>name==='GEMINI_API_KEY'?'test-key':name==='GEMINI_MODEL'?model:'test-config'},
  serve:callback=>{handler=callback}
 }
 const transpiled=ts.transpileModule(edge,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
  .outputText.replace(/^import .*;\s*$/gm,'')
 const script=new Function('Deno','createClient','fetch','AbortSignal',
  transpiled+'\nreturn {generate,publicError}')
 const controls=script(Deno,()=>({rpc:async()=>({data:null,error:null})}),fetchImpl,AbortSignal)
 return {...controls,handler}
}
test('Gemini 2.5 has an adequate response budget with zero thinking tokens',async()=>{
 let body
 const {generate}=runtime(async(_url,options)=>{
  body=JSON.parse(options.body)
  return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'Inspeção realizada conforme registros disponíveis.'}]}}]})}
 })
 const result=await generate('test-key','gemini-2.5-flash','Dados')
 assert.match(result.text,/Inspeção realizada/)
 assert.equal(body.generationConfig.maxOutputTokens,1536)
 assert.equal(body.generationConfig.thinkingConfig.thinkingBudget,0)
})
test('Gemini 3.5 Flash Lite uses minimal thinking and ignores invisible thought parts',async()=>{
 let body
 const {generate}=runtime(async(_url,options)=>{
  body=JSON.parse(options.body)
  return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[
    {thought:true,text:'private internal reasoning'},
    {text:'Conclusão técnica disponível para revisão.'}
  ]}}]})}
 })
 const result=await generate('test-key','gemini-3.5-flash-lite','Dados')
 assert.equal(result.text,'Conclusão técnica disponível para revisão.')
 assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'minimal')
})
test('Gemini model 404 retries once with supported alternate model',async()=>{
 const models=[]
 const {handler}=runtime(async(url)=>{
  const model=String(url).match(/models\/([^:]+):generateContent/)?.[1]
  models.push(model)
  if(models.length===1)return {ok:false,status:404,json:async()=>({error:{status:'NOT_FOUND'}})}
  return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'Texto corrigido.'}]}}]})}
 })
 const res=await handler(new Request('https://example.test',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({numeroFst:'FST26169-A'})}))
 const json=await res.json()
 assert.deepEqual(models,['gemini-2.5-flash','gemini-3.5-flash-lite'])
 assert.equal(json.text,'Texto corrigido.')
})
test('quota, auth and empty AI output are explicit, not misleading 200 responses',async()=>{
 const failures=[
  [429,'RESOURCE_EXHAUSTED','ai_provider_quota'],
  [403,'PERMISSION_DENIED','ai_provider_auth'],
  [404,'NOT_FOUND','ai_model_unavailable']
 ]
 const {publicError}=runtime(async()=>({}))
 for(const [status,code,expected] of failures)assert.equal(publicError(status,code).error,expected)
 assert.match(edge,/ai_empty_response/)
 assert.match(edge,/return answer\(failure,503\)/)
 assert.doesNotMatch(edge,/console\.(?:log|error)\([^\n]*apiKey/)
})
test('desktop always shows a labeled editor and Save legend button for each authorized photo',()=>{
 assert.match(app,/<label htmlFor=\{'sgq-caption-'\+p\.id\}>Editar legenda<\/label>/)
 assert.match(app,/Salvar legenda/)
 assert.match(app,/value=\{photoCaptionDrafts\[p\.id\]\?\?p\.legenda\?\?''\}/)
 assert.match(app,/setLastSavedPhotoCaptionId\(photoId\)/)
 assert.match(css,/\.photo-gallery \.sgq-saved-photo-caption/)
 assert.match(app,/setAiConclusionError\(/)
 assert.match(app,/aiConclusionError&&<p/)
})
