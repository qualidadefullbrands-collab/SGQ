import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=read('src/App.tsx')
const board=read('src/components/InspectionsKanban.tsx')
const css=read('src/components/InspectionsKanban.css')

test('inspection board has explicit status lanes and no drag-dependent workflow',()=>{
 for(const [status,label] of [['aberta','Não iniciadas'],['em_andamento','Em andamento'],['concluida','Concluídas']]){
  assert.ok(board.includes("status:'"+status+"'"))
  assert.ok(board.includes("label:'"+label+"'"))
 }
 assert.match(board,/columnsToShow=useMemo/)
 assert.match(board,/items:visible\.filter\(i=>i\.status===c\.status\)/)
 assert.match(board,/i\.status!=='cancelada'/)
 assert.doesNotMatch(board,/label:'Canceladas'/)
 assert.match(board,/column\.items\.slice\(/)
 assert.match(board,/shownByLane/)
 assert.match(board,/Ver mais/)
 assert.doesNotMatch(board,/onDragStart|onDragOver|onDrop|draggable=/)
})

test('Kanban cards separate FST, entry, customer, SKUs and inspection actions',()=>{
 assert.match(board,/sgq-kanban-fst/)
 assert.match(board,/sgq-kanban-entry/)
 assert.match(board,/sgq-kanban-card-products/)
 assert.match(board,/linkedItemsByGroup/)
 assert.match(board,/sgq-kit-type/)
 assert.match(board,/Revisar/)
 assert.match(board,/Conjunto · \{products\.length\} SKUs/)
 assert.match(board,/Abrir inspeção/)
 assert.match(board,/Continuar inspeção/)
 assert.match(board,/Iniciar inspeção/)
 assert.match(board,/Voltar para não iniciada/)
 assert.doesNotMatch(board,/\{item\.numero\}<\/span>/)
})

test('process hierarchy remains a separate view with direct entry actions',()=>{
 assert.match(board,/useState<'processos'\|'kanban'>\(initialView\)/)
 assert.match(board,/view==='processos'\?'Processos':'Inspeções'/)
 assert.match(board,/processTree=useMemo\(/)
 assert.match(board,/processes\.map\(process=>/)
 assert.match(board,/grupos_inspecao\?\.processo_id===process\.id/)
 assert.match(board,/sgq-process-node/)
 assert.match(board,/sgq-process-children/)
 assert.match(board,/Entrada \{sub\.letter/)
 assert.match(board,/onOpen\(item\.id\)/)
 assert.match(board,/onReuseProcess\(process\.id\)/)
})

test('search is local to the inspection workspace and includes SKU and customer',()=>{
 assert.match(board,/className="sgq-kanban-search"/)
 assert.match(board,/Buscar FST, cliente, SKU ou NF/)
 assert.match(board,/setQuery\(e\.target\.value\)/)
 assert.match(board,/\.\.\.products\.flatMap\(x=>\[x\.sku,x\.descricao\]\)/)
 assert.match(board,/process\?\.cliente/)
 assert.doesNotMatch(app,/id="sgq-global-search"/)
})

test('Kanban preserves create, open, edit and deletion permissions',()=>{
 for(const callback of ['onOpen','onCreate','onReuseProcess','onEditProcess','onDeleteProcess','onDeleteInspection'])
  assert.ok(board.includes(callback),callback+' missing')
 assert.match(board,/onDeleteInspection\(inspection\.id\)/)
 assert.match(board,/onDeleteProcess\(process\.id\)/)
 assert.match(board,/canDelete&&/)
 assert.match(board,/disabled=\{deletingProcessId!==null\}/)
})

test('inspection status changes use explicit accessible buttons instead of drag and drop',()=>{
 assert.match(board,/canMoveCard/)
 assert.match(board,/onMove\?\.\(id,target\)/)
 assert.match(board,/type="button" disabled=\{!!movingInspectionId\}/)
 assert.match(board,/aria-label=\{'Amostragem '/)
 assert.match(board,/role="progressbar"/)
})

test('Kanban and process hierarchy are responsive with reduced-motion support',()=>{
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
 assert.match(css,/@media\(max-width:1180px\)/)
 assert.match(css,/@media\(max-width:760px\)/)
 assert.match(css,/prefers-reduced-motion/)
 assert.match(css,/\.sgq-kanban-card:hover/)
 assert.match(css,/\.sgq-kanban-search/)
})
