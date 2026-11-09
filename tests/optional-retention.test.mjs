import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=file('src/App.tsx')
const backend=file('backend/Sgq.Api/Program.cs')
const report=file('server/app.py')

test('inspection completion does not require or prompt for retention',()=>{
  const finish=app.split("async function finishInspection(result:")[1]?.split("async function saveRetention()")[0]||''
  assert.match(finish,/Inspeção finalizada\. A retenção de amostras é opcional/)
  assert.doesNotMatch(finish,/Agora defina a retenção/)
  assert.match(app,/\['retencao','Retenção \(opcional\)'/)
  assert.match(app,/Pular retenção e voltar aos processos/)
  assert.match(app,/Esta etapa não é obrigatória/)
})

test('retention is opt-in for new products and preserves existing stock records',()=>{
  assert.match(app,/retention\[item\.id\]=\{retain:!!existing/)
  assert.match(app,/const draft=retentionRows\[item\.id\] \|\| \{retain:false/)
  assert.match(app,/checked=\{existing\?true:draft\.retain\}/)
  assert.match(app,/Registrar sem retenção \(opcional\)/)
})

test('user can explicitly record no retention without explaining why',()=>{
  const ui=app.split('async function saveRetention()')[1]?.split('async function structureItVersion')[0]||''
  assert.doesNotMatch(ui,/if \(!retentionReason\.trim\(\)\) return/)
  assert.match(ui,/motivoSemRetencao:retentionReason\.trim\(\),itens:\[\]/)
  const endpoint=backend.split('app.MapPost("/api/inspecoes/{id}/retencao"')[1]?.split('app.MapGet("/api/amostras/{id}/detalhe"')[0]||''
  assert.doesNotMatch(endpoint,/Informe o motivo para não reter amostra/)
  assert.match(endpoint,/var note=string\.IsNullOrWhiteSpace\(input\.MotivoSemRetencao\)/)
  assert.match(endpoint,/retencao_decisao=false,retencao_motivo=note/)
  assert.match(endpoint,/FirstRow\(updated\)\.found/)
})

test('Word readiness does not depend on voluntary sample-retention decision',()=>{
  assert.match(report,/async def process_word_status\(/)
  const block=report.split('async def process_word_status(')[1]?.split('@app.get("/process-report-status/')[0]||''
  assert.doesNotMatch(block,/retencao_decisao|retencao_motivo|retained/)
  assert.match(app,/disabled=\{wordDownloading\}/)
  assert.match(app,/id="sgq-word-pendencias"/)
  assert.match(app,/Gerar Word do FST/)
})
