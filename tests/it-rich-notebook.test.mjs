import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const editor=read('src/its/ItEditorDemo.tsx')
const rich=read('src/its/RichNarrativeEditor.tsx')
const parser=read('src/its/richNarrative.ts')
const css=read('src/its/RichNarrativeEditor.css')
const pkg=JSON.parse(read('package.json'))

test('only textual notebook is replaced by rich WYSIWYG, while all other SGQ editor steps remain',()=>{
 for(const step of ['cabecalho','caderno','criterios','rodape'])assert.match(editor,new RegExp("key:'"+step+"'"))
 assert.match(editor,/<RichNarrativeEditor value=\{notebookHtml\} readOnly=\{richImportBusy\} onChange=/)
 assert.match(editor,/<RichNarrativeEditor value=\{notebookHtml\} readOnly/)
 assert.doesNotMatch(editor,/<textarea rows=\{14\} value=\{notebook\}/)
 assert.match(editor,/<OfficialWordPreview/)
 assert.match(editor,/it001SamplingRows\.map/)
 assert.match(editor,/dimensionalCriteria\.map/)
 assert.match(editor,/setCriteria\(snapshot.criteria.map/)
 assert.match(editor,/documentStatus/)
 assert.doesNotMatch(editor,/apiPost|apiPut|\.insert\(|\.update\(|\.upsert\(/)
})

test('safe DOCX semantic import carries paragraphs, headings, lists, tables, images into notebook',()=>{
 assert.equal(pkg.dependencies['mammoth'],'1.13.0')
 assert.equal(pkg.dependencies['dompurify'],'3.4.17')
 assert.match(parser,/import DOMPurify from 'dompurify'/)
 assert.match(parser,/DOMPurify\.sanitize/)
 assert.match(parser,/ALLOWED_TAGS:tags/)
 assert.match(parser,/ALLOWED_ATTR:attrs/)
 assert.ok(parser.includes('data:image'))
 assert.match(parser,/await import\('mammoth\/mammoth.browser'\)/)
 assert.match(parser,/convertToHtml\(\{arrayBuffer:await file.arrayBuffer\(\)\}/)
 assert.match(parser,/cutRegistrationAnnex\(converted.value\)/)
 assert.match(parser,/p\[style-name='Título 1'\]/)
 assert.match(parser,/12_000_000/)
})

test('rich editor has functioning formatting actions and keeps editing cursor stable',()=>{
 for(const dep of ['@tiptap/react','@tiptap/pm','@tiptap/starter-kit','@tiptap/extension-table','@tiptap/extension-image'])
  assert.equal(pkg.dependencies[dep],'3.30.3')
 assert.match(rich,/useEditor\(/)
 assert.match(rich,/TableKit\.configure/)
 assert.match(rich,/Image\.configure\(\{allowBase64:true/)
 for(const op of ['toggleHeading','toggleBold','toggleItalic','toggleUnderline','toggleBulletList','toggleOrderedList','insertTable','addRowAfter','deleteRow','undo','redo'])
  assert.match(rich,new RegExp(op+'\\('))
 assert.match(rich,/lastLocalValue\.current===value/)
 assert.match(rich,/setContent\(clean,\{emitUpdate:false\}\)/)
 assert.match(rich,/aria-label="Formatação do texto"/)
})

test('DOCX loading has an unmodified fallback, stale import guard, and restoration snapshot',()=>{
 assert.match(editor,/const importToken=\+\+richImportGeneration\.current/)
 assert.match(editor,/if\(importToken!==richImportGeneration\.current\)return/)
 assert.match(editor,/setNotebookHtml\(snapshot\.notebookHtml\)/)
 assert.match(editor,/setImportSnapshot\(current=>/)
 assert.match(editor,/setNotebookHtml\(source\?source\.notebookHtml:plainToRichHtml\(exampleNotebook\)\)/)
 assert.match(editor,/Não foi possível importar a formatação/)
 assert.match(editor,/narrativeTextFromHtml\(imported.html\)/)
 assert.match(editor,/importNarrativeFromDocx\(file.data\)/)
})

test('formatting is constrained to Caderno and preview, with Calibri and responsive tables',()=>{
 assert.match(css,/\.sgq-operational-shell \.sgq-rich-container/)
 assert.match(css,/font-family:Calibri/)
 assert.match(css,/\.sgq-rich-document h1/)
 assert.match(css,/\.sgq-rich-document h2/)
 assert.match(css,/\.sgq-rich-document table/)
 assert.match(css,/\.sgq-rich-document li/)
 assert.match(css,/\.is-read-only/)
 assert.match(css,/@media\(max-width:720px\)/)
 assert.doesNotMatch(css,/^body\s*\{/m)
})
