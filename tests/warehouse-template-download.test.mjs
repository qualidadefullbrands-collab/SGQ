import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const ui=source('src/auditorias/AuditoriasPage.tsx')
const css=source('src/auditorias/warehouse-unified.css')

test('warehouse downloads original registered documents through authenticated storage',()=>{
  assert.match(ui,/async function downloadWarehouseTemplate\(def:AuditDefinition\)/)
  assert.ok(ui.includes("supabase.storage.from('auditoria-modelos').download(template.storage_path)"))
  assert.ok(ui.includes("item.rq_code===def.code&&item.ativo&&item.storage_path"))
  assert.ok(ui.includes('link.download=template.arquivo_nome'))
  assert.ok(ui.includes("URL.revokeObjectURL(url)"))
  assert.ok(ui.includes("disabled={!template||!!templateDownloading}"))
  assert.doesNotMatch(ui,/storage\/v1\/object\/public\/auditoria-modelos/)
})

test('all warehouse model cards are visible for authenticated users',()=>{
  assert.ok(ui.includes('aria-label="Baixar documentos oficiais do armazém"'))
  assert.match(ui,/AUDIT_DEFINITIONS\.map\(def=>/)
  assert.ok(ui.includes('Baixar DOCX'))
  assert.ok(css.includes('.audit-download-grid'))
})
