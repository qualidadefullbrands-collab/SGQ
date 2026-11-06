import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=file('src/App.tsx')
const api=file('backend/Sgq.Api/Program.cs')
const migration=file('supabase/migrations/20261106_sgq_conciliar_caixas_fst26152_a.sql')

test('inspection editing recovers warehouse box counts from saved standard and fractional distribution',()=>{
 assert.match(app,/function suggestMissingInspectedBoxes\(row:any\)/)
 assert.match(app,/const distributionBoxes=boxDistributionTotals\(row\)\.boxes/)
 assert.match(app,/caixasRecebidas:boxesReceived,caixasInspecionadas:boxesEvaluate/)
 assert.match(app,/function updateBoxDistributionField/)
 assert.match(app,/const before=boxDistributionTotals\(row\)\.boxes/)
 assert.match(app,/const after=boxDistributionTotals\(changed\)\.boxes/)
 assert.match(app,/const received=Number\(item\.caixas_recebidas\)>0/)
 assert.match(app,/function inspectionBoxTotal/)
 assert.match(app,/inspectionBoxTotal\(detail,'received'\)/)
 assert.match(app,/inspectionBoxTotal\(detail,'evaluate'\)/)
})

test('sampling API derives all boxes from distribution, excludes laboratory and returns totals to UI',()=>{
 assert.match(api,/decimal OperationalBoxesReceived\(CreateInspectionItem item\)/)
 assert.match(api,/\.Where\(x=>x\.Tipo is "padrao" or "fracionada"\)/)
 assert.match(api,/decimal BoxesToEvaluate\(decimal received\)/)
 assert.match(api,/if\(boxes<=56\)return 8m/)
 assert.match(api,/decimal OperationalBoxesToEvaluate\(CreateInspectionItem item\)/)
 assert.match(api,/items\.Sum\(OperationalBoxesReceived\)/)
 assert.match(api,/items\.Sum\(OperationalBoxesToEvaluate\)/)
 assert.match(api,/caixasRecebidas=totalBoxes,caixasAvaliar=totalInspect/)
 assert.match(app,/caixas_recebidas:p\?\.caixasRecebidas/)
 assert.match(app,/caixas_avaliar:p\?\.caixasAvaliar/)
})

test('legacy 26152-A reconciliation has guards, audit and touches only missing fields',()=>{
 assert.match(migration,/where p\.codigo='FST26152' and p\.excluido_em is null/)
 assert.match(migration,/g\.subprocesso_codigo='A'/)
 assert.match(migration,/pr\.sku='EMB21169PAL001'/)
 assert.match(migration,/tamanho_lote<>6060/)
 assert.match(migration,/warehouse_boxes<>45/)
 assert.match(migration,/caixas_recebidas=45,caixas_inspecionadas=8/)
 assert.match(migration,/caixas_recebidas=45,caixas_avaliar=8/)
 assert.match(migration,/sgq_audit\.correcao_caixas_plano/)
})
