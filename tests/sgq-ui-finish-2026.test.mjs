import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=source('src/App.tsx')
const processes=source('src/components/InspectionsKanban.tsx')
const processesCss=source('src/components/InspectionsKanban.css')
const dashboard=source('src/components/SgqDashboard.tsx')
const equipment=source('src/equipamentos/EquipmentPage.tsx')
const inventory=source('src/stock/InventoryPanel.tsx')
const settings=source('src/config/SettingsPage.tsx')

test('existing subprocess identities use separate FST and entry labels and show CD arrival',()=>{
 assert.match(processes,/sgq-process-identity-head/)
 assert.match(processes,/Chegada ao CD:/)
 assert.match(processes,/Entrada \{sub\.letter/)
 assert.match(processes,/sgq-subprocess-products/)
 assert.match(processes,/product\.sku/)
 assert.match(processes,/product\.descricao/)
 assert.match(processesCss,/\.sgq-subprocess-product\\{display:inline-flex/)
 assert.doesNotMatch(processes,/> Editar FST</)
 assert.doesNotMatch(processes,/> Adicionar entrada A</)
 assert.doesNotMatch(processes,/<input[^>]*type="search"/)
})

test('active product navigation exposes inspection workflows only',()=>{
 const start=app.indexOf('<aside className="sgq-side-nav')
 const end=app.indexOf('</aside>',start)
 assert.ok(start>=0&&end>start)
 const nav=app.slice(start,end)
 assert.match(nav,/Quadro de inspeções/)
 assert.match(nav,/Processos/)
 assert.match(nav,/Inspeções Armazém/)
 for(const name of ['Estoque','Equipamentos','Instruções técnicas','Configurações','Painel','Insights'])
  assert.doesNotMatch(nav,new RegExp(name))
 assert.ok(app.includes("inspectionTabs=['quadro','inspecoes','nova','execucao','auditorias','fotos-mobile']"))
})
test('stock divergence has actionable filters and distinguishes missing and excess',()=>{
 assert.match(inventory,/setOnlyDifferences\(old=>!old\)/)
 assert.match(inventory,/Faltas/)
 assert.match(inventory,/Sobras/)
 assert.match(inventory,/Falta no estoque/)
 assert.match(inventory,/Sobra no estoque/)
 assert.match(inventory,/sgq-inventory-empty-state/)
})

test('equipment card opens details without two buttons in the equipment row',()=>{
 assert.match(equipment,/equipment-row-interactive/)
 assert.match(equipment,/onClick=\{\(\)=>\{setSelected\(e\.id\)/)
 assert.match(equipment,/equipment-summary-card/)
 assert.match(equipment,/aria-pressed=\{equipmentFilter===filter\}/)
 assert.match(equipment,/equipment-history-backdrop/)
 assert.doesNotMatch(equipment,/Abrir detalhes ›/)
})

test('stock DOCX import has textual preview and does not pretend to approve inspection',()=>{
 assert.match(app,/sgq_estoque_inspecoes_documentais/)
 assert.match(app,/sgq-estoque-word/)
 assert.match(app,/mammoth\.extractRawText/)
 assert.match(app,/stockDocumentPreview/)
 assert.match(app,/Confirme que os dados pertencem ao SKU/)
 assert.match(app,/Não cria uma inspeção aprovada automaticamente/)
})

test('settings admin user actions enforce backend integration and effective roles',()=>{
 assert.match(settings,/sgq-admin-users/)
 assert.match(settings,/action:'create'/)
 assert.match(settings,/action:'reset_password'/)
 assert.match(settings,/auth\.updateUser\(\{password:myPassword\}\)/)
 assert.match(settings,/input type="checkbox" disabled readOnly checked=\{f\.allowed\.includes\(previewRole\)\}/)
})

test('assistant supports user-provided context for IT and inspection conclusion',()=>{
 assert.match(app,/contextoAdicional:aiItExtraContext\.trim\(\)/)
 assert.match(app,/contextoAdicional:aiConclusionExtraContext\.trim\(\)/)
})
