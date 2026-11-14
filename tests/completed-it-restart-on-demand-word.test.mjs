import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const wordPanel=read('src/components/ReportReadinessPanel.tsx')
const api=read('backend/Sgq.Api/Program.cs')
const sql=read('supabase/migrations/20261111145000_sgq_reinicio_inspecao_troca_it.sql')
const word=read('server/app.py')

test('completed inspection can be edited without automatic Word-pendency requests',()=>{
 const open=app.split('async function openInspection(id: string)')[1]?.split('function startEditingInspectionData()')[0]||''
 const edit=app.split('async function saveEditingInspectionData()')[1]?.split('async function suggestApplicableIt')[0]||''
 const wordClick=app.split('async function downloadInspectionWord()')[1]?.split('if (!sessionReady)')[0]||''
 assert.match(open,/setWordStatus\(null\)/)
 assert.match(edit,/setWordStatus\(null\)/)
 assert.match(app,/<ReportReadinessPanel/)
 assert.match(wordPanel,/status\?\.pending\.length/)
 assert.match(wordPanel,/onCheck: \(\) => void/)
 assert.match(app,/onCheck=\{\(\)=>void refreshWordStatus\(\)\}/)
 assert.doesNotMatch(app,/if\(!wordStatus\?\.ready\)/)
 assert.match(wordClick,/const response=await fetch\(url/)
 assert.match(wordClick,/if\(response.status===409\)void refreshWordStatus\(\)/)
 assert.match(app,/IT desta inspeção/)
})

test('changing IT reopens the same inspection, archives old answers and preserves images',()=>{
 assert.match(api,/rpc\/sgq_reiniciar_inspecao_it/)
 assert.match(api,/var itChanged=/)
 assert.match(api,/reiniciada=itChanged/)
 assert.match(sql,/security definer set search_path = ''/)
 assert.match(sql,/v_user uuid := auth.uid\(\)/)
 assert.match(sql,/v_profile not in \('administrador','gestor','inspetor'\)/)
 assert.match(sql,/reinicio_por_troca_it/)
 assert.match(sql,/delete from public.inspecao_checklist_resultados/)
 assert.match(sql,/delete from public.inspecao_dimensionais/)
 assert.match(sql,/delete from public.inspecao_dimensional_configuracoes/)
 assert.match(sql,/delete from public.inspecao_testes_resultados/)
 assert.match(sql,/delete from public.inspecao_nao_conformidades/)
 assert.doesNotMatch(sql,/delete from public.inspecao_fotos/i)
 assert.match(sql,/status=case when v_before.status='aberta' then 'aberta' else 'em_andamento' end/)
 assert.match(sql,/concluida_em=null,revisao_obrigatoria=false/)
 assert.match(sql,/fotosPreservadas/)
 assert.match(sql,/revoke all on function public.sgq_reiniciar_inspecao_it/)
 assert.match(sql,/grant execute on function public.sgq_reiniciar_inspecao_it\(uuid,uuid\) to authenticated/)
 assert.match(app,/if\(saved.data\?\.reiniciada\)/)
 assert.match(app,/await openInspection\(id\)/)
})

test('FST-level IT change restarts all entries and remains a single combined Word',()=>{
 assert.match(sql,/for v_inspecao in/)
 assert.match(sql,/perform public.sgq_reiniciar_inspecao_it\(v_inspecao.id,p_it_versao_id\)/)
 assert.match(word,/for group in groups\[1:\]:/)
 assert.match(word,/append_filled_inspection_form\(doc,filled.body\)/)
 assert.match(word,/row_checks=\[c for c in checks/)
 assert.match(word,/row_dims=\[d for d in dims/)
 assert.match(word,/row_tests=\[t for t in tests/)
 assert.match(word,/ITs utilizadas nas entradas/)
})

test('SGQ process Word is built in memory only and returned on demand',()=>{
 const inspection=word.split('@app.get("/generate-inspection/{inspection_id}")')[1]?.split('@app.get("/generate-process/{process_id}")')[0]||''
 const process=word.split('@app.get("/generate-process/{process_id}")')[1]?.split('@app.get("/template-status")')[0]||''
 assert.match(inspection,/docx=generate_inspection\(template_bytes,payload\)/)
 assert.match(process,/return Response\(content=out.getvalue\(\)/)
 assert.doesNotMatch(inspection,/storage_upload\(|documento_storage_path|patch_execution/)
 assert.doesNotMatch(process,/storage_upload\(|documento_storage_path|patch_execution/)
 assert.match(app,/function downloadInspectionWord|async function downloadInspectionWord/)
})
