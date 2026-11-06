import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const equipment=read('src/equipamentos/EquipmentPage.tsx')

function between(text,start,end){
  const offset=text.indexOf(start)
  assert.notEqual(offset,-1,'Missing modal '+start)
  const finish=end?text.indexOf(end,offset+start.length):-1
  return text.slice(offset,finish<0?undefined:finish)
}

test('edit inspection popup never closes from outside click and still has an explicit X',()=>{
  const modal=between(app,'{editingInspectionData && (','{editingProcess && (')
  assert.match(modal,/<div className="modal-backdrop">/)
  assert.doesNotMatch(modal,/<div className="modal-backdrop"[^>]*onClick/)
  assert.match(modal,/<button className="close"[^>]*onClick=\{\(\)=>setEditingInspectionData\(null\)\}>×<\/button>/)
  assert.match(modal,/Salvar alterações/)
})

test('edit FST popup requires X or saving, never an outside click',()=>{
  const modal=between(app,'{editingProcess && (','{omieOrderPickerOpen &&')
  assert.match(modal,/<div className="modal-backdrop">/)
  assert.doesNotMatch(modal,/<div className="modal-backdrop"[^>]*onClick/)
  assert.match(modal,/onClick=\{\(\)=>setEditingProcess\(null\)\}>×<\/button>/)
  assert.match(modal,/onSubmit=\{saveProcessEdit\}/)
})

test('IT review, stock form and pending popup preserve their contents on backdrop clicks',()=>{
  const review=between(app,'{itReview && (','{tab===\'estoque\'')
  assert.match(review,/<div className="modal-backdrop">/)
  assert.doesNotMatch(review,/<div className="modal-backdrop"[^>]*onClick/)
  assert.match(review,/onClick=\{\(\)=>setItReview\(null\)\}>×<\/button>/)

  const stock=between(app,'{selectedSample && (','{editingInspectionData && (')
  assert.match(stock,/<div className="modal-backdrop stock-drawer-backdrop">/)
  assert.doesNotMatch(stock,/stock-drawer-backdrop"[^>]*onClick/)
  assert.match(stock,/onClick=\{\(\)=>setSelectedSample\(null\)\}>×<\/button>/)

  const pending=between(app,'{!!pendingModal.length && (','</main>')
  assert.match(pending,/<div className="modal-backdrop">/)
  assert.doesNotMatch(pending,/<div className="modal-backdrop"[^>]*onClick/)
  assert.match(pending,/onClick=\{\(\)=>setPendingModal\(\[\]\)\}>×<\/button>/)
})

test('equipment editor and maintenance forms do not dismiss by backdrop or Escape',()=>{
  const history=between(equipment,'{selected&&<div className="modal-backdrop equipment-history-backdrop"','{editing&&')
  assert.match(history,/<div className="modal-backdrop equipment-history-backdrop" role="presentation">/)
  assert.doesNotMatch(history,/equipment-history-backdrop"[^>]*onClick/)
  assert.match(history,/aria-label="Fechar histórico do equipamento"[^>]*>×<\/button>/)
  const editor=between(equipment,'{editing&&<div className="modal-backdrop"')
  assert.match(editor,/\{editing&&<div className="modal-backdrop"><form/)
  assert.doesNotMatch(editor,/<div className="modal-backdrop"[^>]*onClick/)
  assert.match(editor,/onClick=\{\(\)=>setEditing\(null\)\}>×<\/button>/)
  assert.doesNotMatch(equipment,/onEscape=|event\.key==='Escape'&&.*setSelected/)
})
