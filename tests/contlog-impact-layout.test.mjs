import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const ui=source('src/auditorias/AuditoriasPage.tsx')
const css=source('src/auditorias/auditorias.css')
const api=source('backend/Sgq.Api/Program.cs')
const main=ui.slice(ui.indexOf('if (!active) {'),ui.indexOf("return (\n    <section className=\"audit-page audit-session\">"))

test('brand identity is displayed as Contlog in red, with strong header',()=>{
 assert.match(main,/audit-contlog-brand">Contlog/)
 assert.match(main,/<h1>Inspeções <span>Armazém<\/span><\/h1>/)
 assert.match(css,/\.audit-contlog-brand\{/)
 assert.match(css,/--cl-red-bright:#ff5669/)
})
test('the requested explanatory copy is absent from the visible warehouse dashboard',()=>{
 for(const text of [
  'QUALIDADE OPERACIONAL','Inspeções de campo, checklist','Registros disponíveis',
  'Inclui revisão','Inclui integração pendente','Arquivos Word disponíveis',
  'Word pronto','MODELOS OFICIAIS','modelos disponíveis para geração do Word',
  'O sistema preenche uma cópia','def.description','Versão {def.version}',
  'Nenhuma inspeção ativa na lista'
 ])assert.ok(!main.includes(text),'Visible text unexpectedly present: '+text)
})
test('keep four selectable RQs and authorized DOCX management',()=>{
 assert.match(main,/AUDIT_DEFINITIONS\.map/)
 assert.match(main,/className="audit-grid"/)
 assert.match(main,/startAudit\(def\)/)
 assert.match(main,/canManageTemplates && <details/)
 assert.match(main,/uploadTemplate\(def/)
})
test('new evaluation starts with only requested short system message',()=>{
 const route=api.slice(api.indexOf('app.MapPost("/api/auditorias/criar"'),api.indexOf('app.MapGet("/api/auditorias/{id}/detalhe"'))
 assert.match(route,/const string intro="Avaliação Iniciada";/)
 assert.doesNotMatch(route,/Vá registrando o que observar/)
 assert.match(ui,/\?'Avaliação Iniciada':m\.texto/)
})
test('Gemini inference failures remain visible and manual checklist stays available',()=>{
 assert.match(ui,/processed\.data\?\.degraded/)
 assert.match(ui,/IA não conseguiu interpretar/)
 assert.match(ui,/audit-ai-unavailable/)
 assert.match(ui,/saveManualAnswer/)
})
test('mobile has a defined fallback; no new iPad-only module',()=>{
 assert.match(css,/@media\(max-width:760px\)/)
 assert.match(css,/\.audit-hero-art/)
 assert.doesNotMatch(main,/iPad|tablet|Tablet/)
})
