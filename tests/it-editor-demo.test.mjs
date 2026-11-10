import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const editor=read('src/its/ItEditorDemo.tsx')
const css=read('src/its/ItEditorDemo.css')

test('Nova IT editor is opt-in alongside the existing IT library',()=>{
 assert.match(app,/const ItEditorDemo=lazy\(\(\)=>import\('\.\/its\/ItEditorDemo'\)\)/)
 assert.match(app,/const \[itDemoOpen,setItDemoOpen\]=useState\(false\)/)
 assert.match(app,/Nova IT/)
 assert.match(app,/itDemoOpen \? \(/)
 assert.match(app,/<ItEditorDemo officialVersions=\{itVersions\.filter/)
 assert.match(app,/onSubmit=\{uploadIt\}/)
 assert.match(app,/itVersions\.map/)
})
test('editor has document identity and separate Word and editable structure views',()=>{
 for(const part of ['cabecalho','caderno','criterios','rodape']){
  assert.ok(editor.includes("key:'"+part+"'"),part)
 }
 for(const text of ['Inserir logotipo','Conteúdo textual da IT','Inserir imagem técnica','Tabela de especificações','Adicionar critério','Rodapé e controle documental','Documento oficial (Word)','Estrutura editável','Verificações','Análises dimensionais','Testes especiais']){
  assert.ok(editor.includes(text),text)
 }
 assert.match(editor,/<OfficialWordPreview/)
 assert.match(editor,/previewMode==='original'/)
 assert.match(editor,/previewMode==='estrutura'/)
 assert.doesNotMatch(editor,/function PaperHeader|function PaperFooter|Página \{page\} de 2/)
 assert.match(editor,/criteria\.map/)
 assert.match(editor,/resultFor\(c\)/)
})
test('prototype cannot alter real IT data or invoke backend writes',()=>{
 assert.match(editor,/documentStatus/)
 assert.match(editor,/Em Revisão/)
 assert.doesNotMatch(editor,/apiPost|apiPut|\.insert\(|\.update\(|\.upsert\(/)
 assert.match(editor,/apiGet<OfficialData>/)
 assert.match(editor,/authClient.storage.from\('it-documentos'\).download/)
 assert.doesNotMatch(editor,/dangerouslySetInnerHTML/)
 assert.match(editor,/setHeader\(source\?\{\.\.\.source.header\}:\{\.\.\.exampleHeader\}\)/)
 assert.match(editor,/setCriteria\(source\?source.criteria.map/)
})
test('editor layout is scoped, responsive, and consistent with SGQ',()=>{
 assert.match(css,/\.sgq-operational-shell \.it-test/)
 assert.match(css,/\.panel\.section-card/)
 assert.match(css,/\.it-original-preview/)
 assert.match(css,/\.it-structure-preview/)
 assert.doesNotMatch(css,/\.it-test-paper-stack/)
 assert.match(css,/@media\(max-width:620px\)/)
 assert.match(css,/white-space:pre-wrap/)
})
