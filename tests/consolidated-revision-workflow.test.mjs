import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const api=read('backend/Sgq.Api/Program.cs')
const app=read('src/App.tsx')
const docs=read('server/app.py')
const part=(s,a,b)=>s.split(a)[1]?.split(b)[0]||''

test('all legacy inspection DOCX requests default to the parent FST A+B',()=>{
 const endpoint=part(api,'app.MapPost("/api/inspecoes/{id}/laudo"','app.MapPost("/api/processos/{id}/laudo"')
 assert.match(endpoint,/var generateCombined=!string\.IsNullOrWhiteSpace\(parentId\)/)
 assert.match(endpoint,/request\.Query\["individual"\]/)
 assert.match(endpoint,/generateCombined\s*\?\s*\$"\{auditDocsUrl\}\/generate-process/)
 assert.match(endpoint,/generate-inspection/)
 assert.match(docs,/for group in groups\[1:\]:/)
 assert.match(docs,/append_filled_inspection_form\(doc,filled\.body\)/)
})

test('post-completion edits keep the audit log but require no extra approval',()=>{
 const finish=part(api,'app.MapPost("/api/inspecoes/{id}/concluir"','app.MapPost("/api/its/{id}/estruturar"')
 const audit=part(api,'async Task AuditCompletedInspectionEdit','(JsonElement? row, bool found)')
 assert.match(finish,/revisao_obrigatoria=false/)
 assert.match(finish,/AuditCompletedInspectionEdit/)
 assert.match(audit,/audit_log/)
 assert.doesNotMatch(audit,/revisao_obrigatoria=true/)
 assert.doesNotMatch(finish,/Finalize os itens pendentes antes de concluir ou confirmar a revisão/)
 assert.doesNotMatch(api,/app.MapGet\("\/api\/processos\/\{id\}\/revisoes"/)
 assert.doesNotMatch(app,/confirmPendingProcessReview/)
 assert.doesNotMatch(app,/Confirmar revisão das entradas/)
 assert.match(app,/const url=consolidated/)
})

test('Word ignores revision flag while preserving technical readiness checks',()=>{
 const status=part(docs,'async def process_word_status','@app.get("/process-report-status/')
 assert.doesNotMatch(status,/pending.append\(f"\{label\}: revisão obrigatória/)
 assert.match(status,/row.get\("status"\)!="concluida"/)
 assert.match(status,/verificações obrigatórias incompletas/)
})
