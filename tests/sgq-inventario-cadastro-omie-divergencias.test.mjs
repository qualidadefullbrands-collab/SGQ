import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const edge=read('supabase/functions/sgq-inventario-cadastro-omie/index.ts')
const component=read('src/stock/InventoryOmieComparison.tsx')
const dashboard=read('src/stock/BlindInventoryStatus.tsx')
const reconciliation=read('src/stock/BlindInventoryReconciliation.tsx')
const app=read('src/App.tsx')

test('catalogue verification is authenticated, read-only and returns actual Omie product code',()=>{
 assert.match(edge,/admin\.auth\.getUser\(authorization\.slice\(7\)\)/)
 assert.match(edge,/!profile\?\.ativo/)
 assert.match(edge,/ConsultarProduto/)
 assert.match(edge,/const real=normalizeCode\(product\.codigo\)/)
 assert.match(edge,/situacao:real===codigo\?'encontrado':'codigo_divergente'/)
 assert.match(edge,/codigoOmie:real,descricaoOmie:clean\(product\.descricao\)/)
 assert.match(edge,/nao_localizado/)
 assert.match(edge,/indisponivel/)
 assert.doesNotMatch(edge,/AlterarProduto|IncluirProduto|AjustarEstoque|InventarioAlterar/)
})

test('comparison detects code mismatch, description mismatch and missing SKUs separately',()=>{
 assert.match(component,/sgq-inventario-cadastro-omie/)
 assert.match(component,/result\?\.situacao==='codigo_divergente'/)
 assert.match(component,/desc\(result\.descricaoOmie\)!==desc\(descricao\)/)
 assert.match(component,/\['encontrado','codigo_divergente'\]\.includes\(result\.situacao\)/)
 assert.match(component,/result\?\.situacao==='nao_localizado'/)
 assert.match(component,/result\?\.situacao==='indisponivel'/)
 assert.match(component,/Descrição divergente entre o item contado/)
 assert.match(component,/O código retornado não corresponde ao SKU/)
 assert.match(component,/O código não foi encontrado pelo Omie/)
 assert.match(component,/Consulta indisponível: não foi possível determinar se há divergência/)
 assert.match(component,/if\(active>=3\)/)
})

test('inventory status shows expected local qty, counted, difference and Omie catalog consistency',()=>{
 assert.match(dashboard,/quantidade_referencia,quantidade_recontagem,referencia_fonte/)
 assert.match(dashboard,/Esperado no local:/)
 assert.match(dashboard,/Contado:/)
 assert.match(dashboard,/Diferença:/)
 assert.match(dashboard,/difference===null\?'—'/)
 assert.match(dashboard,/InventoryOmieComparison sku=\{c\.codigo_omie\} descricao=\{c\.descricao_omie\}/)
 assert.match(dashboard,/O saldo esperado da mesma localização é exibido/)
 assert.match(dashboard,/Saldo global do Omie não substitui essa referência/)
 assert.match(dashboard,/Status do inventário FST/)
})

test('reconciliation also displays the source of expected qty and live Omie discrepancy',()=>{
 assert.match(reconciliation,/Quantidade esperada · local/)
 assert.match(reconciliation,/Quantidade esperada na mesma localização/)
 assert.match(reconciliation,/InventoryOmieComparison sku=\{item\.codigo_omie\} descricao=\{item\.descricao_omie\}/)
 assert.match(reconciliation,/A quantidade esperada deve corresponder ao mesmo SKU/)
 assert.match(reconciliation,/O saldo global do Omie não é automaticamente comparável/)
})

test('navigation presents FST inventory rather than forcing blind view',()=>{
 assert.match(app,/Inventário FST · Omie/)
 assert.match(app,/Status do inventário FST/)
 assert.doesNotMatch(app,/Inventário às cegas · Omie/)
})
