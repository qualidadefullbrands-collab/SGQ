import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=read('src/App.tsx')
const queue=read('src/components/InspectionWorkQueue.tsx')
const css=read('src/components/InspectionWorkQueue.css')
const legacy=read('src/components/InspectionsKanban.tsx')

test('main inspection screen uses the Central de Inspeções instead of the old Kanban',()=>{
 assert.ok(app.includes("{tab==='quadro' && <InspectionWorkQueue"))
 assert.ok(app.includes('onOpen={id=>void openInspection(id)}'))
})
test('work queue defaults to actionable inspections and provides explicit status filters',()=>{
 assert.ok(queue.includes("useState<Filter>('ativas')"))
 for(const id of ["id:'ativas'","id:'aberta'","id:'em_andamento'","id:'concluida'","id:'todas'"])assert.ok(queue.includes(id))
 assert.ok(queue.includes('aria-pressed={filter===option.id}'))
})
test('kit membership is explicit and multiple SKUs are never inferred to be a kit',()=>{
 assert.ok(queue.includes("String(group?.tipo||'')==='kit_componentes'"))
 assert.ok(queue.includes('needsReview=products.length>1&&!isKit'))
 assert.ok(queue.includes('Kit · '))
 assert.ok(queue.includes('Relação de SKUs a confirmar'))
})
test('each queue row retains FST, entry, customer, invoice, arrival and component SKU context',()=>{
 for(const value of ['row.processCode','row.client','row.invoice','row.arrival','row.group?.subprocesso_codigo','row.products.map','Entrada {entry}','SKU independente'])
  assert.ok(queue.includes(value),value+' missing')
})
test('queue offers direct inspection actions and keeps completed result visible',()=>{
 for(const value of ['Preparar inspeção','Continuar inspeção','Ver resultado','onOpen(row.item.id)','row.item.resultado'])
  assert.ok(queue.includes(value),value+' missing')
})
test('queue supports local search and avoids drag-and-drop interactions',()=>{
 assert.ok(queue.includes('Buscar FST, cliente, SKU ou NF'))
 assert.ok(queue.includes('setQuery(event.target.value)'))
 assert.ok(!queue.includes('onDragStart='))
 assert.ok(!queue.includes('onDrop='))
 assert.ok(!queue.includes('draggable='))
})
test('queue preserves create, edit and delete permissions',()=>{
 for(const value of ['onCreate','onReuseProcess','onEditProcess','onDeleteProcess','onDeleteInspection','canDelete&&','canWrite&&','canWrite:boolean'])
  assert.ok(queue.includes(value),value+' missing')
})
test('queue is responsive on desktop, tablet and mobile',()=>{
 assert.ok(css.includes('@media(max-width:1120px)'))
 assert.ok(css.includes('@media(max-width:640px)'))
 assert.ok(css.includes('.sgq-work-row{grid-template-columns:minmax(0,1fr);gap:11px;'))
})

test('queue paginates large lists to avoid rendering every inspection at once',()=>{
 assert.ok(queue.includes('useState(50)'))
 assert.ok(queue.includes('filteredRows.slice(0,visibleLimit)'))
 assert.ok(queue.includes('processesWithoutEntry.slice(0,processLimit)'))
 assert.ok(queue.includes('Mostrar mais'))
})

test('legacy process grouping is linear rather than filtering all inspections for each process',()=>{
 assert.ok(legacy.includes('const inspectionsByProcess=useMemo'))
 assert.ok(legacy.includes('const own=inspectionsByProcess.get(process.id)||[]'))
 assert.ok(!legacy.includes("const own=inspections.filter(item=>item.status!=='cancelada'&&item.grupos_inspecao?.processo_id===process.id)"))
})
