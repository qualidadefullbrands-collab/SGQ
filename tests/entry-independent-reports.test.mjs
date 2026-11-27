import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const api=read('backend/Sgq.Api/Program.cs')
const docs=read('server/app.py')
const ui=read('src/App.tsx')
const migration=read('supabase/migrations/20261127155339_sgq_report_scope.sql')

test('new independent SKU entries and kits generate one report per inspection entry',()=>{
 assert.ok(ui.includes('const consolidated=Boolean(parentId&&detail.grupos_inspecao?.relatorio_consolidado===true)'))
 assert.ok(ui.includes("const suffix=consolidated?'':'?individual=1'"))
 assert.ok(ui.includes('const url=consolidated'))
 assert.ok(ui.includes('selectedInspectionId')&&ui.includes('individual=1'))
 assert.ok(ui.includes("const suffix=consolidated?'':'?entrada='+encodeURIComponent(groupId!)"))
 assert.ok(ui.includes('consolidated={detail.grupos_inspecao?.relatorio_consolidado===true}'))
 assert.ok(api.includes('request.Query["individual"]'))
 assert.ok(api.includes('generate-inspection/'))
 assert.ok(docs.includes('groups=[group for group in groups if group["id"]==group_id]'))
})

test('existing legacy A/B/C entries retain their consolidated FST report',()=>{
 assert.ok(migration.includes('set relatorio_consolidado = true'))
 assert.ok(migration.includes('where subprocesso_codigo is not null'))
 assert.ok(ui.includes("const consolidated=Boolean(parentId&&detail.grupos_inspecao?.relatorio_consolidado===true)"))
 const refresh=ui.split('async function refreshWordStatus()')[1]?.split('function reflectCompletedEdit()')[0]||''
 assert.ok(refresh.includes("const suffix=consolidated?'':'?entrada='+encodeURIComponent(groupId!)"))
 assert.ok(refresh.includes("'/laudo-status'+suffix"))
 assert.ok(ui.includes('/api/processos/'))
 assert.ok(docs.includes('for group in groups[1:]:'))
 assert.ok(docs.includes('append_filled_inspection_form(doc,filled.body)'))
 assert.ok(docs.includes('consolidated_report_filename('))
})

test('kit membership is explicit and multiple SKUs are never presumed a kit',()=>{
 assert.ok(api.includes('var distinctSkuCount=items.Select'))
 assert.ok(api.includes('distinctSkuCount>1&&!input.EhConjunto'))
 assert.ok(api.includes('var isComponentSet = input.EhConjunto && distinctSkuCount > 1;'))
 assert.ok(ui.includes('ehConjunto:isComponentSet===true'))
 assert.ok(ui.includes('Formam um mesmo kit'))
 assert.ok(ui.includes('kitHistoryLinks'))
 assert.ok(ui.includes('loadKitHistory'))
})

test('migration defaults new entries to individual reports without changing the legacy scope',()=>{
 assert.ok(migration.includes('add column if not exists relatorio_consolidado boolean not null default false'))
 assert.ok(migration.includes('comment on column public.grupos_inspecao.relatorio_consolidado'))
})
