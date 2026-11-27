import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const board=read('src/components/InspectionsKanban.tsx')
const app=read('src/App.tsx')
const css=read('src/components/InspectionsKanban.css')

test('process view shows parent FST, entry letter, customer and CD arrival separately',()=>{
 assert.match(board,/useState<'processos'\|'kanban'>\(initialView\)/)
 assert.match(board,/initialView='processos'/)
 assert.match(board,/processTree=useMemo\(/)
 assert.match(board,/processes\.map\(process=>/)
 assert.match(board,/inspectionsByProcess\.get\(process\.id\)/)
 assert.match(board,/sgq-process-node/)
 assert.match(board,/sgq-process-children/)
 assert.match(board,/processLabel/)
 assert.match(board,/Entrada \{sub\.letter/)
 assert.match(board,/Chegada ao CD:/)
 assert.match(board,/sgq-subprocess-products/)
 assert.match(board,/sub\.invoice\?'NF '/)
 assert.match(board,/sub\.items\.map\(item=>/)
 assert.match(board,/onOpen\(item\.id\)/)
})

test('existing group IDs preserve one inspection per set without flattening component SKUs',()=>{
 assert.match(board,/const key=group\?\.id\|\|letter\|\|item\.id/)
 assert.match(board,/groups\.get\(key\)/)
 assert.match(board,/prior\.items\.push\(item\)/)
 assert.match(board,/linkedItemsByGroup/)
 assert.match(board,/groupTypeById/)
 assert.match(board,/groupType==='kit_componentes'/)
 assert.match(board,/products\.length>1&&!isKit/)
 assert.match(board,/Revisar SKUs/)
 assert.match(board,/onReuseProcess\(process\.id\)/)
})

test('Kanban workflow is accessible through buttons and does not depend on drag',()=>{
 assert.match(board,/setView\('kanban'\)/)
 assert.match(board,/aria-pressed=\{view==='kanban'\}/)
 assert.match(board,/mode==='panel'\|\|view==='kanban'/)
 for(const label of ['Não iniciadas','Em andamento','Concluídas'])assert.ok(board.includes(label))
 assert.match(board,/onMove\?\.\(id,target\)/)
 assert.match(board,/Iniciar inspeção/)
 assert.match(board,/Voltar para não iniciada/)
 assert.doesNotMatch(board,/onDragStart|onDragOver|onDrop|draggable=/)
 assert.match(board,/onDeleteInspection\(inspection\.id\)/)
})

test('editing the parent process does not change child invoice or redirect to an open inspection',()=>{
 const section=app.split('function editProcessFull(p:ProcessRow)')[1]?.split('const fstLookupRequest')[0]||''
 assert.match(section,/setEditingProcess/)
 assert.doesNotMatch(section,/editInspectionFull\(/)
 const save=app.split('async function saveProcessEdit(e: React.FormEvent)')[1]?.split('async function deleteProcess')[0]||''
 assert.match(save,/notaFiscal:null/)
 assert.match(app,/focusProcessId=\{focusedProcessId\}/)
 assert.match(app,/onEditProcess=\{id=>\{const process=processes\.find/)
})

test('hierarchy is compact, searchable and responsive',()=>{
 assert.match(css,/\.sgq-process-node-heading/)
 assert.match(css,/\.sgq-subprocess-node-heading/)
 assert.match(css,/\.sgq-subprocess-inspection/)
 assert.match(css,/max-width:760px/)
 assert.match(board,/className="sgq-kanban-search"/)
 assert.match(board,/aria-expanded=\{expanded\}/)
 assert.match(board,/aria-controls=\{'sgq-process-children-'/)
})
