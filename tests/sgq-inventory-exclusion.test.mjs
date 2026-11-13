import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const classic=load('src/stock/InventoryPanel.tsx')
const blind=load('src/stock/BlindInventoryPage.tsx')
const api=load('backend/Sgq.Api/Program.cs')
const schema=load('supabase/migrations/20261113080000_sgq_inventario_cego_omie_fotos.sql')

test('both inventory screens expose exclusion only for open sessions and authorized managers',()=>{
 for(const ui of [classic,blind]){
  assert.match(ui,/showDeleted/)
  assert.match(ui,/Ver excluídos/)
  assert.match(ui,/shownSessions=sessions\.filter\(session=>showDeleted\|\|session\.status!=='cancelado'\)/)
  assert.match(ui,/canApprove&&s(?:ession)?\.status==='aberto'/)
  assert.match(ui,/Excluir inventário/)
  assert.match(ui,/window\.confirm/)
 }
 assert.match(classic,/detail\.inventario\.status==='aberto'/)
 assert.match(blind,/active\.status==='aberto'/)
})

test('existing inventory cancellation is an authenticated status change, not a hard delete',()=>{
 const start=api.indexOf('app.MapPost("/api/estoque/inventarios/{id}/excluir"')
 assert.ok(start>0)
 const implementation=api.slice(start,api.indexOf('app.MapGet("/api/estoque/inventarios/{id}"',start))
 assert.match(implementation,/InventoryAuthorized\(client,token,approval:true\)/)
 assert.match(implementation,/if\(StockText\(inv!\.Value,"status"\)!="aberto"\)/)
 assert.match(implementation,/status=eq\.aberto&select=id/)
 assert.match(implementation,/status="cancelado"/)
 assert.match(implementation,/observacao=observation/)
 assert.match(implementation,/Excluído em/)
 assert.doesNotMatch(implementation,/HttpMethod\.Delete|AjusteEstoque|amostra_movimentacoes/)
 assert.match(classic,/api\/estoque\/inventarios\/.*\+'\/excluir'/)
})

test('blind inventory marks exclusion and keeps rows, photos and Omie untouched',()=>{
 assert.match(blind,/async function excludeSession\(session:Session\)/)
 assert.match(blind,/status:'cancelado',fechado_por:user\.id,fechado_em:/)
 assert.match(blind,/\.eq\('id',session\.id\)\.eq\('status','aberto'\)/)
 assert.match(blind,/As contagens e fotos ficarão preservadas/)
 assert.doesNotMatch(blind.slice(blind.indexOf('async function excludeSession('),blind.indexOf('async function syncOmie(')),/\.delete\(|\.remove\(|AlterarProduto/)
 assert.match(schema,/status text not null default 'aberto' check \(status in \('aberto','fechado','cancelado'\)\)/)
 assert.match(schema,/sgq_inventarios_cegos_update/)
 assert.match(schema,/status='aberto'\)/)
 assert.match(schema,/status in \('fechado','cancelado'\)/)
})
