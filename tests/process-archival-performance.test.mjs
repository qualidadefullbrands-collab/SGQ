import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=src('src/App.tsx')
const api=src('backend/Sgq.Api/Program.cs')
const get=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))
const deletionUI=get(app,'async function deleteProcess(', 'async function deleteInspection(')
const refreshUI=get(app,'async function refreshLists(', 'async function lookupFstClient(')
const deleteRoute=get(api,'app.MapPost("/api/processos/{id}/excluir"', 'app.MapPost("/api/inspecoes/{id}/excluir"')
const listRoute=get(api,'app.MapGet("/api/app/listas"', 'app.MapGet("/api/inspecoes/{id}/fotos/links"')
const bootRoute=get(api,'app.MapGet("/api/app/bootstrap"', 'app.MapGet("/api/app/catalogos"')
const catRoute=get(api,'app.MapGet("/api/app/catalogos"', 'app.MapGet("/api/app/estoque"')

test('process deletion is single-flight and disables duplicate clicks',()=>{
 assert.match(app,/processDeletionLock=useRef<string\|null>\(null\)/)
 assert.match(deletionUI,/if \(!canDelete \|\| processDeletionLock\.current\) return/)
 assert.match(deletionUI,/processDeletionLock\.current=p\.id/)
 assert.match(deletionUI,/finally \{\s*processDeletionLock\.current=null/)
 assert.match(app,/disabled=\{deletingProcessId!==null\}/)
 assert.match(deletionUI,/setDeletingProcessId\(p\.id\)/)
})
test('process deletion immediately removes its cards, linked inspections, and related group from UI',()=>{
 assert.match(deletionUI,/setProcesses\(current=>current\.filter\(row=>row\.id!==p\.id\)\)/)
 assert.match(deletionUI,/setInspections\(current=>current\.filter\(row=>row\.grupos_inspecao\?\.processo_id!==p\.id\)\)/)
 assert.match(deletionUI,/setGroups\(current=>current\.filter\(row=>row\.processo_id!==p\.id\)\)/)
 assert.match(deletionUI,/setSelectedInspectionId\(null\)/)
 assert.match(deletionUI,/setDetail\(null\)/)
 assert.doesNotMatch(deletionUI,/void refreshLists\(\)\s*\n  \}/)
 assert.match(deletionUI,/listRefreshSequence\.current\+\+/)
 assert.match(deletionUI,/loadSequence\.current\+\+/)
})
test('older network responses cannot reintroduce deleted processes',()=>{
 assert.match(refreshUI,/const refreshId=\+\+listRefreshSequence\.current/)
 assert.match(refreshUI,/refreshId!==listRefreshSequence\.current/)
 assert.match(refreshUI,/version!==loadSequence\.current/)
 assert.match(deletionUI,/listRefreshSequence\.current\+\+/)
})
test('server filters archived process inspections from BOTH bootstrap and refresh',()=>{
 assert.match(api,/List<JsonElement> OperationalInspections\(JsonElement\? activeProcesses, JsonElement\? inspections\)/)
 assert.match(api,/activeIds\.Contains\(processId\.GetString\(\) \?\? ""\)/)
 assert.match(bootRoute,/inspections=OperationalInspections\(processesTask\.Result,inspectionsTask\.Result\)/)
 assert.match(listRoute,/inspections=OperationalInspections\(processes\.Result,inspections\.Result\)/)
})
test('server filters groups of archived processes without additional DB roundtrip',()=>{
 assert.match(api,/List<JsonElement> OperationalGroups\(JsonElement\? groups\)/)
 assert.match(catRoute,/processos\(codigo,cliente,excluido_em\)/)
 assert.match(catRoute,/groups=OperationalGroups\(groups\.Result\)/)
})
test('process archival preserves audit while handling subsequent audit failure accurately',()=>{
 assert.match(deleteRoute,/excluido_em=is\.null/)
 assert.match(deleteRoute,/return=representation/)
 assert.match(deleteRoute,/alreadyExcluded=true/)
 assert.match(deleteRoute,/auditRecorded=false/)
 assert.match(deleteRoute,/app\.Logger\.LogError/)
 assert.match(deletionUI,/deleted\.data\.auditRecorded===false/)
})
test('grouping inspector cards is linear instead of per-process repeated array scans',()=>{
 assert.match(app,/const inspectionsByProcess=useMemo\(/)
 assert.match(app,/new Map<string,InspectionRow\[\]>\(\)/)
 assert.match(app,/inspectionsByProcess\.get\(p\.id\)\?\?\[\]/)
})
