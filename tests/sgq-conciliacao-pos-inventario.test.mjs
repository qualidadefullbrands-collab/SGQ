import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const ui=read('src/stock/BlindInventoryReconciliation.tsx')
const sql=read('supabase/migrations/20261113193000_sgq_conciliacao_pos_inventario_fst.sql')

test('post-inventory reconciliation is visible as a separate SGQ stock tab',()=>{
 assert.match(app,/import BlindInventoryReconciliation/)
 assert.match(app,/stockMode==='conciliacao'&&<BlindInventoryReconciliation/)
 assert.match(app,/Conciliação pós-inventário/)
 assert.match(app,/canApprove=\{!!profile&&\['administrador','gestor'\]\.includes\(profile\.perfil\)\}/)
})

test('blind counts remain independent from manual reconciliation and Omie stock movements',()=>{
 assert.match(sql,/All stock adjustments remain OUTSIDE this module/)
 assert.match(ui,/A aprovação registra uma decisão auditável, mas não ajusta saldos/)
 assert.doesNotMatch(ui,/\/api\/estoque\/moviment|incluir_ajuste|AlterarProduto|AjustarEstoque/)
 assert.doesNotMatch(sql,/update public\.amostras|update public\.estoque|omie_/)
 assert.match(ui,/O saldo global do Omie não é automaticamente comparável/)
})

test('reconciliation has audited closure, local references, recount and approval',()=>{
 for(const step of ['encerrar','referencia','solicitar_recontagem','recontar','revisar','finalizar']){
  assert.match(sql,new RegExp("p_acao='"+step+"'"))
  assert.match(ui,new RegExp("operate\\('"+step+"'"))
 }
 for(const label of ['Encerrar contagem e conciliar','Salvar referência','Solicitar recontagem','Salvar recontagem','Aprovar divergência','Concluir conciliação','Histórico de decisões']){
  assert.ok(ui.includes(label),label)
 }
 assert.match(sql,/recontagem_justificativa/)
 assert.match(sql,/referencia_evidencia/)
 assert.match(sql,/justificativa_analise/)
 assert.match(sql,/revisado_por/)
 assert.match(sql,/concluido_por/)
})

test('only authenticated authorized roles can change reconciliation; all data writes use the RPC',()=>{
 assert.match(sql,/security definer/)
 assert.match(sql,/v_user uuid:=auth\.uid\(\)/)
 assert.match(sql,/v_role text:=private\.current_sgq_role\(\)/)
 assert.match(sql,/if not v_manager then raise exception 'Somente gestor pode encerrar/)
 assert.match(sql,/if not v_manager then raise exception 'Somente gestor pode informar a referência/)
 assert.match(sql,/if not v_manager then raise exception 'Somente gestor pode aprovar/)
 assert.match(sql,/revoke all on function public\.sgq_conciliacao_operar/)
 assert.match(sql,/grant execute on function public\.sgq_conciliacao_operar/)
 assert.match(sql,/alter table public\.sgq_inventario_conciliacoes enable row level security/)
 assert.match(sql,/alter table public\.sgq_inventario_conciliacao_itens enable row level security/)
 assert.match(sql,/alter table public\.sgq_inventario_conciliacao_eventos enable row level security/)
 assert.match(sql,/grant select on public\.sgq_inventario_conciliacao_itens to authenticated/)
 assert.doesNotMatch(sql,/grant (insert|update|delete|all) on public\.sgq_inventario_conciliacao_itens to authenticated/)
 assert.match(ui,/authClient\.rpc\('sgq_conciliacao_operar'/)
 assert.doesNotMatch(ui,/\.from\('sgq_inventario_conciliacao_itens'\)\s*\.update/)
})

test('reference source and evidence must be nonempty and numeric differences are evaluated safely',()=>{
 assert.match(sql,/coalesce\(length\(btrim\(referencia_fonte\)\),0\)/)
 assert.match(sql,/coalesce\(length\(btrim\(referencia_evidencia\)\),0\)/)
 assert.match(sql,/quantidade_referencia numeric\(18,3\)/)
 assert.match(sql,/quantidade_recontagem numeric\(18,3\)/)
 assert.match(sql,/status not in \('conciliado','divergencia_aprovada'\)/)
 assert.match(sql,/v_delta:=coalesce\(v_row\.quantidade_recontagem,v_row\.quantidade_original\)-v_row\.quantidade_referencia/)
 assert.match(ui,/parseQty\(draft\.reference\)/)
})

test('each photograph can be inspected through a temporary signed URL, without making inventory storage public',()=>{
 assert.match(ui,/createSignedUrl\(photo\.storage_path,300\)/)
 assert.match(ui,/sgq-inventario-cego/)
 assert.doesNotMatch(ui,/getPublicUrl/)
})
