import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../src/insights/insightsData.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^export /gm,'')
const {inspectionInsightRows}=new Function(compiled+'\nreturn {inspectionInsightRows}')()
const i=(id,group,fst,client='Cliente')=>({
 id,numero:'INS-'+id,status:'concluida',criado_em:'2026-11-04T09:00:00Z',
 grupos_inspecao:{id:group,processos:{id:'p-'+group,codigo:'FST'+fst,cliente:client,excluido_em:null}}
})
const link=(group,sku,received,ordered,pv)=>({
 grupo_inspecao_id:group,
 processo_itens:{quantidade:received,quantidade_pv:ordered,pv_numero:pv,
  produtos:{sku,nome:sku+' produto'}}
})
test('PV and received quantities remain different sources with an exact SKU and FST',()=>{
 const result=inspectionInsightRows([i('1','g1','26169-A')],[
  link('g1','EMB277247003',925,1000,'1038'),
 ])
 assert.equal(result.length,1)
 assert.equal(result[0].fst,'FST26169-A')
 assert.equal(result[0].pv,'1038')
 assert.equal(result[0].ordered,1000)
 assert.equal(result[0].received,925)
 assert.equal(result[0].difference,-75)
 assert.equal(result[0].evidence,'verified')
})
test('multi-lot SKU sums receipts without counting original PV twice',()=>{
 const result=inspectionInsightRows([i('1','g1','26169-A')],[
  link('g1','A',600,1000,'1038'),link('g1','A',300,1000,'1038')
 ])
 assert.equal(result.length,1)
 assert.equal(result[0].received,900)
 assert.equal(result[0].ordered,1000)
 assert.equal(result[0].difference,-100)
})
test('no historical PV means unknown, not false zero or discrepancy',()=>{
 const result=inspectionInsightRows([i('1','g1','26169-A')],[link('g1','A',500,null,null)])
 assert.equal(result[0].evidence,'missing')
 assert.equal(result[0].ordered,null)
 assert.equal(result[0].difference,null)
})
test('inconsistent PV references are not treated as comparable',()=>{
 const result=inspectionInsightRows([i('1','g1','26169-A')],[
  link('g1','A',100,120,'1038'),link('g1','A',50,100,'1039')
 ])
 assert.equal(result[0].evidence,'ambiguous')
 assert.equal(result[0].ordered,null)
})
test('FST suffixes and archived processes remain separated',()=>{
 const result=inspectionInsightRows([
  i('1','g1','26169-A'),i('2','g2','26169-B'),
  {...i('3','g3','26169-C'),grupos_inspecao:{id:'g3',processos:{id:'p3',codigo:'FST26169-C',excluido_em:'2026-11-04'}}}
 ],[
  link('g1','A',80,100,'1038'),link('g2','A',110,100,'1039'),link('g3','A',20,20,'1040')
 ])
 assert.equal(result.length,2)
 assert.deepEqual(result.map(r=>r.fst),['FST26169-A','FST26169-B'])
})
