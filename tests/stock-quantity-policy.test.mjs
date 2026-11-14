import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const policy = read('src/stock/StockQuantityPolicy.ts')
const recon = read('src/stock/BlindInventoryReconciliation.tsx')
const status = read('src/stock/BlindInventoryStatus.tsx')
const comparison = read('src/stock/InventoryOmieComparison.tsx')
const app = read('src/App.tsx')
const navigation = read('src/stock/StockWorkspaceNav.tsx')

test('SGQ inventory reconciliation treats Omie exclusively as product registration lookup', () => {
  assert.match(policy, /invalidQuantityReferenceSource/)
  assert.match(policy, /LOCAL_QUANTITY_SOURCES/)
  assert.match(policy, /!isApprovedLocalSource\(record\.referencia_fonte\)/)
  assert.match(policy, /if \(!record \|\| !isApprovedLocalSource\(record\.referencia_fonte\)\) return null/)
  assert.match(recon, /localQuantityReference\(row\)/)
  assert.match(status, /localQuantityReference\(review\)/)
  assert.match(recon, /action==='referencia'&&invalidQuantityReferenceSource\(source\)/)
  assert.match(recon, /action==='finalizar'&&revisions\.some\(row=>invalidQuantityReferenceSource\(row\.referencia_fonte\)\)/)
  assert.match(recon, /stats\.invalidSources>0/)
  assert.match(recon, /LOCAL_QUANTITY_SOURCES\.map/)
  assert.match(recon, /!isApprovedLocalSource\(draft\.source\)/)
  assert.match(status, /Referência física SGQ/)
  assert.doesNotMatch(recon, /saldo_omie|quantidade_omie|saldoOmie|quantidadeOmie/)
  assert.doesNotMatch(status, /saldo_omie|quantidade_omie|saldoOmie|quantidadeOmie/)
  assert.match(comparison, /codigoOmie:string\|null;descricaoOmie:string\|null/)
  assert.doesNotMatch(comparison, /saldoOmie|quantidadeOmie|saldo_omie|quantidade_omie/)
})

test('stock workspace offers a distinct local physical reconciliation workflow', () => {
  for (const mode of ['posicoes', 'cego', 'status_cegos', 'conciliacao', 'inventario']) {
    assert.ok(navigation.includes("key: '" + mode + "'"), mode)
  }
  assert.match(navigation, /Contagem física × referência local/)
  assert.match(app, /<StockWorkspaceNav/)
  assert.match(app, /A consulta ao Omie confere apenas código e descrição do produto/)
})
