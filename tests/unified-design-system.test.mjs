import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const css=read('src/SgqOperationsTheme.css')
const kanban=read('src/components/InspectionsKanban.tsx')
const audited=read('src/auditorias/AuditoriasPage.tsx')
const insights=read('src/insights/InsightsPage.tsx')
const equipment=read('src/equipamentos/EquipmentPage.tsx')
const photos=read('src/mobile/MobileFotos.tsx')
const itEditor=read('src/its/ItEditorDemo.tsx')

test('global SGQ style is loaded once and scoped to operational routes',()=>{
 assert.match(app,/import '\.\/SgqOperationsTheme\.css'/)
 assert.match(app,/<main className="app-shell sgq-operational-shell" data-sgq-screen=\{tab\}>/)
 assert.match(css,/\.sgq-operational-shell\[data-sgq-screen\]/)
 assert.match(css,/:not\(\[data-sgq-screen="painel"\]\)/)
 assert.doesNotMatch(css,/\bbody\s*\{\s*background:/)
})

test('all SGQ application screens are themed without hiding workflows',()=>{
 for(const name of [
  'nova','execucao','estoque','inspecoes','quadro','its','equipamentos','insights','auditorias',
 ])assert.match(app,new RegExp("tab==='"+name+"'"))
 for(const part of [
  'inspection-form','inspection-stage-tabs','stock-summary',
  'sgq-inventory-table-scroll','sgq-screen-its','it-test-banner',
  'equipment-summary','sgq-warehouse-workspace','sgq-insights','sgq-mobile-photo',
 ])assert.ok(css.includes(part),part+' is not themed')
 assert.match(app,/tab==='fotos-mobile'/)
 assert.match(kanban,/sgq-kanban-board/)
 assert.match(audited,/sgq-warehouse-workspace/)
 assert.match(insights,/sgq-insights/)
 assert.match(equipment,/equipment-page/)
 assert.match(photos,/sgq-mobile-photo/)
 assert.match(itEditor,/it-test-tabs/)
})

test('dashboard shell remains intact and existing inspection actions are present',()=>{
 assert.match(app,/<SgqDashboard/)
 assert.match(app,/async function createInspection\(/)
 assert.match(app,/async function saveDimension\(/)
 assert.match(app,/async function finishInspection\(/)
 assert.match(app,/onClick=\{\(\)=>void downloadInspectionWord\(\)\}/)
 assert.match(app,/onClick=\{startEditingInspectionData\}/)
 assert.match(css,/:focus-visible/)
 assert.match(css, /@media\(max-width:760px\)/)
 assert.match(css, /@media\(max-width:520px\)/)
 assert.match(css, /@media\(prefers-reduced-motion:reduce\)/)
})

test('non-dashboard page headings share design system and preserve business context',()=>{
 assert.match(app,/INSPEÇÃO · \{formatFst/)
 assert.match(app,/Qualidade|QUALIDADE · CONTROLE DOCUMENTAL/)
 assert.match(app,/Identifique o FST, confirme o recebimento/)
 assert.match(app,/Registre cada etapa, confira as evidências/)
 assert.match(css,/--sgq-ui-blue:/)
 assert.match(css,/--sgq-ui-border:/)
})
