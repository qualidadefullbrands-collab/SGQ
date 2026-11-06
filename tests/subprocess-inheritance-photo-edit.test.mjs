import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const api=read('backend/Sgq.Api/Program.cs')
const app=read('src/App.tsx')
const mobile=read('src/mobile/MobileFotos.tsx')
const word=read('server/docx_generator.py')
const wordApi=read('server/app.py')
const sql=read('supabase/migrations/20261106_sgq_logistica_subprocesso_fotos_reversiveis.sql')

test('child logistics are saved to individual group and never parent',()=>{
 const create=api.split('app.MapPost("/api/inspecoes/criar"')[1]?.split('app.MapPut("/api/inspecoes/{id}/quantidades"')[0]||''
 assert.match(create,/subprocesso_codigo = subCode/)
 assert.match(create,/nota_fiscal = string\.IsNullOrWhiteSpace\(input\.NotaFiscal\)/)
 assert.match(create,/origem = string\.IsNullOrWhiteSpace\(input\.Origem\)/)
 assert.match(create,/transporte = string\.IsNullOrWhiteSpace\(input\.Transporte\)/)
 assert.match(create,/chegada_cd = input\.ChegadaCd/)
 const edit=api.split('app.MapPut("/api/inspecoes/{id}/dados"')[1]?.split('app.MapPost("/api/inspecoes/{id}/concluir"')[0]||''
 assert.match(edit,/var updatedSubprocess=await RestAsync/)
 assert.match(edit,/new\{[\s\S]*?nota_fiscal=string\.IsNullOrWhiteSpace\(input\.NotaFiscal\)/)
 assert.match(edit,/var parentChanges=new \{[\s\S]*?cliente=string\.IsNullOrWhiteSpace\(input\.Cliente\)/)
 assert.doesNotMatch(edit.split('var parentChanges=new {')[1]?.split('};')[0]||'',/chegada_cd|origem|transporte/)
})

test('next subprocess receives a one-time labeled reference but unique NF and quantities',()=>{
 const part=app.split('function reuseProcess(p: ProcessRow)')[1]?.split('async function editInspectionFull')[0]||''
 assert.match(part,/const first=previous\[0\]/)
 assert.match(part,/const hasChildReference/)
 assert.match(part,/setInheritedReference\(reference\)/)
 assert.match(part,/notaFiscal:''/)
 assert.match(part,/setSkuRows\(\[emptySku\(\)\]\)/)
 assert.match(app,/Herdado de referência · Subprocesso/)
 assert.match(app,/NF, datas, quantidade e caixas pertencem exclusivamente/)
 assert.match(app,/origem:detail\.grupos_inspecao\?\.origem/)
 assert.match(app,/chegadaCd:detail\.grupos_inspecao\?\.chegada_cd/)
})

test('reports use each group logistics and only active photos',()=>{
 assert.match(word,/group\.get\("origem"\)/)
 assert.match(word,/group\.get\("transporte"\)/)
 assert.match(word,/group\.get\("chegada_cd"\)/)
 assert.match(wordApi,/Photo evidence is always inspection-specific/)
 assert.match(wordApi,/"inspecao_fotos",\{"inspecao_id"/)
 assert.match(wordApi,/"excluido_em":"is.null"/)
})

test('photo removal and replacement are audit-safe and available after completion',()=>{
 assert.match(sql,/add column if not exists excluido_em/)
 assert.match(sql,/add column if not exists substituida_por/)
 assert.match(api,/app\.MapPost\("\/api\/inspecoes\/\{id\}\/fotos\/\{photoId\}\/remover"/)
 assert.match(api,/app\.MapPost\("\/api\/inspecoes\/\{id\}\/fotos\/\{photoId\}\/substituir"/)
 assert.match(api,/acao="remocao_foto"/)
 assert.match(api,/acao="substituicao_foto"/)
 assert.match(app,/async function removeSavedInspectionPhoto/)
 assert.match(app,/async function replaceSavedInspectionPhoto/)
 assert.match(app,/Trocar foto/)
 assert.match(app,/Remover<\/button>/)
 assert.match(mobile,/async function removeStored/)
 assert.match(mobile,/async function replaceStored/)
})

test('migration only copies legacy parent fields with exactly one subprocess',()=>{
 assert.match(sql,/count\(\*\) from public\.grupos_inspecao filhos where filhos\.processo_id=p\.id\)=1/)
 assert.match(sql,/sgq_audit\.logistica_subprocesso_20261106/)
 assert.doesNotMatch(sql,/delete from public\./i)
})
