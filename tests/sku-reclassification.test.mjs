import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=source('src/App.tsx'),api=source('backend/Sgq.Api/Program.cs'),sql=source('supabase/sql/sgq_reclassificar_inspecao.sql'),word=source('server/app.py'),ui=source('src/components/SkuReclassification.tsx')
test('existing inspection opens dedicated reclassification with an explicit preview',()=>{
 assert.match(app,/openSkuReclassification\(detail.id\)/)
 assert.match(ui,/Conferir nova classificação/)
 assert.match(ui,/confirmacao:preview.confirmacao/)
 assert.match(ui,/!confirmed\|\|!reason.trim\(\)/)
 assert.match(api,/rpc\/sgq_reclassificar_inspecao/)
})
test('reclassification preserves evidence and excludes only replaced groups from the consolidated Word',()=>{
 assert.match(sql,/security invoker set search_path=''/i)
 assert.match(sql,/for update/i)
 assert.match(sql,/sgq_reclassificacao_bloqueio/)
 assert.match(sql,/if p_confirmacao<>v_signature/)
 assert.doesNotMatch(sql,/delete from public\./i)
 assert.match(sql,/antes',v_snapshot/)
 assert.equal((word.match(/"reclassificado_em":"is.null"/g)||[]).length,2)
})
