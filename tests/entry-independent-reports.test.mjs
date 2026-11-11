import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const api=read('backend/Sgq.Api/Program.cs')
const docs=read('server/app.py')
const ui=read('src/App.tsx')
const board=read('src/components/InspectionsKanban.tsx')
const photos=read('src/mobile/MobileFotos.tsx')
const editor=read('src/its/ItEditorDemo.tsx')

test('each SGQ entry can validate and generate its own report',()=>{
 assert.match(docs,/async def process_word_status\([^\n]*group_id:str\|None=None\)/)
 assert.match(docs,/groups=\[group for group in groups if group\["id"\]==group_id\]/)
 assert.match(docs,/process_word_status\(client,token,process\["id"\],group_id\)/)
 assert.match(api,/request\.Query\["entrada"\]/)
 assert.match(api,/statusUrl\+="\?entrada="/)
 // API retains isolated reports for explicitly independent future entries.
 assert.match(api,/app\.MapPost\("\/api\/inspecoes\/\{id\}\/laudo"/)
 // But current A/B legacy entries must remain consolidated under the parent FST.
 assert.match(ui,/const consolidated=Boolean\(parentId&&detail\.grupos_inspecao\?\.subprocesso_codigo\)/)
 assert.match(ui,/const url=consolidated/)
 assert.match(ui,/api\/processos\/\$\{encodeURIComponent\(parentId!\)\}\/laudo/)
 assert.match(ui,/const collectionName=consolidated\?'':askCollectionName\(\)/)

 assert.match(docs,/str\(group\.get\("subprocesso_codigo"\)\)/)
})

test('legacy A and B use full FST readiness and one combined Word',()=>{
 const refresh=ui.split('async function refreshWordStatus()')[1]?.split('function reflectCompletedEdit()')[0]||''
 assert.match(refresh,/\+encodeURIComponent\(processId\)\+'\/laudo-status'/)
 assert.doesNotMatch(refresh,/entrada=/)
 const auto=ui.split('useEffect\(\(\)=>\{\n    const processId=detail\?\.grupos_inspecao\?\.processo_id')[1]?.split('const \[finalObservation')[0]||''
 assert.doesNotMatch(auto,/entrada=/)
 assert.match(docs,/for group in groups\[1:\]:/)
 assert.match(docs,/append_filled_inspection_form\(doc,filled\.body\)/)
 assert.match(docs,/consolidated_report_filename\(/)
})

test('multiple SKUs are not presumed a kit',()=>{
 assert.match(api,/var distinctSkuCount=items.Select/)
 assert.match(api,/distinctSkuCount>1&&!input\.EhConjunto/)
 assert.match(api,/var isComponentSet = input\.EhConjunto && distinctSkuCount > 1;/)
 assert.match(ui,/ehConjunto:isComponentSet/)
 assert.match(ui,/Os SKUs desta entrada formam um conjunto/)
})

test('SGQ entry names, photo theme, and editable IT interface are preserved',()=>{
 assert.match(board,/Novo Processo/)
 assert.match(board,/Nova Entrada/)
 assert.match(photos,/sgq-mobile-photo sgq-operational-shell/)
 assert.match(editor,/Em Revisão/)
 assert.match(editor,/Rascunho/)
 assert.doesNotMatch(editor,/Editor de IT · Demonstração com documento oficial/)
 assert.doesNotMatch(editor,/Nenhum ajuste salva ou publica a IT original/)
})
