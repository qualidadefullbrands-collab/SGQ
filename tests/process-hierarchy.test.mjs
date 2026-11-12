import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const board=read('src/components/InspectionsKanban.tsx')
const app=read('src/App.tsx')
const css=read('src/components/InspectionsKanban.css')

test('process view is the default and shows the real parent FST hierarchy',()=>{
 assert.match(board,/useState<'processos'\|'kanban'>\(initialView\)/)
 assert.match(board,/initialView='processos'/)
 assert.match(board,/processTree=useMemo\(/)
 assert.match(board,/processes\.map\(process=>/)
 assert.match(board,/grupos_inspecao\?\.processo_id===process\.id/)
 assert.match(board,/sgq-process-node/)
 assert.match(board,/sgq-process-children/)
 assert.match(board,/\{processLabel\}\{sub\.letter\?'-'\+sub\.letter:''\}/)
 assert.match(board,/Chegada ao CD:/)
 assert.match(board,/sgq-subprocess-products/)
 assert.match(board,/sub\.invoice\?'NF '/)
 assert.match(board,/sub\.items\.map\(item=>/)
 assert.match(board,/onOpen\(item\.id\)/)
})

test('legacy records and future subprocesses are grouped by existing database keys, not duplicated',()=>{
 assert.match(board,/const key=group\?\.id\|\|letter\|\|item\.id/)
 assert.match(board,/groups\.get\(key\)/)
 assert.match(board,/prior\.items\.push\(item\)/)
 assert.match(board,/const active=inspections\.filter\(item=>item\.status!=='cancelada'\)/)
 assert.match(board,/onReuseProcess\(process\.id\)/)
 assert.match(board,/Nenhum subprocesso cadastrado/)
 assert.match(board,/processTree\.map\(\(entry,index\)=>/)
})

test('Kanban workflow remains accessible without flattening process view',()=>{
 assert.match(board,/setView\('kanban'\)/)
 assert.match(board,/aria-pressed=\{view==='kanban'\}/)
 assert.match(board,/mode==='panel'\|\|view==='kanban'/)
 for(const label of ['Não iniciadas','Em andamento','Concluídas'])assert.ok(board.includes(label))
 assert.match(board,/onMove\?\.\(id,target\)/)
 assert.match(board,/onDrop=/)
 assert.match(board,/onDeleteInspection\(inspection\.id\)/)
})

test('edit parent FST does not change child invoice or redirect to open inspection',()=>{
 const section=app.split('function editProcessFull(p:ProcessRow)')[1]?.split('const fstLookupRequest')[0]||''
 assert.match(section,/setEditingProcess\(\{\.\.\.p,nota_fiscal:null\}\)/)
 assert.doesNotMatch(section,/editInspectionFull\(/)
 const save=app.split('async function saveProcessEdit(e: React.FormEvent)')[1]?.split('async function deleteProcess')[0]||''
 assert.match(save,/notaFiscal:null/)
 assert.match(app,/focusProcessId=\{focusedProcessId\}/)
 assert.match(app,/focusProcessId=\{focusedProcessId\}/)
 assert.match(app,/onEditProcess=\{id=>\{const process=processes\.find/)
})

test('hierarchy renders as compact responsive process and subprocess cards',()=>{
 assert.match(css,/\.sgq-process-node-heading/)
 assert.match(css,/\.sgq-subprocess-node-heading/)
 assert.match(css,/\.sgq-subprocess-inspection/)
 assert.match(css,/max-width:650px/)
 assert.match(board,/aria-expanded=\{expanded\}/)
 assert.match(board,/aria-controls=\{'sgq-process-children-'/)
})
