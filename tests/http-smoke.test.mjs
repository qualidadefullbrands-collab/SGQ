import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
const base=(process.env.SGQ_TEST_API_URL||'').replace(/\/$/,'')
const token=process.env.SGQ_TEST_AUTH_TOKEN||''
async function request(path,authorized=false){
  const started=performance.now()
  const res=await fetch(base+path,{headers:authorized?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(30000)})
  const text=await res.text()
  let data;try{data=JSON.parse(text)}catch{data=text}
  return {status:res.status,data,elapsedMs:Math.round(performance.now()-started)}
}
test('público: API saudável e tempo de resposta medido',{skip:!base},async()=>{
 const result=await request('/health')
 assert.equal(result.status,200,JSON.stringify(result))
 assert.equal(result.data.status,'ok')
 console.log('SGQ /health:',result.elapsedMs,'ms')
})
test('público: cálculo de amostragem não requer login',{skip:!base},async()=>{
 const result=await request('/api/amostragem/plano?lote=100&nivel=I')
 assert.equal(result.status,200)
 assert.ok(Number(result.data?.data?.amostra)>0)
 console.log('SGQ /api/amostragem/plano:',result.elapsedMs,'ms')
})
test('segurança: painel nunca entrega dados sem Bearer',{skip:!base},async()=>{
 const result=await request('/api/app/listas')
 assert.equal(result.status,401)
})
test('autenticado: painel e catálogos retornam sem erros',{skip:!base||!token},async()=>{
 for(const path of ['/api/app/bootstrap','/api/app/catalogos']){
   const result=await request(path,true)
   assert.equal(result.status,200,JSON.stringify(result.data))
   assert.ok(result.data?.data)
   console.log('SGQ '+path+':',result.elapsedMs,'ms')
 }
})
test('autenticado: consulta de detalhe existente',{skip:!base||!token||!process.env.SGQ_TEST_INSPECTION_ID},async()=>{
 const id=encodeURIComponent(process.env.SGQ_TEST_INSPECTION_ID)
 const result=await request('/api/inspecoes/'+id+'/detalhe',true)
 assert.equal(result.status,200,JSON.stringify(result.data))
 assert.ok(result.data?.data?.inspecao)
 console.log('SGQ detalhe:',result.elapsedMs,'ms')
})
