import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const ui=read('src/stock/BlindInventoryPage.tsx')
const sql=read('supabase/migrations/20261113133000_sgq_inventario_cego_sku_independente.sql')

test('SKU mode directly enables count without process and FST remains conditional',()=>{
 assert.ok(ui.includes("lookupMode==='processo'&&(!processContext"))
 assert.ok(ui.includes("const linkedProcess=lookupMode==='processo'?processContext:null"))
 assert.ok(ui.includes("processo_id:linkedProcess?.processoId||null"))
 assert.ok(ui.includes("processo_codigo:linkedProcess?.processoCodigo||null"))
 assert.ok(ui.includes("cliente_confirmado:!!linkedProcess"))
 assert.ok(ui.includes("modo:'codigo_omie'"))
 assert.ok(ui.includes("produto localizado")||ui.includes("Produto localizado"))
 assert.ok(ui.includes("(lookupMode==='processo'&&!processContext)"))
 assert.ok(ui.includes("product&&lookupMode==='processo'&&<BlindInventoryProcessPanel"))
 assert.ok(ui.includes('onClick={()=>void verify(p.sku)}'))
 assert.ok(ui.includes("const prior=items.find"))
 assert.ok(ui.includes("(row.processo_id||null)===(linkedProcess?.processoId||null)"))
})

test('RLS migration supports two modes without removing role and audit protections',()=>{
 const policies=(sql.match(/create policy sgq_inventario_cego_itens_(insert|update)/g)||[])
 assert.equal(policies.length,2)
 assert.ok(sql.includes("for insert to authenticated"))
 assert.ok(sql.includes("for update to authenticated"))
 assert.ok(sql.includes("private.current_sgq_role() in ('administrador','gestor','inspetor')"))
 assert.ok(sql.includes("s.status='aberto'"))
 assert.ok(sql.includes("processo_id is null"))
 assert.ok(sql.includes("processo_codigo is null"))
 assert.ok(sql.includes("cliente_nome is null"))
 assert.ok(sql.includes("cliente_confirmado is false"))
 assert.ok(sql.includes("verificacao_cadastro->>'modo'='codigo_omie'")||
   sql.includes("verificacao_cadastro->>'modo' = 'codigo_omie'"))
 assert.ok(sql.includes("processo_id is not null"))
 assert.ok(sql.includes("p.codigo=processo_codigo"))
 assert.ok(sql.includes("criado_por = (select auth.uid())"))
})
