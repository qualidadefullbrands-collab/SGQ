import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=source('src/App.tsx')
const board=source('src/components/InspectionsKanban.tsx')
const api=source('backend/Sgq.Api/Program.cs')
const docs=source('server/app.py')

test('each subprocess remains a distinct inspection card in a FST-labeled lane group',()=>{
 assert.match(board,/function groupByFst\(items:Inspection\[\]\)/)
 assert.match(board,/groupByFst\(column\.items\.slice/)
 assert.match(board,/children\.map\(item=>/)
 assert.match(board,/key=\{item\.id\}/)
 assert.match(board,/sgq-kanban-independent-inspection/)
 assert.match(board,/onOpen\(item\.id\)/)
 assert.match(board,/item\.status==='concluida'/)
 assert.match(board,/draggable=\{canMoveCard\(item\)\}/)
})

test('subprocess invoice is populated from its own group, not stale parent process',()=>{
 const edit=app.split('function startEditingInspectionData()')[1]?.split('async function saveEditingInspectionData()')[0]||''
 assert.match(edit,/notaFiscal:detail\.grupos_inspecao\?\.nota_fiscal/)
 assert.match(app,/NF deste subprocesso/)
 assert.match(app,/detail\.grupos_inspecao\?\.nota_fiscal \|\| '—'/)
 assert.doesNotMatch(app,/detail\.grupos_inspecao\?\.nota_fiscal \?\? detail\.grupos_inspecao\?\.processos\?\.nota_fiscal/)
 const save=app.split('async function saveEditingInspectionData()')[1]?.split('async function suggestApplicableIt')[0]||''
 assert.match(save,/setDetail\(/)
 assert.match(save,/nota_fiscal:fastPath\?current\.grupos_inspecao\?\.nota_fiscal:editPayload\.notaFiscal/)
 assert.match(save,/setInspections\(/)
 assert.match(save,/setProcesses\(/)
 assert.match(save,/void refreshLists\(\)/)
 assert.match(save,/grupos_inspecao:r\.data\.inspecao\.grupos_inspecao/)
})

test('backend persists independent NF and shared parent fields while verifying actual patches',()=>{
 const code=api.split('app.MapPut("/api/inspecoes/{id}/dados"')[1]?.split('app.MapPost("/api/inspecoes/{id}/concluir"')[0]||''
 assert.match(code,/if\(isSubprocess\)/)
 assert.match(code,/var updatedSubprocess=await RestAsync/)
 assert.match(code,/nota_fiscal=string\.IsNullOrWhiteSpace\(input\.NotaFiscal\)/)
 assert.match(code,/var updatedParent=await RestAsync/)
 assert.match(code,/cliente=string\.IsNullOrWhiteSpace\(input\.Cliente\)/)
 assert.match(code,/FirstRow\(updatedSubprocess\)\.found/)
 assert.match(code,/FirstRow\(updatedParent\)\.found/)
})

test('all subprocesses and mandatory inspection evidence must be checked before Word generation',()=>{
 assert.match(docs,/async def process_word_status\(/)
 assert.match(docs,/if not group_rows:/)
 assert.match(docs,/row\.get\("status"\)!="concluida"/)
 assert.match(docs,/nota fiscal não informada/)
 assert.match(docs,/verificações obrigatórias incompletas/)
 assert.match(docs,/fotografias da inspeção não registradas/)
 assert.match(docs,/if not status\["ready"\]:/)
 assert.match(api,/app\.MapGet\("\/api\/processos\/\{id\}\/laudo-status"/)
 assert.match(api,/generate-process\/\{Uri\.EscapeDataString\(parentId!\)\}/)
 assert.match(app,/id="sgq-word-pendencias"/)
 assert.match(app,/wordStatus\.pending\.map\(/)
 assert.match(app,/onClick=\{\(\)=>void refreshWordStatus\(\)\}/)
 assert.match(app,/disabled=\{wordDownloading\}/)
 assert.doesNotMatch(app,/Enviar ao SharePoint/)
 assert.doesNotMatch(app,/disabled=\{wordDownloading\|\|!wordStatus\?\.ready\}/)
})

test('Word readiness respects per-SKU NA, ten readings, and undefined tolerances',()=>{
 assert.match(docs,/def dimensional_pendencies\(/)
 assert.match(source('server/docx_generator.py'),/cfg\.get\("nao_aplicavel"\) is True/)
 assert.match(source('server/docx_generator.py'),/len\(values\)<10/)
 assert.match(docs,/dimensional_evaluations\(/)
 assert.match(docs,/evaluation\["status"\]=="pendente"/)
 assert.match(docs,/pending\.extend\(dimensional_pendencies\(/)
})

test('retroactive tolerance recalculation preserves measurements and audit trail',()=>{
 assert.match(api,/var currentMeasurements=await RestAsync/)
 assert.match(api,/medicoesAtualizadas=updatedMeasurements/)
 assert.match(api,/"retificacao_criterio_dimensional"/)
 assert.match(api,/new \{conforme=expected\}/)
 assert.match(app,/Aprovado pela média/)
 assert.match(app,/Editar inspeção concluída/)
 assert.match(app,/allowDimensionalRectification/)
})

test('SGQ documents approval by mean without inventing dimensional limits',()=>{
 const generator=source('server/docx_generator.py')
 assert.match(generator,/def dimensional_evaluations\(/)
 assert.match(generator,/status="aprovado_media"/)
 assert.match(generator,/len\(values\)<10/)
 assert.match(generator,/render_dimension_tables_by_sku\(/)
 assert.match(generator,/fill_dimensional_table_for_item\(/)
 assert.match(generator,/append_filled_inspection_form\(/)
 assert.doesNotMatch(generator,/RESUMO DIMENSIONAL/)
 assert.match(docs,/append_filled_inspection_form\(doc,filled\.body\)/)
 assert.doesNotMatch(docs,/append_subprocess_appendix\(doc/)
 assert.match(app,/summary\.average/)
})

test('completed inspections keep an auditable edit mode for every inspection stage',()=>{
 assert.match(app,/Editar inspeção concluída/)
 assert.match(app,/setAllowDimensionalRectification\(true\)/)
 assert.match(app,/detail\.status==='concluida' && !allowDimensionalRectification/)
 assert.match(app,/onBlur=\{\(e\)=>saveDimension\(item\.id,p,seq,e\.target\.value\)\} disabled=\{!canWrite \|\| \(detail\.status==='concluida' && !allowDimensionalRectification\)\}/)
 assert.match(app,/Confirmar aprovação revisada/)
 assert.match(app,/Confirmar reprovação revisada/)
 assert.match(app,/setCompletedEditRevision\(n=>n\+1\)/)
})

test('backend records before-after revisions and preserves the original completion instant',()=>{
 assert.match(api,/async Task<\(bool Completed,string UserId\)> InspectionEditContext/)
 assert.match(api,/async Task AuditCompletedInspectionEdit/)
 assert.match(api,/acao=action/)
 assert.match(api,/retificacao_medicao_dimensional/)
 assert.match(api,/retificacao_criterio_dimensional/)
 assert.match(api,/retificacao_verificacao/)
 assert.match(api,/retificacao_teste_especial/)
 assert.match(api,/retificacao_amostragem/)
 assert.match(api,/retificacao_observacao_interna/)
 assert.match(api,/retificacao_resultado_final/)
 assert.match(api,/concluida_em=completedAt/)
 assert.match(api,/revisao_obrigatoria=true/)
 assert.match(api,/revisado_em=\(DateTimeOffset\?\)null/)
})

test('Word readiness unpacks all six parallel query results, including dimensional configurations',()=>{
 const readiness=docs.split('async def process_word_status(')[1]?.split('@app.get("/process-report-status/')[0]||''
 assert.match(readiness,/links,photos,check_results,dim_results,test_results,dim_configs=await __import__\("asyncio"\)\.gather\(/)
 assert.match(readiness,/table_rows\(client,token,"inspecao_dimensional_configuracoes"/)
 assert.match(readiness,/pending\.extend\(dimensional_pendencies\(/)
})

test('Word errors and actual pending items are visible and retryable without bypassing validation',()=>{
 assert.match(app,/function parseWordStatus\(/)
 assert.match(app,/async function refreshWordStatus\(/)
 assert.match(app,/wordStatus\?\.error\?'Falha ao consultar o laudo'/)
 assert.match(app,/wordStatus\.pending\.map\(/)
 assert.match(app,/A validação falhou/)
 assert.match(app,/if\(!wordStatus\?\.ready\)/)
 assert.match(app,/document\.getElementById\('sgq-word-pendencias'\)/)
})

test('Word retains photo evidence while allowing numbered captions when empty',()=>{
 assert.match(docs,/if not photo_rows:/)
 assert.match(docs,/fotografias sem arquivo\./)
 assert.doesNotMatch(docs,/fotografias sem arquivo ou legenda/)
 const generator=source('server/docx_generator.py')
 assert.match(generator,/photo\.get\("caption"\) or f"Foto \{index\+1\}"/)
})

test('FST Word repeats the official inspection form for A and B with their own FST identities',()=>{
 const generator=source('server/docx_generator.py')
 assert.match(generator,/def subprocess_fst_code\(/)
 assert.match(generator,/"processo fst": subprocess_fst_code\(process,group\)/)
 assert.match(generator,/def append_filled_inspection_form\(/)
 assert.match(generator,/line=="REGISTRO DE INSPEÇÃO"/)
 assert.match(generator,/doc\.add_page_break\(\)/)
 assert.match(docs,/for group in groups\[1:\]:/)
 assert.match(docs,/filled=await generate_inspection_document\(child\["id"\]/)
 assert.match(docs,/append_filled_inspection_form\(doc,filled\.body\)/)
})

test('dimensional rows are omitted for unmeasured or NA parameters and repeated by SKU',()=>{
 const generator=source('server/docx_generator.py')
 assert.match(generator,/def render_dimension_tables_by_sku\(/)
 assert.match(generator,/def fill_dimensional_table_for_item\(/)
 assert.match(generator,/cfg\.get\("nao_aplicavel"\) is not True/)
 assert.match(generator,/any\(v\.get\("valor"\) is not None for v in values\)/)
 assert.match(generator,/for item in items:/)
 assert.match(generator,/table\.rows\[index:min\(index\+3,len\(table\.rows\)\)\]/)
 assert.doesNotMatch(generator,/RESUMO DIMENSIONAL/)
})

test('laudo title and file follow user standard ITXXX- FSTXXXXX - DD-MM-AAAA',()=>{
 const generator=source('server/docx_generator.py')
 assert.match(app,/Gerar Laudo/)
 assert.doesNotMatch(app,/>Word do FST</)
 assert.doesNotMatch(app,/>Gerar Word do FST</)
 assert.match(generator,/def consolidated_report_filename\(/)
 assert.match(generator,/issued_on\.strftime\('%d-%m-%Y'\)/)
 assert.match(docs,/consolidated_report_filename\(/)
 assert.match(docs,/instrucoes_trabalho\(codigo\)/)
 assert.match(docs,/ZoneInfo\("America\/Sao_Paulo"\)/)
})

test('Omie PV webhook persists idempotent events and protects public endpoint',()=>{
 const sourceFn=source('supabase/functions/sgq-omie-pv-webhook/index.ts')
 assert.match(sourceFn,/APP_HASH|secureEqual/)
 assert.match(sourceFn,/sgq_omie_webhook_config/)
 assert.match(sourceFn,/sha256\(token\)/)
 assert.match(sourceFn,/sgq_omie_eventos/)
 assert.match(sourceFn,/insertError\.code === "23505"/)
 assert.match(sourceFn,/EdgeRuntime\.waitUntil\(processEvent\(/)
 assert.match(sourceFn,/sgq_omie_pedidos/)
 assert.match(sourceFn,/Consulta do pedido não retornou dados/)
 assert.match(sourceFn,/extractFst\(order\)/)
 assert.doesNotMatch(sourceFn,/SUPABASE_SERVICE_ROLE_KEY[^\n]*console\./)
})

test('new Omie PV enters a review inbox without overwriting inspections',()=>{
 assert.match(app,/const \[omieInbox,setOmieInbox\]/)
 assert.match(app,/sgq_omie_pedidos_lidos/)
 assert.match(app,/void loadOmieInbox\(\)/)
 assert.match(app,/async function reviewOmieInboxOrder\(/)
 assert.match(app,/Confirme o FST, selecione a IT/)
 assert.match(app,/quantidadePv:String\(item\.quantidade\)/)
 assert.match(app,/quantidade:'',caixasRecebidas:'',caixasInspecionadas:''/)
 assert.match(app,/Pedidos de venda · Omie/)
 assert.match(app,/onClick=\{\(\)=>void reviewOmieInboxOrder\(order\)\}/)
})

test('CD arrival date is enforced by UI and API, with level I to II recalculation and audit',()=>{
 assert.match(api,/A data da inspeção não pode ser anterior à chegada ao CD/)
 assert.match(api,/app.MapPost\("\/api\/inspecoes\/\{id\}\/ampliar-nivel"/)
 assert.match(api,/ampliacao_amostragem_nivel_ii/)
 assert.match(api,/nc_preservadas=nc/)
 assert.match(app,/min=\{inspection\.chegadaCd\|\|undefined\}/)
 assert.match(app,/maybeOfferLevelII\(/)
 assert.match(app,/Aumentar|ampliar a inspeção para o Nível II/)
})

test('dimensional NC is shown on equivalent verification without duplicate Ac/Re counting',()=>{
 assert.match(app,/function dimensionalNcForChecklist\(/)
 assert.match(app,/dimensionChecklistKey\(/)
 assert.match(app,/NC dimensional:/)
 assert.match(app,/Confirme as NC únicas na amostragem para não duplicar unidades/)
 assert.match(app,/hasDimensionalNc \|\|/)
})
