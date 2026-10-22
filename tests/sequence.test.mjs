import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

// Regression contract for the SGQ domain: a kit is ONE inspection with many
// linked processo_itens. These tests read the real .NET/React implementation,
// not a parallel JS reimplementation of the rules.
const api=readFileSync(new URL('../backend/Sgq.Api/Program.cs',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
const styles=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8')
const section=(src,from,to)=>src.slice(src.indexOf(from),src.indexOf(to,src.indexOf(from)))

const creation=section(api,'app.MapPost("/api/inspecoes/criar"','app.MapPut("/api/inspecoes/{id}/dados"')
const starting=section(api,'app.MapPost("/api/inspecoes/{id}/iniciar"','app.MapGet("/api/amostragem/plano"')
const dimensionals=section(ui,'<section id="sec-dimensionais"','<section id="sec-testes"')
const processCards=section(ui,'<div className="inspection-sublist">','{!related.length')

test('a kit creates exactly one inspection row',()=>{
  assert.match(creation,/var isComponentSet = items\.Count > 1;/)
  assert.match(creation,/tipo = isComponentSet \? "kit_componentes" : "individual"/)
  assert.equal((creation.match(/HttpMethod\.Post, "inspecoes"/g)||[]).length,1)
  assert.equal((creation.match(/HttpMethod\.Post, "grupos_inspecao"/g)||[]).length,1)
})
test('all items link to the SAME inspection group',()=>{
  assert.match(creation,/foreach \(var item in items\)/)
  assert.match(creation,/grupo_inspecao_id = groupId,\s*processo_item_id = itemId/)
  assert.doesNotMatch(creation,/individualGroupId|sequentialCreated|sequentialBatch/)
})
test('sampling keeps kit quantity and combined box counts',()=>{
  assert.match(creation,/var statisticalLot = items\s*\.Select/)
  assert.match(creation,/items\.Sum\(x => x\.CaixasRecebidas\)/)
  assert.match(creation,/items\.Sum\(x => x\.CaixasInspecionadas\)/)
})
test('repeat submissions return existing single inspection',()=>{
  assert.match(creation,/request_id=requestId/)
  assert.match(creation,/replay=true/)
  assert.match(creation,/legacyBatch/)
})
test('starting a kit does not require finishing another SKU',()=>{
  assert.doesNotMatch(starting,/lote_sequencial|ordem_produto|Finalize primeiro o produto/)
  assert.match(starting,/status="em_andamento"/)
})
test('dimensional cards preserve item-specific identifiers and measurements',()=>{
  assert.match(dimensionals,/\(detail\.items \?\? \[\]\)\.map\(\(link:any,index:number\)/)
  assert.match(dimensionals,/id=\{'dim-item-'\+item\.id\}/)
  assert.match(dimensionals,/dimension-product-header/)
  assert.match(dimensionals,/dimension-product-overline/)
  assert.match(dimensionals,/getDimConfig\(item\.id,p\.id\)/)
  assert.match(dimensionals,/dimensionSummary\(item\.id,p\.id\)/)
})
test('visual separation is within one dimensionals stage',()=>{
  assert.match(styles,/\.dimension-item\{/)
  assert.match(styles,/\.dimension-product-header\{/)
  assert.match(ui,/Produtos do conjunto/)
  assert.doesNotMatch(ui,/Próximo produto/)
})
test('inspection cards do not block or multiply by sequence position',()=>{
  assert.doesNotMatch(processCards,/sequence\.blocked|sequentialProductInfo|Aguardando conclusão do produto/)
  assert.doesNotMatch(ui,/sequentialProductInfo|inspecoes\.length} produtos cadastrados em sequência/)
})
