import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=read('src/App.tsx')
const api=read('backend/Sgq.Api/Program.cs')
const board=read('src/components/InspectionsKanban.tsx')

test('opening an inspection fetches only its summary and defers stage data',()=>{
 assert.match(app,/apiGet<any>\('\/api\/inspecoes\/\'\+id\+'\/resumo'\)/)
 assert.match(api,/MapGet\("\/api\/inspecoes\/\{id\}\/resumo"/)
 assert.match(api,/MapGet\("\/api\/inspecoes\/\{id\}\/etapa\/\{stage\}"/)
 assert.match(app,/async function loadInspectionStage\(stage:typeof activeStage\)/)
 assert.match(app,/detailStageRequests=useRef\(new Map/)
 assert.match(app,/if\(detail\?\.id===id\)/)
 assert.match(app,/Carregando checklist/)
 assert.match(app,/Carregando parâmetros dimensionais/)
 assert.match(app,/Carregando testes especiais/)
 assert.match(app,/Carregando fotos/)
 assert.doesNotMatch(app,/async function openInspection[\s\S]{0,250}apiGet<any>\('\/api\/inspecoes\/\'\+id\+'\/detalhe'\)/)
})

test('stage endpoint only queries the selected inspection section',()=>{
 const start=api.indexOf('app.MapGet("/api/inspecoes/{id}/etapa/{stage}"')
 const end=api.indexOf('app.MapGet("/api/inspecoes/{id}/detalhe"',start)
 assert.ok(start>=0&&end>start)
 const route=api.slice(start,end)
 for(const table of ['it_checklist','inspecao_checklist_resultados','it_parametros_dimensionais','inspecao_dimensionais','it_testes_especiais','inspecao_testes_resultados','inspecao_fotos','amostras'])
  assert.ok(route.includes('"'+table+'"'),table+' missing from lazy stage endpoint')
 assert.match(route,/switch\(stage\.ToLowerInvariant\(\)\)/)
})

test('startup defers catalogs, stock, equipment and Omie inbox until inspection screens need them',()=>{
 assert.match(app,/if\(tab==='quadro'\|\|tab==='inspecoes'\)void loadInspectionItems\(\)/)
 assert.match(app,/if\(tab==='nova'\|\|tab==='inspecoes'\)void loadCatalogs\(\)/)
 assert.match(app,/if\(tab==='inspecoes'\)void loadOmieInbox\(\)/)
 assert.doesNotMatch(app,/setInterval\(\(\)=>void loadOmieInbox/)
 assert.match(api,/MapGet\("\/api\/app\/inspection-items"/)
 assert.doesNotMatch(api.slice(api.indexOf('app.MapGet("/api/app/bootstrap"'),api.indexOf('app.MapGet("/api/app/catalogos"')),/itemLinksTask/)
})

test('kit versus independent SKUs requires an explicit decision and remembers exact confirmed kits',()=>{
 assert.match(app,/Como esses SKUs se relacionam\?/)
 assert.match(app,/Formam um mesmo kit/)
 assert.match(app,/São produtos independentes/)
 assert.match(app,/distinctSkuCount>1&&isComponentSet===null/)
 assert.match(app,/distinctSkuCount>1&&isComponentSet===false/)
 assert.match(app,/kitHistoryCount/)
 assert.match(app,/group\.type==='kit_componentes'/)
 assert.match(app,/ehConjunto:isComponentSet===true/)
 assert.match(api,/distinctSkuCount>1&&!input\.EhConjunto/)
 assert.match(api,/tipo = isComponentSet \? "kit_componentes" : "individual"/)
 assert.match(board,/Revisar SKUs/)
})

test('inspection-only shell has no links to stock, IT administration or equipment administration',()=>{
 const start=app.indexOf('<aside className="sgq-side-nav')
 const end=app.indexOf('</aside>',start)
 const nav=app.slice(start,end)
 for(const label of ['Estoque','Instruções técnicas','Equipamentos','Configurações','Painel','Insights'])assert.doesNotMatch(nav,new RegExp(label))
 assert.match(app,/inspectionTabs=\['quadro','inspecoes','nova','execucao','auditorias','fotos-mobile'\]/)
})
