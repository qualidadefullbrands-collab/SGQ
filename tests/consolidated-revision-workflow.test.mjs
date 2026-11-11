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
 assert.match(endpoint,/generateCombined\s*\? "\$\{auditDocsUrl\}\/generate-process/)
 assert.match(endpoint,/generate-inspection/)
 assert.match(docs,/for group in groups\[1:\]:/)
 assert.match(docs,/append_filled_inspection_form\(doc,filled\.body\)/)
})

test('confirming a completed inspection after corrections requires genuine explicit review',()=>{
 const finish=part(api,'app.MapPost("/api/inspecoes/{id}/concluir"','app.MapPost("/api/its/{id}/estruturar"')
 assert.match(finish,/if\(pending\.Count>0\)/)
 assert.match(finish,/statusCode:409/)
 assert.match(finish,/if\(reHit && input\.Resultado!="reprovado"\)/)
 assert.match(finish,/revisao_obrigatoria=false/)
 assert.match(finish,/revisado_em=concluded\?\(DateTimeOffset\?\)DateTimeOffset\.UtcNow:null/)
 assert.match(finish,/AuditCompletedInspectionEdit/)
 assert.match(api,/app\.MapGet\("\/api\/processos\/\{id\}\/revisoes"/)
})

test('FST alert offers an auditable revision confirmation for A/B instead of a dead end',()=>{
 const review=part(app,'async function confirmPendingProcessReview()','async function downloadInspectionWord()')
 assert.match(review,/api\/processos\/'\+encodeURIComponent\(processId\)\+'\/revisoes/)
 assert.match(review,/window\.confirm\(/)
 assert.match(review,/row\.resultado,observacoes:row\.observacoes\?\?null/)
 assert.match(review,/refreshWordStatus\(\)/)
 assert.match(app,/Confirmar revisão das entradas/)
 assert.match(app,/const url=consolidated/)
})
