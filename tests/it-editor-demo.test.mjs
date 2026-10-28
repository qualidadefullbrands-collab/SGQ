import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const editor=read('src/its/ItEditorDemo.tsx')
const css=read('src/its/ItEditorDemo.css')

test('test editor is opt-in inside the existing IT library, not a new production IT type',()=>{
 assert.match(app,/const ItEditorDemo=lazy\(\(\)=>import\('\.\/its\/ItEditorDemo'\)\)/)
 assert.match(app,/const \[itDemoOpen,setItDemoOpen\]=useState\(false\)/)
 assert.match(app,/Testar editor de IT/)
 assert.match(app,/itDemoOpen \? \(/)
 assert.match(app,/<ItEditorDemo\/>/)
 assert.match(app,/onSubmit=\{uploadIt\}/)
 assert.match(app,/itVersions\.map/)
})
test('editor has document identity and header, body, criteria, footer and two-page preview',()=>{
 for(const part of ['cabecalho','caderno','criterios','rodape','previa']){
  assert.ok(editor.includes("key:'"+part+"'"),part)
 }
 for(const text of ['Inserir logotipo','Cole ou escreva o conteúdo','Inserir imagem técnica','Tabela de especificações','Adicionar critério','Rodapé e controle documental','Inspeção do produto','Observações e evidências']){
  assert.ok(editor.includes(text),text)
 }
 assert.match(editor,/function PaperHeader/)
 assert.match(editor,/function PaperFooter/)
 assert.match(editor,/page=\{1\}/)
 assert.match(editor,/page=\{2\}/)
 assert.match(editor,/criteria\.map/)
 assert.match(editor,/resultFor\(c\)/)
})
test('prototype cannot alter real IT data or invoke backend writes',()=>{
 assert.match(editor,/Não salva nem publica documentos reais/)
 assert.doesNotMatch(editor,/authClient|supabase|fetch\(|apiPost|apiPut|apiGet/)
 assert.doesNotMatch(editor,/dangerouslySetInnerHTML/)
 assert.match(editor,/setHeader\(\{\.\.\.exampleHeader\}\)/)
 assert.match(editor,/setCriteria\(exampleCriteria\.map/)
})
test('editor layout is scoped, responsive, and consistent with SGQ',()=>{
 assert.match(css,/\.sgq-operational-shell \.it-test/)
 assert.match(css,/\.panel\.section-card/)
 assert.match(css,/\.it-test-paper/)
 assert.match(css,/@media\(max-width:620px\)/)
 assert.match(css,/white-space:pre-wrap/)
})
