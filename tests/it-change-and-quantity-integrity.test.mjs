import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const api=read('backend/Sgq.Api/Program.cs')
const sql=read('supabase/migrations/20261106_sgq_troca_it_quantidades_exatas.sql')

test('IT can be replaced from the FST editor and the inspection editor directs to it',()=>{
 assert.match(app,/Trocar IT do FST/)
 assert.match(app,/IT utilizada no FST/)
 assert.match(app,/itVersions\.filter\(it=>it\.status==='publicada'/)
 assert.match(app,/window\.confirm\('Trocar a IT do FST /)
 assert.match(app,/\+'\/it'/)
 assert.match(app,/itVersionId:editingProcess\.it_versao_id,confirmado:true/)
 assert.match(app,/setEditingInspectionData\(/)
 assert.match(app,/setWordStatus\(null\)/)
})

test('IT change is one audited transaction across FST and subprocesses',()=>{
 assert.match(api,/app\.MapPut\("\/api\/processos\/\{id\}\/it"/)
 assert.match(api,/rpc\/sgq_trocar_it_fst/)
 assert.match(sql,/LANGUAGE plpgsql SECURITY INVOKER/)
 assert.match(sql,/FROM public\.processos[\s\S]+FOR UPDATE/)
 assert.match(sql,/UPDATE public\.inspecoes i[\s\S]+SET it_versao_id=p_it_versao_id,documento_gerado_em=NULL/)
 assert.match(sql,/UPDATE public\.grupo_inspecao_its[\s\S]+SET principal=false/)
 assert.match(sql,/ON CONFLICT \(grupo_inspecao_id,it_versao_id\)/)
 assert.match(sql,/INSERT INTO public\.audit_log/)
 assert.doesNotMatch(sql,/\bDELETE\s+FROM\s+public\.inspecoes\b/i)
 assert.doesNotMatch(sql,/\bDELETE\s+FROM\s+public\.inspecao_(?:checklist|fotos)/i)
})

test('whole units are validated before sending a new or edited inspection',()=>{
 assert.match(app,/function operationalQuantityError\(rows:any\[\]\):string\|null/)
 assert.match(app,/!Number\.isSafeInteger\(Number\(value\)\)/)
 assert.match(app,/const quantityError=operationalQuantityError\(editingInspectionData\.itens\?\?\[\]\)/)
 assert.match(app,/const quantityError=operationalQuantityError\(skuRows\)/)
 assert.match(app,/Number\.isSafeInteger\(perBox\)/)
 assert.match(app,/Number\.isSafeInteger\(Number\(value\)\)/)
 assert.match(api,/bool InvalidOperationalUnits\(/)
 assert.match(sql,/CHECK \(quantidade IS NULL OR \(quantidade >= 0 AND quantidade = trunc\(quantidade\)\)\)/)
 assert.match(sql,/CHECK \(quantidade_componente IS NULL OR \(quantidade_componente >= 0 AND quantidade_componente = trunc\(quantidade_componente\)\)\)/)
})

test('quantity writes are never acknowledged without exact database read-back',()=>{
 const validate=api.split('async Task<bool> OperationalQuantitiesPersisted(')[1]?.split('app.MapPost("/api/inspecoes/criar"')[0]||''
 assert.match(validate,/processo_item_id,quantidade_componente,processo_itens\(id,quantidade\)/)
 assert.match(validate,/component\.GetDecimal\(\)!=quantity/)
 assert.match(validate,/storedQty\.GetDecimal\(\)!=quantity/)
 assert.equal((api.match(/if\(!await OperationalQuantitiesPersisted\(/g)||[]).length,2)
 assert.match(api,/A quantidade gravada diverge do valor informado/)
})
