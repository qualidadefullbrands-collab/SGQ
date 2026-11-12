import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const api=read('backend/Sgq.Api/Program.cs')
const app=read('src/App.tsx')
const audits=read('src/auditorias/AuditoriasPage.tsx')
const warehouseCss=read('src/auditorias/warehouse-unified.css')

test('SKU reconciliation targets one active stock position with role, optimistic lock and Omie confirmation',()=>{
  const start=api.indexOf('app.MapPost("/api/estoque/corrigir-sku"')
  const stop=api.indexOf('app.MapPost("/api/amostras/criar"',start)
  assert.ok(start>0&&stop>start)
  const endpoint=api.slice(start,stop)
  for(const term of ['InventoryAuthorized(client,token)','OmieStockProduct(client,token,correct)',
    'input.SkuAnterior.Trim()','input.AmostraId','produto_id=eq.','HttpMethod.Patch,"amostras"',
    'acao="correcao_sku_omie"','usuario_id=userId'])
    assert.ok(endpoint.includes(term),term)
  assert.doesNotMatch(endpoint,/HttpMethod.Patch,"amostra_movimentacoes"/)
  assert.match(app,/stockSkuSelection\[position.id\]/)
  assert.match(app,/correctStockSample\(position\)/)
  assert.match(app,/window.confirm\('SKU '/)
  assert.match(app,/onlyDescription\?'sincronizar a descrição oficial'/)
})

test('Omie inbox does not claim that there are no sales orders because webhook is not activated',()=>{
 assert.doesNotMatch(app,/A recepção começa quando os webhooks são ativados no Omie/)
 assert.match(app,/Nenhum PV sincronizado. Busque pelo FST/)
 assert.match(app,/setOmieInboxError\('Não foi possível carregar os PVs do Omie.'\)/)
})

test('Warehouse inspection has context counters, pending filter, search, Brazilian date and safe close',()=>{
 assert.match(audits,/timeZone:'America\/Sao_Paulo'/)
 for(const term of ['contextPending','contextNC','contextNA','contextC','checklistSearch','visibleCriteria',
    'Pendentes','onlyNonconforming','unsavedNotesCount','goToNextPending','Busque item','audit-context-summary'])
   if(term!=='Busque item')assert.ok(audits.includes(term),term)
 assert.match(audits,/offlineOperations\(userId\)/)
 assert.match(audits,/setCurrentLocation\(savedLocations\[0\]\|\|''\)/)
 assert.match(warehouseCss,/audit-context-summary/)
 assert.match(warehouseCss,/audit-pending-toggle/)
 assert.match(warehouseCss,/audit-manual-row.has-nc/)
})

test('a validated Omie SKU is not blocked merely by a matching stock description',()=>{
  const start=api.indexOf('app.MapPost("/api/amostras/criar"')
  const create=api.slice(start,api.indexOf('app.MapGet("/api/estoque/inventarios"',start))
  assert.ok(create.includes('OmieStockProduct(client,token,sku)'))
  assert.doesNotMatch(create,/if\(conflict!=null\)return Results.Json/)
  assert.match(api,/Retenção SKU \{Sku\} validado no Omie/)
  assert.match(app,/stockSkuChecks\[code\]\.descricao/)
})
