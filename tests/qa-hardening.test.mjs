import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const api=source('backend/Sgq.Api/Program.cs')
const audits=source('src/auditorias/AuditoriasPage.tsx')
const shell=source('src/App.tsx')
function section(text,start,end){
 const first=text.indexOf(start)
 assert.ok(first>=0,'Missing start marker: '+start)
 const last=text.indexOf(end,first+start.length)
 assert.ok(last>first,'Missing end marker: '+end)
 return text.slice(first,last)
}
test('warehouse editing API verifies the inspection is still open',()=>{
 const guard=section(api,'async Task<bool> WarehouseAuditWritable','app.MapGet("/api/auditorias/bootstrap"')
 assert.match(guard,/excluido_em=is.null/)
 assert.match(guard,/em_andamento/)
 assert.match(guard,/revisao/)
 for(const [first,last] of [
   ['app.MapPut("/api/auditorias/{id}/respostas/','app.MapPost("/api/auditorias/{id}/mensagens"'],
   ['app.MapPost("/api/auditorias/{id}/mensagens"','app.MapPost("/api/auditorias/{id}/concluir"'],
   ['app.MapPost("/api/auditorias/{id}/concluir"','app.MapGet("/api/app/bootstrap"']
 ]){
  assert.match(section(api,first,last),/WarehouseAuditWritable\(client,token,id\)/)
 }
})
test('Word templates are authorized in API and UI',()=>{
 const route=section(api,'app.MapPut("/api/auditorias/templates/','app.MapGet("/api/auditorias/{id}/documento"')
 assert.match(route,/administrador/)
 assert.match(route,/gestor/)
 assert.match(route,/statusCode:403/)
 assert.match(audits,/canManageTemplates/)
 assert.match(audits,/canManageTemplates&&<input/)
 assert.match(shell,/canManageTemplates=\{!!canManageIts\}/)
})
test('warehouse message text survives failed send and the send lock always releases',()=>{
 const send=section(audits,'async function sendMessage','async function requestFinish')
 assert.match(send,/const originalDraft=draft/)
 assert.doesNotMatch(send,/const originalDraft=draft\s*setDraft\(''\)/)
 assert.match(send,/setDraft\(old=>old===originalDraft\?'':old\)/)
 assert.match(send,/sendRequestLock\.current=false/)
 assert.match(send,/finally/)
})
test('prevent double starts, stale inspection details and notice loss after Word generation',()=>{
 assert.match(audits,/startRequestLock\.current=true/)
 assert.match(audits,/startRequestLock\.current=false/)
 assert.match(audits,/requestVersion!==openAuditVersion\.current/)
 assert.match(audits,/await openAudit\(execution\.id,true\)/)
})
test('warehouse photo signatures have bounded parallelism',()=>{
 const detail=section(api,'app.MapGet("/api/auditorias/{id}/detalhe"','app.MapPut("/api/auditorias/{id}/respostas/')
 assert.match(detail,/SemaphoreSlim\(4\)/)
 assert.match(detail,/Task\.WhenAll\(paths\.Select/)
 assert.match(detail,/finally\{gate\.Release\(\);\}/)
})
test('catalog and inventory failures are visible, not silent zeros',()=>{
 const catalogs=section(shell,'async function loadCatalogs','async function loadPhotoLinks')
 assert.match(catalogs,/Falha de conexão ao carregar as instruções técnicas/)
 assert.match(catalogs,/Falha de conexão ao atualizar o estoque/)
})
