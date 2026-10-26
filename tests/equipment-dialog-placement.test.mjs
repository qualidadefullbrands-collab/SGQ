import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const equipment=read('src/equipamentos/EquipmentPage.tsx')
const style=read('src/styles.css')
const warehouse=read('src/auditorias/warehouse-unified.css')

test('equipment history and all event types are inside an accessible popup',()=>{
  assert.match(equipment,/selected&&<div className="modal-backdrop equipment-history-backdrop"/)
  assert.match(equipment,/className="sample-detail panel section-card equipment-history" role="dialog" aria-modal="true"/)
  assert.match(equipment,/aria-labelledby="equipment-history-title"/)
  assert.match(equipment,/<h2 id="equipment-history-title">Histórico do equipamento<\/h2>/)
  assert.match(equipment,/className="equipment-section-tabs"/)
  for(const label of ['Verificação de rotina','Manutenção','Calibração','Histórico']) assert.ok(equipment.includes(label))
  assert.match(equipment,/onSubmit=\{saveEvent\}/)
  assert.match(equipment,/onClick=\{e=>e.stopPropagation\(\)\}/)
})

test('popup opens toward viewport top and stays scrollable on compact screens',()=>{
  assert.match(style,/\.sgq-operational-shell > \.workspace\s*\{\s*animation:none!important/)
  assert.match(style,/\.modal-backdrop:not\(\.stock-drawer-backdrop\)/)
  assert.match(style,/justify-content:flex-start/)
  assert.match(style,/overflow-y:auto/)
  assert.match(style,/max-height:calc\(100dvh/)
  assert.match(style,/\.equipment-history-backdrop > \.equipment-history\.panel\.section-card/)
  assert.match(style,/\.equipment-history \.equipment-event-form/)
  assert.match(warehouse,/\.sgq-operational-shell \.audit-modal-backdrop/)
  assert.match(warehouse,/justify-content:flex-start/)
})

test('saving equipment or history does not change persistence endpoints',()=>{
  assert.match(equipment,/authClient\.from\('sgq_equipamentos'\)/)
  assert.match(equipment,/authClient\.from\('sgq_equipamento_eventos'\)/)
  assert.match(equipment,/setSelected\(''\);setNotice\('Equipamento salvo\.'\)/)
})
