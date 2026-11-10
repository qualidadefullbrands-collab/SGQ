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
 assert.match(ui,/const url=`\$\{apiUrl\}\/api\/inspecoes\/\$\{selectedInspectionId\}\/laudo/)
 assert.match(docs,/str\(group\.get\("subprocesso_codigo"\)\)/)
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
