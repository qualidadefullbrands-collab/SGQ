import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const app=source('src/App.tsx')
const api=source('backend/Sgq.Api/Program.cs')
const css=source('src/styles.css')
const helpers=app.slice(app.indexOf('function laboratoryUnits('),app.indexOf('function retentionQuantityFromText('))
assert.ok(helpers.startsWith('function laboratoryUnits('),'helpers must be present')
const compiled=ts.transpileModule(helpers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const {boxGroupsFromRow,boxDistributionTotals,applyBoxGroupsToSku,setLaboratoryUnits,updateBoxDistributionField}=
  new Function(compiled+'\nreturn {boxGroupsFromRow,boxDistributionTotals,applyBoxGroupsToSku,setLaboratoryUnits,updateBoxDistributionField}')()

function row(overrides={}) {
 return {quantidade:'1025',caixasRecebidas:'1',caixasPadrao:'1',unidadesPadrao:'1025',
   quantidadePorCaixa:'1025',caixasFracionadas:'',unidadesFracionadas:'',
   unidadesLaboratorio:'',caixasLaboratorio:'',distribuicaoCaixas:'',...overrides}
}
test('1025 received as one box, 25 lab: one box of 1000 for storage, not 2 boxes',()=>{
 const updated=setLaboratoryUnits(row(),'25')
 const totals=boxDistributionTotals(updated)
 assert.equal(updated.unidadesPadrao,'1000')
 assert.equal(updated.quantidadePorCaixa,'1000')
 assert.equal(updated.caixasLaboratorio,'')
 assert.deepEqual(totals.groups,[
  {tipo:'padrao',caixas:1,unidades:1000},
  {tipo:'laboratorio',caixas:0,unidades:25}
 ])
 assert.equal(totals.boxes,1)
 assert.equal(totals.units,1000)
 assert.equal(totals.labUnits,25)
 assert.equal(totals.totalUnits,1025)
 assert.equal(totals.totalUnits,Number(updated.quantidade))
 assert.equal(totals.boxes,Number(updated.caixasRecebidas))
})
test('the same warehouse calculation is independent for each product/SKU',()=>{
 const sku1=setLaboratoryUnits(row({sku:'EMB001'}),'25')
 const sku2=setLaboratoryUnits(row({
  sku:'EMB002',quantidade:'510',caixasRecebidas:'2',caixasPadrao:'2',unidadesPadrao:'255',
  quantidadePorCaixa:'255'}),'10')
 assert.equal(boxDistributionTotals(sku1).boxes,1)
 assert.equal(boxDistributionTotals(sku1).units,1000)
 assert.equal(boxDistributionTotals(sku2).boxes,2)
 assert.equal(boxDistributionTotals(sku2).units,500)
 assert.equal(boxDistributionTotals(sku2).labUnits,10)
 assert.equal(sku2.quantidadePorCaixa,'250')
 assert.equal(sku1.quantidadePorCaixa,'1000')
})
test('fractionated boxes are counted for storage, while lab units do not add boxes',()=>{
 const data=row({quantidade:'1025',caixasRecebidas:'2',caixasPadrao:'1',
   unidadesPadrao:'900',quantidadePorCaixa:'900',caixasFracionadas:'1',
   unidadesFracionadas:'100',unidadesLaboratorio:'25'})
 const actual=boxDistributionTotals(data)
 assert.equal(actual.boxes,2)
 assert.equal(actual.units,1000)
 assert.equal(actual.labUnits,25)
 assert.equal(actual.totalUnits,1025)
 assert.equal(actual.expression,'1×900 + 1×100')
})
test('previously saved lab box groups remain readable and migrate non-destructively when edited',()=>{
 const legacy=[
  {Tipo:'padrao',Caixas:44,Unidades:136},
  {Tipo:'fracionada',Caixas:1,Unidades:16},
  {Tipo:'laboratorio',Caixas:1,Unidades:60}
 ]
 const converted=applyBoxGroupsToSku(row({quantidade:'6060',caixasRecebidas:'45'}),legacy)
 assert.equal(converted.caixasPadrao,'44')
 assert.equal(converted.unidadesPadrao,'136')
 assert.equal(converted.unidadesFracionadas,'16')
 assert.equal(converted.unidadesLaboratorio,'60')
 assert.equal(converted.caixasLaboratorio,'')
 assert.equal(converted.quantidadePorCaixa,'136')
 assert.deepEqual(boxGroupsFromRow(converted).at(-1),{tipo:'laboratorio',caixas:0,unidades:60})
 assert.equal(boxDistributionTotals(converted).boxes,45)
})
test('entire receipt moved to the lab does not invent a warehouse box',()=>{
 const data=row({caixasPadrao:'',unidadesPadrao:'',quantidadePorCaixa:'',
   quantidade:'1025',caixasRecebidas:'1',unidadesLaboratorio:'1025'})
 const totals=boxDistributionTotals(data)
 assert.equal(totals.boxes,0)
 assert.equal(totals.units,0)
 assert.equal(totals.labUnits,1025)
 assert.equal(totals.totalUnits,1025)
 assert.doesNotMatch(app,/d\.boxes!==Number\(row\.caixasRecebidas\)/)
})
test('warehouse quantity per box follows its operational standard even after edits',()=>{
 const changed=updateBoxDistributionField(row(),'unidadesPadrao','1000')
 assert.equal(changed.quantidadePorCaixa,'1000')
 assert.equal(changed.unidadesPadrao,'1000')
 assert.equal(changed.caixasPadrao,'1')
})
test('mixed box groups keep operator-defined capacities when lab quantity changes',()=>{
 const original=row({caixasFracionadas:'1',unidadesFracionadas:'25',unidadesPadrao:'975',quantidadePorCaixa:'975'})
 const changed=setLaboratoryUnits(original,'25')
 assert.equal(changed.unidadesPadrao,'975')
 assert.equal(changed.unidadesFracionadas,'25')
 assert.equal(boxDistributionTotals(changed).totalUnits,1025)
})
test('new and edit forms expose only laboratory units, and reconcile received vs storage + lab',()=>{
 assert.doesNotMatch(app,/value=\{row\.caixasLaboratorio\}/)
 assert.match(app,/Retirada para laboratório \(unidades\)/)
 assert.match(app,/Retirada em unidades, sem acrescentar caixas à armazenagem/)
 assert.match(app,/setLaboratoryUnits\(r,e\.target\.value\)/)
 assert.match(app,/if\(key==='unidadesLaboratorio'\)return setLaboratoryUnits\(row,value\)/)
 assert.match(app,/patchOperationalSkuRow\(row,key,value\)/)
 assert.match(app,/d\.totalUnits-Number\(row\.quantidade\)/)
 assert.match(app,/Distribuição para armazenagem · \{row\.sku/)
 assert.match(app,/Por componente \/ SKU/)
 assert.match(css,/\.box-distribution-editor \.distribution-grid,\s*\.edit-items-list \.distribution-grid\.compact/)
})
test('backend persists normalized laboratory units and operational units-per-box for each SKU',()=>{
 assert.match(api,/List<BoxDistribution>\? NormalizeComponentDistribution\(CreateInspectionItem item\)/)
 assert.match(api,/laboratoryUnits\+=group\.Unidades\*\(group\.Caixas>0m\?group\.Caixas:1m\)/)
 assert.match(api,/Tipo="laboratorio",Caixas=0m,Unidades=laboratoryUnits/)
 assert.match(api,/decimal\? OperationalUnitsPerBox\(CreateInspectionItem item\)/)
 assert.match(api,/NormalizeComponentDistribution\(item\)\?\.FirstOrDefault/)
 assert.ok((api.match(/distribuicao_caixas\s*=\s*NormalizeComponentDistribution\(item\)/g)||[]).length>=2)
 assert.ok((api.match(/quantidade_por_caixa\s*=\s*OperationalUnitsPerBox\(item\)/g)||[]).length>=2)
 assert.match(api,/processo_item_id = itemId/)
})
