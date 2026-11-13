import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const panel=load('src/stock/InventoryPanel.tsx')
const api=load('backend/Sgq.Api/Program.cs')
const schema=load('supabase/migrations/20261104_inventario_e_caixas_inteiras.sql')

test('existing stock inventory lists the delete action only for open sessions',()=>{
 assert.match(panel,/import \{ArrowLeft,CheckCircle2,ClipboardList,RefreshCw,Search,ShieldCheck,Trash2\}/)
 assert.match(panel,/canApprove&&session\.status==='aberto'/)
 assert.match(panel,/canApprove&&detail\.inventario\.status==='aberto'/)
 assert.match(panel,/onClick=\{\(\)=>void excludeSession\(session\)\}/)
 assert.match(panel,/onClick=\{\(\)=>void excludeSession\(detail\.inventario\)\}/)
 assert.match(panel,/window\.confirm\('Excluir o inventário/)
 assert.match(panel,/Ver excluídos/)
 assert.match(panel,/shownSessions=sessions\.filter\(session=>showDeleted\|\|session\.status!=='cancelado'\)/)
})
test('delete button calls authenticated API and never changes stock on client',()=>{
 const handler=panel.slice(panel.indexOf('async function excludeSession('),panel.indexOf('async function apply(){'))
 assert.match(handler,/!canApprove\|\|busy\|\|savingId\|\|session\.status!=='aberto'/)
 assert.match(handler,/apiPost<\{ok:boolean\}>\('\/api\/estoque\/inventarios\/'.*\+'\/excluir'/)
 assert.match(handler,/setMessage\('Inventário '/)
 assert.doesNotMatch(handler,/\.delete\(|\.remove\(|AjusteEstoque|movimentar/)
})
test('server soft-cancels only open inventory under manager role, preserving history',()=>{
 const start=api.indexOf('app.MapPost("/api/estoque/inventarios/{id}/excluir"')
 assert.ok(start>0)
 const endpoint=api.slice(start,api.indexOf('app.MapGet("/api/estoque/inventarios/{id}"',start))
 assert.match(endpoint,/InventoryAuthorized\(client,token,approval:true\)/)
 assert.match(endpoint,/status=eq\.aberto&select=id/)
 assert.match(endpoint,/status="cancelado"/)
 assert.match(endpoint,/observacao=observation/)
 assert.match(endpoint,/DateTimeOffset\.UtcNow/)
 assert.doesNotMatch(endpoint,/HttpMethod\.Delete|amostra_movimentacoes|sgq_aplicar_inventario/)
 assert.match(schema,/status IN \('aberto','fechado','ajustado','cancelado'\)/)
})
