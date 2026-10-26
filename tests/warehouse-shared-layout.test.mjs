import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const ui=read('src/auditorias/AuditoriasPage.tsx')
const styles=read('src/auditorias/warehouse-unified.css')
const main=read('src/App.tsx')

test('warehouse reuses same SGQ page title, metric cards, panels and list rows',()=>{
  assert.match(ui,/className="audit-page audit-integrated sgq-warehouse-workspace"/)
  assert.match(ui,/className="page-title audit-page-title"/)
  assert.match(ui,/className="metrics audit-overview"/)
  assert.match(ui,/className="metric-button/)
  assert.match(ui,/className="panel section-card audit-new-section"/)
  assert.match(ui,/audit-card row-card/)
  assert.match(ui,/className="panel queue audit-history"/)
  assert.match(ui,/className="queue-row audit-history-entry"/)
  assert.match(main,/className="page-title"/)
  assert.match(main,/className="metrics"/)
  assert.match(main,/className="panel queue"/)
})

test('warehouse does not show a second illustrated hero / redundant menu',()=>{
  assert.doesNotMatch(ui,/className="audit-hero"/)
  assert.doesNotMatch(ui,/audit-hero-art|audit-hero-rule|audit-hero-title-row/)
  assert.match(ui,/<span className="audit-contlog-brand">Contlog<\/span>/)
  assert.match(styles,/\.audit-contlog-brand\s*\{[\s\S]*?color:#d12e43/)
  assert.match(ui,/import '\.\/warehouse-unified\.css'/)
})

test('manual warehouse forms use SGQ section cards without changing operational actions',()=>{
  assert.match(ui,/className="panel section-card audit-manual-controls"/)
  assert.match(ui,/className="panel section-card audit-manual-panel"/)
  assert.match(ui,/className="panel section-card audit-manual-panel audit-evidence-section"/)
  assert.match(ui,/\['C','NC','NA'\]/)
  for(const token of ['saveManualAnswer','saveManualRecord','saveEquipment','generateWord','downloadExisting','requestFinish','uploadTemplate','deleteWarehouseInspection']){
    assert.ok(ui.includes(token),token)
  }
  for(const token of ['@media(max-width:1120px)', '@media(max-width:850px)', '@media(max-width:650px)']){
    assert.ok(styles.includes(token),token)
  }
})
