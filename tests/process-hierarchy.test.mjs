import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const board=read('src/components/InspectionsKanban.tsx')
const queue=read('src/components/InspectionWorkQueue.tsx')
const app=read('src/App.tsx')
const css=read('src/components/InspectionWorkQueue.css')

test('legacy process hierarchy builds a process index in one pass',()=>{
 assert.ok(board.includes('const inspectionsByProcess=useMemo'))
 assert.ok(board.includes('const grouped=new Map<string,Inspection[]>()'))
 assert.ok(board.includes('const own=inspectionsByProcess.get(process.id)||[]'))
 assert.ok(!board.includes("const own=inspections.filter(item=>item.status!=='cancelada'&&item.grupos_inspecao?.processo_id===process.id)"))
})
test('Central de Inspeções keeps parent FST and subprocess identity separate',()=>{
 assert.ok(queue.includes('formatFst(row.processCode)'))
 assert.ok(queue.includes('Entrada {entry}'))
 assert.ok(queue.includes('row.client'))
 assert.ok(queue.includes('row.arrival'))
 assert.ok(queue.includes('row.invoice'))
})
test('product composition is displayed without flattening component SKUs',()=>{
 assert.ok(queue.includes('productsByGroup'))
 assert.ok(queue.includes('row.products.map'))
 assert.ok(queue.includes("String(group?.tipo||'')==='kit_componentes'"))
 assert.ok(queue.includes('Relação de SKUs a confirmar'))
})
test('processes without inspection entry are separated from active inspection work',()=>{
 assert.ok(queue.includes('processesWithoutEntry'))
 assert.ok(queue.includes('Processos sem entrada'))
 assert.ok(queue.includes('Criar entrada'))
})
test('main inspection route uses the new queue and retains process editing callbacks',()=>{
 const start=app.indexOf("{tab==='quadro' && <InspectionWorkQueue")
 const end=app.indexOf("{tab==='nova'",start)
 const route=app.slice(start,end)
 assert.ok(route.includes('<InspectionWorkQueue'))
 assert.ok(route.includes('onEditProcess='))
 assert.ok(route.includes('onReuseProcess='))
 assert.ok(!route.includes('<InspectionsKanban'))
})
test('editing a parent process does not replace subprocess-specific invoice data',()=>{
 const section=app.split('function editProcessFull(p:ProcessRow)')[1]?.split('const fstLookupRequest')[0]||''
 assert.ok(section.includes('setEditingProcess'))
 assert.ok(!section.includes('editInspectionFull('))
 const save=app.split('async function saveProcessEdit(e: React.FormEvent)')[1]?.split('async function deleteProcess')[0]||''
 assert.ok(save.includes('notaFiscal:null'))
})
test('Central de Inspeções is responsive and uses a compact single-column mobile row',()=>{
 assert.ok(css.includes('@media(max-width:1120px)'))
 assert.ok(css.includes('@media(max-width:640px)'))
 assert.ok(css.includes('.sgq-work-row{grid-template-columns:minmax(0,1fr)'))
})
