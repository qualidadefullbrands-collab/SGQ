import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const api=source('backend/Sgq.Api/Program.cs')
const ui=source('src/auditorias/AuditoriasPage.tsx')
const app=source('src/App.tsx')
const css=source('src/auditorias/auditorias.css')
const start=api.indexOf('app.MapPost("/api/auditorias/{id}/excluir"')
const end=api.indexOf('app.MapPost("/api/auditorias/criar"',start)
const deletion=start>=0&&end>start?api.slice(start,end):''
test('warehouse delete is a soft delete, not a hard delete',()=>{
  assert.ok(deletion,'missing soft-delete API endpoint')
  assert.match(deletion,/HttpMethod\.Patch,"auditoria_execucoes"/)
  assert.match(deletion,/excluido_em=DateTimeOffset\.UtcNow/)
  assert.match(deletion,/excluido_por=userId/)
  assert.doesNotMatch(deletion,/HttpMethod\.Delete/)
})
test('warehouse delete verifies administrator or manager role on server',()=>{
  assert.match(deletion,/CurrentUserId\(client,token\)/)
  assert.match(deletion,/profiles/)
  assert.match(deletion,/role is not \("administrador" or "gestor"\)/)
  assert.match(deletion,/statusCode:403/)
})
test('deleted warehouse inspections are omitted from list and details',()=>{
  assert.match(api,/auditoria_execucoes","select=\*\&excluido_em=is\.null\&order=criado_em/)
  assert.match(api,/auditoria_execucoes",\s*\$"select=\*\&id=eq\.\{Uri\.EscapeDataString\(id\)\}\&excluido_em=is\.null/)
})
test('controls are restricted and preserve evidence and Word',()=>{
  assert.match(app,/<AuditoriasPage profileName=\{profile\.nome\} canDelete=\{!!canDelete\}\/>/)
  assert.match(ui,/\{canDelete&&<button/)
  assert.match(ui,/confirm|deleteWarehouseInspection/i)
  assert.match(ui,/registros, fotos e documentos serão preservados/)
})
test('delete confirmation and error handling are present',()=>{
  assert.match(ui,/role="alertdialog"/)
  assert.match(ui,/setDeletionCandidate\(null\)/)
  assert.match(ui,/setDeletionError/)
  assert.match(ui,/setExecutions\(previous=>previous\.filter\(row=>row\.id!==id\)\)/)
  assert.match(css,/\.audit-delete-action\{/)
})
