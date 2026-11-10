import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const api=read('backend/Sgq.Api/Program.cs')
const app=read('src/App.tsx')
const editor=read('src/its/ItEditorDemo.tsx')
const css=read('src/its/ItEditorDemo.css')
const endpoint=api.split('app.MapGet("/api/its/{id}/editor-oficial",')[1]?.split('app.MapGet("/api/inspecoes/{id}/chat",')[0]||''

test('official IT preview is strictly read-only and only accepts published versions',()=>{
 assert.ok(endpoint.length>1000)
 assert.match(endpoint,/var token=Token\(request\)/)
 assert.match(endpoint,/version!.Value/)
 assert.match(endpoint,/row.GetProperty\("status"\).GetString\(\)!="publicada"/)
 assert.match(endpoint,/Somente versões oficiais publicadas/)
 assert.match(endpoint,/HttpMethod.Get,"it_checklist"/)
 assert.match(endpoint,/HttpMethod.Get,"it_parametros_dimensionais"/)
 assert.match(endpoint,/HttpMethod.Get,"it_testes_especiais"/)
 assert.doesNotMatch(endpoint,/HttpMethod\.(Patch|Post|Put|Delete)/)
})

test('official document is read from private authenticated storage and extracted without files or data mutation',()=>{
 assert.match(endpoint,/storage\/v1\/object\/authenticated\/it-documentos/)
 assert.match(endpoint,/ApplyAuth\(msg,token\)/)
 assert.match(endpoint,/new ZipArchive\(memory,ZipArchiveMode.Read\)/)
 assert.match(endpoint,/word\/document\.xml/)
 assert.match(endpoint,/documentText=string.Join/)
 assert.match(endpoint,/documentWarning/)
 assert.match(endpoint,/12_000_000/)
 assert.match(endpoint,/30000/)
})

test('demo editor presents actual official ITs and not a speculative official example',()=>{
 assert.match(app,/officialVersions=\{itVersions\.filter\(it=>it\.status==='publicada'\)/)
 assert.match(editor,/apiGet<OfficialData>\('\/api\/its\/'/)
 assert.match(editor,/^ const defaultOfficial=officialVersions.find\(v=>\/\^IT/m)
 assert.match(editor,/setCriteria\(snapshot.criteria.map/)
 assert.match(editor,/sourceId/)
 assert.match(editor,/officialCounts.checks/)
 assert.match(editor,/officialCounts.dimensions/)
 assert.match(editor,/officialCounts.special/)
 assert.match(editor,/Cópia editável de/)
 assert.match(editor,/Nunca|Nenhum ajuste salva ou publica a IT original/)
})

test('checklist, dimensional parameters, and special tests keep source classification and unapproved tolerances blank',()=>{
 assert.match(editor,/origin:'checklist' as const/)
 assert.match(editor,/origin:'dimensional' as const/)
 assert.match(editor,/origin:'teste' as const/)
 assert.match(editor,/numericDisplay\(d\.alvo\)/)
 assert.match(editor,/isSymmetric\?numericDisplay\(lower\):''/)
 assert.match(editor,/answer:'' as Answer/)
 assert.match(editor,/Sem tolerância aprovada/)
 assert.match(editor,/não reproduz imagens, tabelas e a paginação exata/)
 assert.match(editor,/Consultar Word oficial/)
})

test('official IT preview is visually scoped to the SGQ editor without overriding the other modules',()=>{
 assert.match(css,/\.sgq-operational-shell \.it-test-official-source/)
 assert.match(css,/\.it-test-source-summary/)
 assert.match(css,/@media\(max-width:720px\)/)
 assert.doesNotMatch(css,/^body\s*\{/m)
})
