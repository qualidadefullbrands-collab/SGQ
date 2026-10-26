import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const base = read('src/styles.css')
const audit = read('src/auditorias/auditorias.css')
const app = read('src/App.tsx')
const audits = read('src/auditorias/AuditoriasPage.tsx')

test('SGQ common design system covers the full workspace, not only the dashboard', () => {
  assert.match(base, /SGQ design system v2/)
  for (const selector of [
    '.sgq-side-nav>button',
    '.sgq-operational-shell .workspace',
    '.sgq-operational-shell .inspection-stage-tab',
    '.sgq-operational-shell .stock-table-head',
    '.sgq-operational-shell .equipment-section-tabs button',
    '.sgq-operational-shell .dimension-set-tabs button',
    '.sgq-operational-shell .compact-checklist .check-copy span',
  ]) assert.ok(base.includes(selector), selector)
  assert.match(app, /className="app-shell sgq-operational-shell"/)
  for (const tab of ['painel', 'inspecoes', 'nova', 'execucao', 'its', 'estoque', 'auditorias', 'equipamentos']) {
    assert.ok(app.includes("tab==='" + tab + "'"), tab)
  }
})

test('SGQ operational controls use readable desktop and mobile typography', () => {
  assert.match(base, /--sgq-control-height:48px/)
  assert.match(base, /font-size:16px;\s*line-height:1\.5/)
  assert.match(base, /@media\(max-width:850px\)/)
  assert.match(base, /@media\(max-width:650px\)/)
  assert.match(base, /:focus-visible/)
  assert.match(base, /login-shell \.login-card input/)
})

test('Contlog uses the same readable inspection standard and retains manual C-NC-NA inputs', () => {
  assert.match(audit, /Contlog inspection UX v2/)
  assert.match(audits, /<span className="audit-contlog-brand">Contlog<\/span>/)
  assert.match(audits, /\['C','NC','NA'\]/)
  assert.match(audit, /\.audit-manual-question span\s*\{[\s\S]*?font-size:17px/)
  assert.match(audit, /\.audit-manual-answer button\s*\{[\s\S]*?min-height:50px/)
  assert.match(audit, /\.audit-manual-observation input\s*\{[\s\S]*?font-size:16px/)
  assert.match(audit, /@media\(max-width:650px\)/)
  assert.doesNotMatch(audits, /startVoice|sendMessage|imageToDataUrl/)
})

test('visual change does not replace SGQ processes and outputs', () => {
  for (const value of ['downloadInspectionWord', 'selectInspectionStage', 'retencao', 'dimensionais', 'amostragem']) {
    assert.ok(app.includes(value), value)
  }
  for (const value of ['saveManualAnswer', 'saveManualRecord', 'generateWord', 'requestFinish']) {
    assert.ok(audits.includes(value), value)
  }
})
