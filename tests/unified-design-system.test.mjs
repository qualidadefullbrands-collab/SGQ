import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const css=read('src/SgqOperationsTheme.css')
const kanban=read('src/components/InspectionsKanban.tsx')
const audited=read('src/auditorias/AuditoriasPage.tsx')
const photos=read('src/mobile/MobileFotos.tsx')

test('global SGQ style is loaded once and scoped to operational routes',()=>{
 assert.match(app,/import '\.\/SgqOperationsTheme\.css'/)
 assert.match(app,/<main className="app-shell sgq-operational-shell" data-sgq-screen=\{tab\}>/)
 assert.match(css,/\.sgq-operational-shell\[data-sgq-screen\]/)
 assert.match(css,/:not\(\[data-sgq-screen="painel"\]\)/)
 assert.doesNotMatch(css,/^body\s*\{/m)
})

test('the active application shell exposes inspection workflows only',()=>{
 const start=app.indexOf('<aside className="sgq-side-nav')
 const end=app.indexOf('</aside>',start)
 assert.ok(start>=0&&end>start)
 const nav=app.slice(start,end)
 for(const label of ['Central de inspeções','Processos','Inspeções Armazém'])assert.ok(nav.includes(label))
 for(const label of ['Estoque','Equipamentos','Instruções técnicas','Configurações','Painel','Insights'])assert.doesNotMatch(nav,new RegExp(label))
 assert.match(app,/inspectionTabs=\['quadro','inspecoes','nova','execucao','auditorias','fotos-mobile'\]/)
 for(const name of ['nova','execucao','inspecoes','quadro','auditorias'])assert.match(app,new RegExp("tab==='"+name+"'"))
 assert.match(kanban,/sgq-kanban-board/)
 assert.match(audited,/audit-form-screen|audit-page/)
 assert.match(photos,/sgq-mobile-photo/)
})

test('inspection execution actions remain present while non-inspection tabs are unreachable',()=>{
 assert.match(app,/async function createInspection\(/)
 assert.match(app,/async function saveDimension\(/)
 assert.match(app,/async function finishInspection\(/)
 assert.match(app,/onClick=\{\(\)=>void downloadInspectionWord\(\)\}/)
 assert.match(app,/onClick=\{startEditingInspectionData\}/)
 assert.match(app,/if\(!inspectionTabs\.includes\(tab\)\)setTab\('quadro'\)/)
 assert.match(css,/:focus-visible/)
 assert.match(css,/@media\(max-width:760px\)/)
 assert.match(css,/@media\(max-width:520px\)/)
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/)
})

test('inspection screens retain their shared visual language and business context',()=>{
 assert.match(app,/INSPEÇÃO · \{formatFst/)
 assert.match(app,/Qualidade|QUALIDADE · CONTROLE DOCUMENTAL/)
 assert.match(app,/Identifique o FST, confirme o recebimento/)
 assert.match(app,/Registre cada etapa, confira as evidências/)
 assert.match(css,/--sgq-ui-blue:/)
 assert.match(css,/--sgq-ui-border:/)
 assert.match(kanban,/sgq-kanban-toolbar/)
 assert.match(kanban,/sgq-kit-type/)
})
