import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=source('src/App.tsx')
const board=source('src/components/InspectionsKanban.tsx')
const api=source('backend/Sgq.Api/Program.cs')
const docs=source('server/app.py')

test('each subprocess remains a distinct inspection card in a FST-labeled lane group',()=>{
 assert.match(board,/function groupByFst\(items:Inspection\[\]\)/)
 assert.match(board,/groupByFst\(column\.items\.slice/)
 assert.match(board,/children\.map\(item=>/)
 assert.match(board,/key=\{item\.id\}/)
 assert.match(board,/sgq-kanban-independent-inspection/)
 assert.match(board,/onOpen\(item\.id\)/)
 assert.match(board,/item\.status==='concluida'/)
 assert.match(board,/draggable=\{canMoveCard\(item\)\}/)
})

test('subprocess invoice is populated from its own group, not stale parent process',()=>{
 const edit=app.split('function startEditingInspectionData()')[1]?.split('async function saveEditingInspectionData()')[0]||''
 assert.match(edit,/notaFiscal:detail\.grupos_inspecao\?\.nota_fiscal/)
 assert.match(app,/NF deste subprocesso/)
 assert.match(app,/detail\.grupos_inspecao\?\.nota_fiscal \?\? detail\.grupos_inspecao\?\.processos\?\.nota_fiscal/)
 const save=app.split('async function saveEditingInspectionData()')[1]?.split('async function suggestApplicableIt')[0]||''
 assert.match(save,/setDetail\(/)
 assert.match(save,/nota_fiscal:fastPath\?current\.grupos_inspecao\?\.nota_fiscal:editPayload\.notaFiscal/)
 assert.match(save,/setInspections\(/)
 assert.match(save,/setProcesses\(/)
 assert.match(save,/void refreshLists\(\)/)
 assert.match(save,/grupos_inspecao:r\.data\.inspecao\.grupos_inspecao/)
})

test('backend persists independent NF and shared parent fields while verifying actual patches',()=>{
 const code=api.split('app.MapPut("/api/inspecoes/{id}/dados"')[1]?.split('app.MapPost("/api/inspecoes/{id}/concluir"')[0]||''
 assert.match(code,/if\(isSubprocess\)/)
 assert.match(code,/var updatedSubprocess=await RestAsync/)
 assert.match(code,/nota_fiscal=string\.IsNullOrWhiteSpace\(input\.NotaFiscal\)/)
 assert.match(code,/var updatedParent=await RestAsync/)
 assert.match(code,/cliente=string\.IsNullOrWhiteSpace\(input\.Cliente\)/)
 assert.match(code,/FirstRow\(updatedSubprocess\)\.found/)
 assert.match(code,/FirstRow\(updatedParent\)\.found/)
})

test('all subprocesses and mandatory inspection evidence must be ready before Word or SharePoint',()=>{
 assert.match(docs,/async def process_word_status\(/)
 assert.match(docs,/if not group_rows:/)
 assert.match(docs,/row\.get\("status"\)!="concluida"/)
 assert.match(docs,/nota fiscal não informada/)
 assert.match(docs,/verificações obrigatórias incompletas/)
 assert.match(docs,/fotografias da inspeção não registradas/)
 assert.match(docs,/if not status\["ready"\]:/)
 assert.match(api,/app\.MapGet\("\/api\/processos\/\{id\}\/laudo-status"/)
 assert.match(api,/generate-process\/\{Uri\.EscapeDataString\(parentId!\)\}/)
 assert.match(app,/disabled=\{wordDownloading\|\|!wordStatus\?\.ready\}/)
 assert.match(app,/disabled=\{sharepointBusy\|\|!wordStatus\?\.ready\}/)
})
