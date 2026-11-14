import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const policySource=read('src/stock/StockQuantityPolicy.ts')
const migration=read('supabase/migrations/20261114003316_sgq_conciliacao_referencia_local.sql')
const recon=read('src/stock/BlindInventoryReconciliation.tsx')
const status=read('src/stock/BlindInventoryStatus.tsx')
const original=read('supabase/migrations/20261113193000_sgq_conciliacao_pos_inventario_fst.sql')

const compiled=ts.transpileModule(policySource,{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText
const policy=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))

const ALLOWED=[
 'sgq_contagem_fisica_local',
 'sgq_inventario_anterior_local',
 'sgq_posicao_local_documentada',
]

test('only documented SGQ physical sources can support a quantity difference',()=>{
 assert.deepEqual(policy.LOCAL_QUANTITY_SOURCES.map(s=>s.value),ALLOWED)
 for(const source of ALLOWED){
  assert.equal(policy.isApprovedLocalSource(source),true,source)
  assert.equal(policy.invalidQuantityReferenceSource(source),false,source)
  assert.equal(policy.localQuantityReference({quantidade_referencia:12.5,referencia_fonte:source}),12.5)
  assert.equal(policy.localQuantityReference({quantidade_referencia:0,referencia_fonte:source}),0)
 }
 for(const source of ['omie','Omie estoque','Saldo ERP','SGQ referência livre','registro anterior não validado']){
  assert.equal(policy.isApprovedLocalSource(source),false,source)
  assert.equal(policy.invalidQuantityReferenceSource(source),true,source)
  assert.equal(policy.localQuantityReference({quantidade_referencia:15,referencia_fonte:source}),null,source)
 }
 assert.equal(policy.localQuantityReference({quantidade_referencia:99,referencia_fonte:null}),null)
 assert.equal(policy.localQuantityReference({quantidade_referencia:null,referencia_fonte:ALLOWED[0]}),null)
 assert.equal(policy.localQuantityReference({quantidade_referencia:-1,referencia_fonte:ALLOWED[0]}),null)
 assert.equal(policy.invalidQuantityReferenceSource(''),false)
})

test('migration enforces the same physical-source codes on the database',()=>{
 for(const source of ALLOWED)assert.match(migration,new RegExp(source))
 assert.match(migration,/add constraint sgq_recon_referencia_origem_fisica/)
 assert.match(migration,/referencia_fonte in \(/)
 assert.match(migration,/not valid;/)
 assert.match(migration,/validate constraint sgq_recon_referencia_origem_fisica;/)
 assert.match(migration,/before update of status on public\.sgq_inventario_conciliacoes/)
 assert.match(migration,/new\.status = 'concluida'/)
 assert.match(migration,/item\.referencia_fonte not in \(/)
 assert.match(migration,/v_invalidos > 0/)
 assert.match(migration,/security invoker/)
 assert.match(migration,/revoke all on function public\.sgq_recon_validar_origens_ao_concluir\(\)/)
 assert.match(original,/security definer/)
 assert.match(original,/v_role text:=private\.current_sgq_role\(\)/)
 assert.doesNotMatch(migration,/update public\.amostras|AjustarEstoque|AlterarProduto|quantidade_omie/i)
})

test('interface cannot submit free text as reference origin',()=>{
 assert.match(recon,/<select value=\{draft\.source\}/)
 assert.match(recon,/LOCAL_QUANTITY_SOURCES\.map\(/)
 assert.match(recon,/!isApprovedLocalSource\(draft\.source\)/)
 assert.match(recon,/invalidQuantityReferenceSource\(row\.referencia_fonte\)/)
 assert.match(status,/localQuantityReference\(review\)/)
 assert.doesNotMatch(recon,/<input maxLength=\{240\} value=\{draft\.source\}/)
})
