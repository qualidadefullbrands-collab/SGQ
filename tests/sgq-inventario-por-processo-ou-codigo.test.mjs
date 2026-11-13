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
 assert.ok(inventory.includes("cliente_confirmado:!!linkedProcess"))
 assert.ok(inventory.includes("verificacao_cadastro:linkedProcess?.verificacao"))
 assert.ok(inventory.includes("if(!address.trim()||!locations.includes(address))"))
 assert.ok(inventory.includes("foto_para_omie:flagOmie"))
 assert.ok(migration.includes("sgq_inventario_cego_inspecoes"))
})

test('physical location is selected from registered Rua or Armário addresses',()=>{
 assert.ok(inventory.includes("authClient.from('amostras').select('endereco')"))
 assert.ok(inventory.includes("authClient.from('localizacoes_estoque').select('codigo,armario')"))
 assert.ok(inventory.includes("<label>Rua ou armário *"))
 assert.ok(inventory.includes("locations.map(local=><option"))
 assert.ok(inventory.includes("locations.includes(address)"))
 assert.ok(!inventory.includes("Endereço físico / código de localização"))
 assert.ok(!inventory.includes("<label>Prateleira"))
 assert.ok(!inventory.includes("<label>Caixa / posição"))
 assert.ok(!inventory.includes("setPrateleira"))
 assert.ok(!inventory.includes("setCaixa"))
})
test('inventory form removes redundant photo and ERP explanatory text',()=>{
 assert.ok(!inventory.includes("Fotografe ou envie da galeria."))
 assert.ok(!inventory.includes("A foto será enviada ao catálogo somente após validação"))
 assert.ok(!inventory.includes("O saldo do ERP não será alterado."))
 assert.ok(inventory.includes("Fotografar produto")||inventory.includes("Tirar foto"))
 assert.ok(inventory.includes("Enviar foto do dispositivo"))
})
