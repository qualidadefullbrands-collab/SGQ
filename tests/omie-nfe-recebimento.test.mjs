import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const edge=read('supabase/functions/sgq-omie-fst/index.ts')
const app=read('src/App.tsx')
const start=edge.indexOf('function receiptsForProject(')
const end=edge.indexOf('async function lookupIncomingNfe(',start)
assert.ok(start>=0&&end>start)
const compiled=ts.transpileModule(edge.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const receiptsForProject=new Function(compiled+'\nreturn receiptsForProject')()

function entry(project,number,extra={}){
 return {
  cabec:{cNumeroNFe:number,cSerieNFe:'1',cChaveNfe:'1'.repeat(44),nIdReceb:410},
  infoAdicionais:{nIdProjeto:project},
  infoCadastro:{cCancelada:'N',cDenegado:'N',cDevolvido:'N',cDevolvidoParc:'N'},
  ...extra
 }
}
test('incoming NF belongs to exact FST project, not a similar FST or same SKU',()=>{
 const projectA=2929789459,projectB=2929792133
 const a=entry(projectA,'000001151')
 const b=entry(projectB,'000001152',{cabec:{...entry(projectB,'000001152').cabec,cChaveNfe:'2'.repeat(44),nIdReceb:411}})
 assert.deepEqual(receiptsForProject([a,b],projectA).map(x=>x.numero),['1151'])
 assert.deepEqual(receiptsForProject([a,b],projectB).map(x=>x.numero),['1152'])
 assert.deepEqual(receiptsForProject([a,b],123),[])
})
test('canceled/denied/returned NF-e never populates the SGQ',()=>{
 const active=entry(2929789459,'000000102')
 for(const field of ['cCancelada','cDenegado','cDevolvido','cDevolvidoParc']){
  const cancelled={...active,infoCadastro:{...active.infoCadastro,[field]:'S'}}
  assert.deepEqual(receiptsForProject([cancelled],2929789459),[])
 }
})
test('unlinked receipts do not get assigned to an FST',()=>{
 const loose=entry(0,'000001151',{infoAdicionais:{}})
 assert.deepEqual(receiptsForProject([loose],2929789459),[])
})
test('receipt API uses Omie ListarRecebimentos and checks all queried pages before choosing',()=>{
 assert.match(edge,/const receiptsUrl="https:\/\/app\.omie\.com\.br\/api\/v1\/produtos\/recebimentonfe\/"/)
 assert.match(edge,/omie\(receiptsUrl,"ListarRecebimentos"/)
 assert.match(edge,/cExibirDetalhes:"S"/)
 assert.match(edge,/Number\(row\?\.infoAdicionais\?\.nIdProjeto\)!==projectId/)
 assert.match(edge,/nTotalPaginas/)
 assert.match(edge,/receiptLimitPages=25/)
 assert.match(edge,/const result=!complete\?\{status:"incomplete",numeroNota:null\}/) // partial scans never auto-fill
 assert.match(edge,/modo==="nfe"/)
 assert.match(edge,/auth\.getUser\(jwt\)/)
 assert.doesNotMatch(edge,/process\.env|VITE_OMIE_APP_KEY/)
})
test('NF search is independently asynchronous and protects manually typed numbers',()=>{
 const start=app.indexOf('async function lookupFstNfe(')
 const end=app.indexOf('async function lookupFstClient(',start)
 assert.ok(start>0&&end>start)
 const fn=app.slice(start,end)
 assert.match(fn,/body:\{codigo:code,modo:'nfe'\}/)
 assert.match(fn,/if\(error\|\|lookupId!==fstNfeRequest\.current\)return/)
 assert.match(fn,/data\?\.status!=='matched'/)
 assert.match(fn,/fstCode\(current\.codigo\)!==code \|\| current\.notaFiscal\.trim\(\)/)
 assert.match(app,/void lookupFstNfe\(code,\+\+fstNfeRequest\.current\)/)
 assert.match(app,/autoNfeRef\.current=null;setInspection\(\{\.\.\.inspection,notaFiscal:e\.target\.value\}\)/)
 assert.match(app,/notaFiscal:clear\?'':current\.notaFiscal/)
})

test('NF lookup is independent from selecting a second Omie order',()=>{
 assert.match(app,/if\(!codigoPedido && Number\.isFinite\(Number\(data\.projectId\)\)/)
 assert.match(app,/void lookupFstNfe\(code,\+\+fstNfeRequest\.current\)/)
 assert.match(app,/fstNfeAttempt\.current\.get\(code\)/)
 assert.match(edge,/const receiptInFlight=new Map<number,Promise<any>>\(\)/)
 assert.match(edge,/if\(running\)return running/)
})

test('redundant review message and internal observation placeholder are absent',()=>{
 assert.doesNotMatch(app,/código\(s\) revisados do PV/)
 assert.doesNotMatch(app,/Quantidades atualizadas no formulário; clique em Salvar/)
 assert.doesNotMatch(app,/Ex\.: 60 un retiradas no laboratório para retenção; caixa fracionada com 16 un/)
 assert.match(app,/setSkuRows\(rows=>applyOmieReviewedRows\(rows,review\)\)/)
 assert.match(app,/setProcessLookupMessage\(''\)/)
})

test('Omie success is shared in flight and served from cache for duplicate calls',async()=>{
 const start=edge.indexOf('const omieReadCache=')
 const end=edge.indexOf('// Preserve the suffix:',start)
 assert.ok(start>0&&end>start)
 const code=ts.transpileModule(edge.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let calls=0
 const fakeFetch=async()=>{
   calls++
   await Promise.resolve()
   return {ok:true,json:async()=>({found:true,callCount:calls})}
 }
 const omie=new Function('fetch',code+'\nreturn omie')(fakeFetch)
 const args=['https://app.omie.com.br/api/v1/geral/projetos/','ListarProjetos',{nome_projeto:'FST26169-A'},'key','secret']
 const [first,second]=await Promise.all([omie(...args),omie(...args)])
 assert.equal(calls,1)
 assert.deepEqual(first,second)
 const third=await omie(...args)
 assert.equal(calls,1)
 assert.deepEqual(third,first)
 await omie(args[0],args[1],{nome_projeto:'FST26169-B'},args[3],args[4])
 assert.equal(calls,2)
})
