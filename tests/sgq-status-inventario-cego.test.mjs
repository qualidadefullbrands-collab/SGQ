import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const ui=read('src/stock/BlindInventoryStatus.tsx')
const app=read('src/App.tsx')
const navigation=read('src/stock/StockWorkspaceNav.tsx')

test('SGQ has dedicated blind-inventory status tab and direct navigation',()=>{
 assert.match(app,/import BlindInventoryStatus/)
 assert.match(app,/status_cegos/)
 assert.match(navigation,/Acompanhamento/)
 assert.match(ui,/Status do inventário FST/)
 assert.match(app,/stockMode==='status_cegos'&&<BlindInventoryStatus/)
 assert.match(app,/onOpenCount=\{\(\)=>setStockMode\('cego'\)\}/)
 assert.match(app,/onOpenReconciliation=\{\(\)=>setStockMode\('conciliacao'\)\}/)
})

test('status summarizes each FST inventory location and stage with real records',()=>{
 for(const required of [
  'processo_codigo','endereco','status','codigo','cliente_nome','nf_entrada','criado_em','fechado_em'
 ])assert.ok(ui.includes(required),required)
 assert.match(ui,/\.from\('sgq_inventarios_cegos'\)/)
 assert.match(ui,/\.from\('sgq_inventario_cego_itens'\)/)
 assert.match(ui,/\.from\('sgq_inventario_cego_imagens'\)/)
 assert.match(ui,/\.from\('sgq_inventario_conciliacoes'\)/)
 assert.match(ui,/\.from\('sgq_inventario_conciliacao_itens'\)/)
 assert.match(ui,/\.range\(page\*500,page\*500\+499\)/)
 assert.match(ui,/filter==='foto_erro'/)
 assert.match(ui,/filter==='analise'/)
 assert.match(ui,/filter==='concluida'/)
})

test('status makes failed photo delivery explicit without hiding stored counts',()=>{
 assert.match(ui,/status==='sincronizada'/)
 assert.match(ui,/status==='erro'/)
 assert.match(ui,/status==='pendente'/)
 assert.match(ui,/status==='enviando'/)
 assert.match(ui,/photo\?\.erro/)
 assert.match(ui,/O arquivo e a contagem estão preservados/)
 assert.match(ui,/Reenviar foto na tela de contagem/)
})

test('status reports counts without fabricating planned SKU coverage or moving stock',()=>{
 assert.match(ui,/Itens contados representam registros realizados, não percentual de cobertura/)
 assert.match(ui,/A referência de quantidade é física e local ao SGQ/)
 assert.match(ui,/Nenhum saldo é movimentado nesta tela/)
 assert.doesNotMatch(ui,/authClient\.rpc\(/)
 assert.doesNotMatch(ui,/\.insert\(|\.update\(|\/api\/estoque\/inventarios.*aplicar/)
})
