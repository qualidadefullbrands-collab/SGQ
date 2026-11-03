import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=source('src/App.tsx')
const mobile=source('src/mobile/MobileFotos.tsx')
const css=source('src/mobile/MobileFotos.css')
const api=source('backend/Sgq.Api/Program.cs')

test('phone automatically opens a dedicated photo-only screen without QR codes',()=>{
 assert.match(app,/const MobileFotos=lazy\(\(\)=>import\('\.\/mobile\/MobileFotos'\)\)/)
 assert.match(app,/matchMedia\('\(max-width: 768px\)'\)/)
 assert.match(app,/tab==='fotos-mobile'/)
 assert.match(app,/<MobileFotos processes=\{processes\} inspections=\{inspections\}/)
 assert.doesNotMatch(mobile,/QrCode|qr_token|scan QR/i)
 assert.match(mobile,/Processos em andamento/)
})
test('mobile lists only in-progress inspections associated with operational processes',()=>{
 assert.match(mobile,/i\.status!=='em_andamento'/)
 assert.match(mobile,/const valid=new Set\(processes\.map\(p=>p\.id\)\)/)
 assert.match(mobile,/active:processes\.filter\(p=>map\.has\(p\.id\)\)/)
 assert.match(mobile,/selectProcess\(p\.id\)/)
 assert.match(mobile,/list\.length===1/)
})
test('camera and gallery can capture multiple evidence photos with captions',()=>{
 assert.match(mobile,/capture="environment"/)
 assert.match(mobile,/accept="image\/\*"/)
 assert.match(mobile,/multiple onChange=/)
 assert.match(mobile,/photo\.legenda\.trim\(\)/)
 assert.match(mobile,/supabase\.storage\.from\('inspecao-fotos'\)\.upload/)
 assert.match(mobile,/\/fotos\/registrar/)
 assert.doesNotMatch(mobile,/upsert:true/)
 assert.match(mobile,/already exists\|duplicate\|resource already exists\|409/)
 assert.match(mobile,/createImageBitmap/)
})
test('mobile does not contain inspection completion or mutation of measurements',()=>{
 assert.doesNotMatch(mobile,/\/concluir|\/iniciar|\/dimensionais|\/testes|\/amostragem|\/retencao/)
 assert.match(mobile,/A conclusão será feita no computador/)
 assert.match(mobile,/canWrite/)
})
test('API uses a lightweight read endpoint and rejects archived or finished inspections',()=>{
 assert.match(api,/MapGet\("\/api\/mobile\/fotos\/inspecoes\/\{id\}"/)
 assert.match(api,/Somente inspeções em andamento podem receber fotos/)
 assert.match(api,/Processo arquivado ou indisponível/)
 const upload=api.slice(api.indexOf('app.MapPost("/api/inspecoes/{id}/fotos/registrar"'),api.indexOf('app.MapPost("/api/inspecoes/{id}/laudo"'))
 assert.match(upload,/excluido_em=is\.null/)
 assert.match(upload,/record\.GetProperty\("status"\)\.GetString\(\)!="em_andamento"/)
 assert.match(upload,/photo\.StoragePath\.StartsWith\(id\+"\/gerais\/"/)
 assert.match(upload,/storage_path=eq\./)
})
test('desktop has a manual lightweight refresh to receive photos captured on phone',()=>{
 assert.match(app,/async function refreshInspectionPhotoEvidence\(\)/)
 assert.match(app,/\/api\/mobile\/fotos\/inspecoes\//)
 assert.match(app,/Atualizar fotos/)
 assert.match(app,/current\?\.id===id/)
})
test('mobile photo styles are scoped and responsive',()=>{
 assert.match(css,/\.sgq-mobile-photo/)
 assert.match(css,/@media\(max-width:360px\)/)
 assert.match(css,/grid-template-columns/)
 assert.match(css,/min-height:100dvh/)
})
