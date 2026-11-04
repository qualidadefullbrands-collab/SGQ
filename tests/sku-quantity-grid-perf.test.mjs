import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=file('src/App.tsx')
const api=file('backend/Sgq.Api/Program.cs')
const grid=file('src/components/SkuQuantityGrid.tsx')
const css=file('src/components/SkuQuantityGrid.css')
const word=file('server/docx_generator.py')
function segment(s,first,last){
 const start=s.indexOf(first),end=s.indexOf(last,start+first.length)
 assert.ok(start>=0&&end>start,first+' / '+last)
 return s.slice(start,end)
}
test('quantity edits are handled without Omie/catalog lookups and parallelism is bounded',()=>{
 const route=segment(api,'app.MapPut("/api/inspecoes/{id}/quantidades"','app.MapPut("/api/inspecoes/{id}/dados"')
 assert.match(route,/await CurrentUserId\(client,token\)/)
 assert.match(route,/grupo_inspecao_itens/)
 assert.match(route,/allowed\.Contains/)
 assert.match(route,/SemaphoreSlim\(4\)/)
 assert.match(route,/Task\.WhenAll\(items\.Select/)
 assert.match(route,/NormalizeComponentDistribution/)
 assert.match(route,/SamplingPlan/)
 assert.doesNotMatch(route,/Omie|ConsultarPedido|ListarPedidos/)
 assert.doesNotMatch(route,/HttpMethod\.Patch,"produtos"/)
})
test('editing saves without leaving screen or synchronous detail reload',()=>{
 const save=segment(app,'async function saveEditingInspectionData()','async function suggestApplicableIt')
 assert.match(save,/fastPath\?'\/quantidades'/) // concatenate the path only for numerical edits
 assert.match(save,/setEditSaving\(true\)/)
 assert.match(save,/setDetail\(/)
 assert.match(save,/setMessage\(fastPath/)
 assert.doesNotMatch(save,/setTab\(/)
 assert.doesNotMatch(save,/setEditingInspectionData\(null\)/)
 assert.doesNotMatch(save,/await openInspection\(/)
 const edit=segment(app,'async function editInspectionFull','function editProcessFull')
 assert.match(edit,/setEditingInspectionData\(form\)/)
 assert.doesNotMatch(edit,/setTab\('nova'\)/)
})
test('grid shows all SKUs with per-row warehouse and lot values',()=>{
 for(const key of ['sku','nome','lote','material','capacidade','quantidade','caixasRecebidas','caixasInspecionadas',
  'caixasPadrao','unidadesPadrao','caixasFracionadas','unidadesFracionadas','unidadesLaboratorio','unidadesPorConjunto'])
  assert.match(grid,new RegExp(key))
 assert.match(grid,/rows\.map\(/)
 assert.match(grid,/data-mismatch=/)
 assert.match(css,/overflow-x:auto/)
 assert.match(css,/position:sticky/)
 assert.doesNotMatch(grid,/codigoCliente|Código do cliente/)
})
test('client code in templates is mapped to SKU with no duplicate frontend field',()=>{
 assert.match(word,/"código do cliente": "\\n"\.join\(all_skus\)/)
 assert.doesNotMatch(app,/codigoCliente|Código do cliente/)
 assert.match(api,/codigo_cliente=string\.IsNullOrWhiteSpace\(item\.Sku\)\?null:item\.Sku\.Trim\(\)/)
})
test('desktop caption edits remain enabled on completed inspections with server authorization',()=>{
 const save=segment(api,'app.MapPut("/api/inspecoes/{id}/fotos/{photoId}/legenda"','app.MapPost("/api/inspecoes/{id}/laudo"')
 assert.match(save,/administrador/)
 assert.match(save,/gestor/)
 assert.match(save,/inspetor/)
 assert.match(save,/status"\)\.GetString\(\) is "cancelada"/)
 assert.match(app,/canWrite&&detail\.status!=='cancelada'/)
 assert.match(app,/savePhotoCaption\(p\.id,p\.legenda\|\|''\)/)
})
