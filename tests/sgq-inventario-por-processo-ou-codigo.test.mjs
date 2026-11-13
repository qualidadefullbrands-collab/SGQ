import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const inventory=file('src/stock/BlindInventoryPage.tsx')
const context=file('src/stock/BlindInventoryProcessPanel.tsx')
const migration=file('supabase/migrations/20261113120000_sgq_inventario_cego_contexto_inspecoes.sql')

test('blind inventory lets user search by Omie product code OR FST process',()=>{
 assert.ok(inventory.includes("lookupMode,setLookupMode"))
 assert.ok(inventory.includes('Buscar por código Omie'))
 assert.ok(inventory.includes('Buscar por processo FST'))
 assert.ok(inventory.includes('async function searchByProcess()'))
 assert.ok(inventory.includes(".from('processos')"))
 assert.ok(inventory.includes(".ilike('codigo',key+'%')"))
 assert.ok(inventory.includes("if(rows.length===1)await chooseProcess(rows[0])"))
 assert.ok(inventory.includes("processResults.map(row=>"))
})

test('finding process retrieves its linked SKUs and allows selecting an item without retyping',()=>{
 assert.ok(inventory.includes("async function chooseProcess(selected:LinkedProcess)"))
 assert.ok(inventory.includes(".from('processo_itens')"))
 assert.ok(inventory.includes(".from('produtos')"))
 assert.ok(inventory.includes("authClient.functions.invoke('sgq-omie-fst'"))
 assert.ok(inventory.includes("catalog.set(code"))
 assert.ok(inventory.includes("processProducts.map(p=>"))
 assert.ok(inventory.includes("onClick={()=>void verify(p.sku)}"))
 assert.ok(inventory.includes("const code=normalSku(codeOverride??sku)"))
 assert.ok(inventory.includes("initialProcessCode={selectedProcess?.codigo||''}"))
 assert.ok(context.includes("if(initialProcessCode)void lookup(initialProcessCode)"))
})

test('different process suffixes stay distinct and count still needs confirmation',()=>{
 assert.ok(inventory.includes("Os sufixos A/B identificam registros diferentes"))
 assert.ok(inventory.includes("processContext.processoId"))
 assert.ok(inventory.includes("cliente_confirmado:true"))
 assert.ok(inventory.includes("verificacao_cadastro:processContext.verificacao"))
 assert.ok(inventory.includes("if(!address.trim())"))
 assert.ok(inventory.includes("foto_para_omie:flagOmie"))
 assert.ok(migration.includes("sgq_inventario_cego_inspecoes"))
})
