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

test('existing subprocess identities use FST-A/B and show CD arrival next to FST',()=>{
 assert.match(processes,/sgq-process-identity-head/)
 assert.match(processes,/Chegada ao CD:/)
 assert.match(processes,/processLabel\}\{sub\.letter\?'-'\+sub\.letter/)
 assert.match(processes,/sgq-subprocess-products/)
 assert.match(processes,/product\.sku/)
 assert.match(processes,/product\.descricao/)
 assert.match(processesCss,/sgq-subprocess-product\{\s*display:flex;flex-direction:column/)
 assert.doesNotMatch(processes,/> Editar FST</)
 assert.doesNotMatch(processes,/> Adicionar entrada A</)
 assert.doesNotMatch(processes,/<input[^>]*type="search"/)
})

test('dashboard keeps Kanban, processes and stock visible together',()=>{
 assert.match(dashboard,/<section id="sgq-dashboard-inspections"/)
 assert.match(dashboard,/<section id="sgq-dashboard-process-preview"/)
 assert.match(dashboard,/<section id="sgq-dashboard-stock-preview"/)
 assert.match(dashboard,/scrollIntoView\(\{behavior:'smooth'/)
 assert.doesNotMatch(dashboard,/\{panelSection==='processos'&&<div/)
 assert.doesNotMatch(dashboard,/\{panelSection==='estoque'&&<div/)
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
