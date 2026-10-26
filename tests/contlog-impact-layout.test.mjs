import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const ui=read('src/auditorias/AuditoriasPage.tsx')
const css=read('src/auditorias/auditorias.css')
const api=read('backend/Sgq.Api/Program.cs')
const catalog=read('src/auditorias/catalog.ts')
const styles=read('src/styles.css')

test('brand says exactly Contlog without decorative dot or invented slogans',()=>{
 assert.match(ui,/<span className="audit-contlog-brand">Contlog<\/span>/)
 assert.doesNotMatch(ui,/audit-brand-dot|CQ \/ 26|CENTRAL DE QUALIDADE|04 ROTINAS|ROTINAS DE INSPEÇÃO/)
 assert.match(css,/\.audit-contlog-brand\{/)
})
test('none of the forbidden explanatory text remains visible',()=>{
 for(const value of ['QUALIDADE OPERACIONAL','Registros disponíveis','Inclui revisão',
 'Inclui integração pendente','Arquivos Word disponíveis','Word pronto',
 'O sistema preenche uma cópia','Nenhuma inspeção ativa na lista','def.description'])
 assert.ok(!ui.includes(value),value)
})
test('four RQs and Word model management still exist',()=>{
 for(const code of ["'RQ014'","'RQ015'","'RQ016'","'RQ016B'"]) assert.ok(catalog.includes(code))
 assert.match(ui,/AUDIT_DEFINITIONS\.map/)
 assert.match(ui,/uploadTemplate/)
 assert.match(ui,/generateWord/)
})
test('all warehouse inspections are manual, with no Gemini calls',()=>{
 assert.match(ui,/saveManualAnswer/)
 assert.match(ui,/saveManualRecord/)
 assert.match(ui,/saveEquipment/)
 assert.match(ui,/audit-manual-sections/)
 assert.doesNotMatch(ui,/startVoice|sendMessage|imageToDataUrl|sgq-auditoria-assistente/)
 assert.match(api,/app.MapPost\("\/api\/auditorias\/\{id\}\/registros"/)
 assert.match(api,/app.MapPost\("\/api\/auditorias\/\{id\}\/objetos"/)
 assert.match(api,/O fluxo por IA foi desativado/)
 assert.doesNotMatch(api,/functions\/v1\/sgq-auditoria-assistente/)
})
test('checklist C/NC/NA, notes, camera, completion and Word stay available',()=>{
 assert.match(ui,/\['C','NC','NA'\]/)
 assert.match(ui,/notes\[key\]/)
 assert.match(ui,/capture="environment"/)
 assert.match(ui,/requestFinish/)
 assert.match(ui,/downloadExisting/)
})
test('consistent design extends across entire SGQ with desktop and phone layouts',()=>{
 assert.match(styles,/Unified SGQ interface language/)
 assert.match(styles,/\.sgq-operational-shell \.topbar/)
 assert.match(styles,/\.sgq-side-nav/)
 assert.match(styles,/@media\(max-width:620px\)/)
 assert.match(css,/audit-manual-row/)
})
