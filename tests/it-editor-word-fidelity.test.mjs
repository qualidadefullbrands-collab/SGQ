import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const editor=read('src/its/ItEditorDemo.tsx')
const original=read('src/its/OfficialWordPreview.tsx')
const styles=read('src/its/ItEditorDemo.css')
const pkg=JSON.parse(read('package.json'))

test('published DOCX is rendered from authenticated, private binary source rather than flattened Word text',()=>{
 assert.equal(pkg.dependencies['docx-preview'],'0.4.1')
 assert.match(original,/from 'docx-preview'/)
 assert.match(original,/authClient\.storage\.from\('it-documentos'\)\.download\(storagePath\)/)
 assert.match(original,/renderAsync\(data,body,body,/)
 assert.match(original,/renderHeaders:true/)
 assert.match(original,/renderFooters:true/)
 assert.match(original,/ignoreLastRenderedPageBreak:false/)
 assert.match(original,/breakPages:true/)
 assert.match(original,/renderAltChunks:false/)
 assert.match(original,/renderComments:false/)
 assert.match(original,/renderChanges:false/)
 assert.match(original,/12_000_000/)
})

test('Word tables, logos, pagination and fonts are isolated from the SGQ app stylesheet',()=>{
 assert.match(original,/attachShadow\(\{mode:'open'\}\)/)
 assert.match(original,/shadow\.appendChild\(style\)/)
 assert.match(original,/className:'docx'/)
 assert.match(original,/\.docx-wrapper>section\.docx/)
 assert.match(original,/visibility:loading\?'hidden':'visible'/)
 assert.match(original,/O navegador pode quebrar páginas de forma diferente/)
 assert.doesNotMatch(original,/dangerouslySetInnerHTML|innerHTML\s*=/)
})

test('preview no longer invents a two-page IT or replaces approved Word with SGQ logo',()=>{
 assert.doesNotMatch(editor,/PaperHeader|PaperFooter|it-test-paper-stack|Página 1 do exemplo|Página 2 do exemplo/)
 assert.doesNotMatch(styles,/\.it-test-paper-stack|\.it-test-doc-header/)
 assert.match(editor,/setPreviewMode\('original'\);setStep\('caderno'\)/)
 assert.match(editor,/Documento oficial \(Word\)/)
 assert.match(editor,/Estrutura editável/)
 assert.match(editor,/<OfficialWordPreview/)
 assert.match(editor,/PRÉVIA DE EDIÇÃO/)
})

test('editable view separates 18 checklist criteria, dimensional parameters and exceptional tests',()=>{
 assert.match(editor,/const checklistCriteria=criteria\.filter/)
 assert.match(editor,/const dimensionalCriteria=criteria\.filter/)
 assert.match(editor,/const specialCriteria=criteria\.filter/)
 assert.match(editor,/checklistCriteria\.map/)
 assert.match(editor,/dimensionalCriteria\.map/)
 assert.match(editor,/specialCriteria\.map/)
 assert.match(editor,/Grupo da verificação/)
 assert.match(editor,/As categorias originais \(Visual, Dimensional, Olfativo, Medição e Funcional\)/)
 assert.match(editor,/Componente \/ SKU/)
 assert.match(editor,/não informa nominal ou desvio/)
 assert.match(editor,/setCriteria\(snapshot.criteria.map/)
 assert.match(editor,/isSymmetric\?numericDisplay\(lower\):''/)
})

test('Word viewer includes working zoom and explicit error retry',()=>{
 assert.match(original,/const \[zoom,setZoom\]=useState\(85\)/)
 assert.match(original,/setZoom\(v=>Math\.max/)
 assert.match(original,/setZoom\(v=>Math\.min/)
 assert.match(original,/setRetry\(v=>v\+1\)/)
 assert.match(original,/role="alert"/)
 assert.match(styles,/@media\(max-width:620px\)/)
 assert.match(styles,/\.it-original-viewport/)
 assert.match(styles,/\.it-test-preview-switch/)
})

test('IT001 02/2026 annex reproduces the original fixed sampling and box evaluation tables',()=>{
 const rowPattern=/\['281 – 500 unidades','F','20','1 \/ 2','H','50','2 \/ 3'\]/
 assert.match(editor,rowPattern)
 assert.match(editor,/\['Acima de 150.000 unidades','M','315','10 \/ 11','P','800','21 \/ 22'\]/)
 assert.match(editor,/const it001BoxRanges=\['1','2','3 – 6','7 – 12','13 – 20','21 – 30','31 – 42','43 – 56'\]/)
 assert.match(editor,/\/\^IT\\s\*0\*01\$\/i.test\(officialLoaded.codigo\)/)
 assert.match(editor,/it001IdentityRows.map/)
 assert.match(editor,/it001SamplingRows.map/)
 assert.match(editor,/it001BoxRanges.map/)
})

test('registration template keeps operational values blank and per-SKU dimensional grid has ten cells',()=>{
 assert.match(editor,/Campos presentes no formulário oficial, sem preenchimento operacional/)
 assert.match(editor,/Componente \/ SKU/)
 assert.match(editor,/\[1,3,5,7,9,2,4,6,8,10\]\.map/)
 assert.match(editor,/Resultado dimensional/)
 assert.match(editor,/Resultado da inspeção · modelo/)
 assert.match(editor,/Observação \/ conclusão/)
 assert.match(editor,/annexAt=text.indexOf\('REGISTRO DE INSPEÇÃO'\)/)
 assert.match(editor,/const narrative=annexAt>150\?text.slice\(0,annexAt\).trim\(\):text/)
})
