import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=read('src/App.tsx')
const css=read('src/styles.css')
const snippet=app.slice(app.indexOf('const emptySku = () => ({'),app.indexOf('function fstCode('))
assert.ok(snippet.startsWith('const emptySku'),'Helper source must be found')
const compiled=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const {emptySku,prepareOmieSkuReview,validOmieSkuReview,applyOmieReviewedRows}=
  new Function(compiled+'\nreturn {emptySku,prepareOmieSkuReview,validOmieSkuReview,applyOmieReviewedRows}')()

const example={
 codigo:'26169-A',numeroPedido:'1038',
 itens:[
  {sku:'EMB277247003',descricao:'Embalagem Cushion - Anel Interior',quantidade:1000},
  {sku:'EMB277247002',descricao:'Embalagem Cushion - Recarga Interna',quantidade:1000},
  {sku:'EMB277247001',descricao:'Embalagem Cushion - Case Externa',quantidade:1000},
  {sku:'AC277247002',descricao:'Embalagem Cushion - Esponja Interna',quantidade:1000},
  {sku:'AC277247001',descricao:'Embalagem Cushion - Esponja Aplicadora',quantidade:1000},
 ]
}
test('FST review displays every Omie SKU and its ordered quantity before importing',()=>{
 const review=prepareOmieSkuReview(example,[emptySku()])
 assert.equal(review.codigo,'26169-A')
 assert.equal(review.numeroPedido,'1038')
 assert.equal(review.itens.length,5)
 assert.deepEqual(review.itens.map(x=>x.quantidadePedido),[1000,1000,1000,1000,1000])
 assert.equal(review.itens.reduce((sum,x)=>sum+Number(x.quantidadeInformada),0),5000)
 assert.equal(validOmieSkuReview(review),true)
})
test('corrected receipt totals are applied to all components as one state update',()=>{
 const review=prepareOmieSkuReview(example,[emptySku()])
 review.itens[0].quantidadeInformada='1025'
 review.itens[1].quantidadeInformada='950'
 const next=applyOmieReviewedRows([emptySku()],review)
 assert.equal(next.length,5)
 assert.equal(next[0].quantidade,'1025')
 assert.equal(next[1].quantidade,'950')
 assert.equal(next.reduce((sum,row)=>sum+Number(row.quantidade),0),4975)
 assert.equal(next[0].omieSourceFst,'26169-A')
 assert.equal(next[0].omieSourcePedido,'1038')
})
test('existing SKU fields, inspections, warehouse box distribution, and unrelated entries remain intact',()=>{
 const existing={...emptySku(),sku:'EMB277247003',nome:'Descrição personalizada',quantidade:'900',
  lote:'L123',material:'PP',caixasRecebidas:'1',caixasPadrao:'1',unidadesPadrao:'875',unidadesLaboratorio:'25'}
 const manual={...emptySku(),sku:'MANUAL-05',nome:'Componente acrescentado',quantidade:'50',lote:'M5'}
 const review=prepareOmieSkuReview(example,[existing,manual])
 assert.equal(review.itens[0].quantidadeInformada,'900','default to operator-entered receipt total')
 review.itens[0].quantidadeInformada='925'
 const next=applyOmieReviewedRows([existing,manual],review)
 assert.equal(next.length,6)
 assert.equal(next[0].quantidade,'925')
 assert.equal(next[0].nome,'Descrição personalizada')
 assert.equal(next[0].lote,'L123')
 assert.equal(next[0].caixasRecebidas,'1')
 assert.equal(next[0].unidadesPadrao,'875')
 assert.equal(next[0].unidadesLaboratorio,'25')
 assert.deepEqual(next[1],manual)
})
test('duplicate SKUs split across two lots are not overwritten with one order quantity',()=>{
 const first={...emptySku(),sku:'EMB277247003',quantidade:'500',lote:'L1'}
 const second={...emptySku(),sku:'EMB277247003',quantidade:'500',lote:'L2'}
 const review=prepareOmieSkuReview(example,[first,second])
 const next=applyOmieReviewedRows([first,second],review)
 assert.equal(next[0].quantidade,'500')
 assert.equal(next[1].quantidade,'500')
 assert.equal(next.filter(x=>x.sku==='EMB277247003').length,2)
})
test('quantities must be nonnegative and finite, but zero is a valid short receipt',()=>{
 const review=prepareOmieSkuReview(example,[emptySku()])
 review.itens[0].quantidadeInformada=''
 assert.equal(validOmieSkuReview(review),false)
 review.itens[0].quantidadeInformada='-1'
 assert.equal(validOmieSkuReview(review),false)
 review.itens[0].quantidadeInformada='0'
 assert.equal(validOmieSkuReview(review),true)
 review.itens[0].quantidadeInformada='Infinity'
 assert.equal(validOmieSkuReview(review),false)
})
test('lookup opens popup and avoids updating the inspection until closed',()=>{
 const lookup=app.slice(app.indexOf('async function lookupFstClient('),app.indexOf('async function saveProcessEdit('))
 const close=app.slice(app.indexOf('function closeOmieSkuReview('),app.indexOf('async function lookupFstClient('))
 assert.match(lookup,/openOmieSkuReview\(suggestion\)/)
 assert.doesNotMatch(lookup,/setSkuRows\(/)
 assert.match(close,/validOmieSkuReview\(review\)/)
 assert.match(close,/setSkuRows\(rows=>applyOmieReviewedRows\(rows,review\)\)/)
 assert.match(app,/onClick=\{closeOmieSkuReview\}>×<\/button>/)
 assert.match(app,/onClick=\{closeOmieSkuReview\}>Atualizar e fechar<\/button>/)
 assert.match(app,/function updateOmieReviewQuantity\(sku:string,value:string\)/)
 assert.match(app,/role="dialog" aria-modal="true"/)
 assert.match(app,/aria-label=\{'Quantidade recebida '\+item\.sku\}/)
 assert.match(app,/omieSkuReview\.itens\.reduce\(/)
 assert.match(app,/Revisar SKUs · PV/)
})
test('multiple linked Omie orders open a picker before a quantity review',()=>{
 assert.match(app,/setOmieOrderPickerOpen\(true\)/)
 assert.match(app,/omieOrderPickerOpen && omieOrders\?\.codigo===fstCode\(inspection\.codigo\)/)
 assert.match(app,/aria-label="Selecionar pedido Omie"/)
 assert.match(app,/lookupFstClient\(inspection\.codigo,Number\(omieSelectedOrder\)\)/)
})
test('cancellation discards changes and unrelated FST lookups invalidate stale modal state',()=>{
 assert.match(app,/Revisão descartada\. Os componentes permanecem inalterados\./)
 assert.match(app,/setOmieSkuReview\(null\);setOmieSkuReviewError\(''\);setOmieOrderPickerOpen\(false\)/)
 assert.match(app,/fstLookupRequest\.current\+\+/)
})
test('responsive table uses explicit SKU and receipt columns',()=>{
 assert.match(app,/Código \/ SKU/)
 assert.match(app,/Qtd\. pedido/)
 assert.match(app,/Qtd\. recebida/)
 assert.match(css,/\.omie-review-table-scroll/)
 assert.match(css,/\.omie-review-table/)
 assert.match(css,/@media\(max-width:600px\)/)
})

test('repeat lookup does not destroy an open popup, and failed order detail keeps picker open',()=>{
 const lookup=app.slice(app.indexOf('async function lookupFstClient('),app.indexOf('async function saveProcessEdit('))
 assert.match(lookup,/if\(fstLookupInFlight\.current===lookupKey\)return/)
 assert.match(lookup,/omieSkuReview\?\.codigo===code/)
 assert.match(lookup,/omieOrderPickerOpen && omieOrders\?\.codigo===code/)
 assert.match(lookup,/if\(!codigoPedido\)\{[\s\S]*?setOmieOrderPickerOpen\(false\)/)
 assert.match(lookup,/fstResponseCache\.current\.get\(lookupKey\)/)
 assert.match(lookup,/Date\.now\(\)-saved\.at<65000/)
 assert.match(lookup,/if\(requestId!==fstLookupRequest\.current\)return/)
 assert.match(lookup,/if\(fstLookupInFlight\.current===lookupKey\)fstLookupInFlight\.current=null/)
 assert.match(app,/processLookupMessage && !processLookupBusy && <p className="omie-review-validation"/)
})
