import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.tsx')
const dashboard=read('src/components/SgqDashboard.tsx')
const board=read('src/components/InspectionsKanban.tsx')
const css=read('src/components/InspectionsKanban.css')
const photos=read('src/mobile/MobileFotos.tsx')
const settings=read('src/config/SettingsPage.tsx')
const models=read('src/its/InspectionModelsPage.tsx')
const schema=read('supabase/migrations/20261112142000_sgq_modelos_inspecao.sql')

test('indicadores do painel navegam para módulos em vez de empilhar ou rolar prévias',()=>{
 assert.match(dashboard,/onCompletedInspections/)
 assert.match(dashboard,/onClick=\{\(\)=>\{setPanelSection\('processos'\);onProcesses\(\)\}\}/)
 assert.match(dashboard,/onClick=\{\(\)=>\{setPanelSection\('estoque'\);onStock\(\)\}\}/)
 assert.match(dashboard,/onAllInspections\(\)/)
 assert.doesNotMatch(dashboard,/scrollIntoView/)
 assert.match(app,/onCompletedInspections=\{\(\)=>\{setBoardArchiveOnly\(true\);setTab\('quadro'\)\}\}/)
})

test('concluídas têm histórico próprio, busca e cartões com contorno inteiro',()=>{
 assert.match(board,/archiveOnly/)
 assert.match(board,/completedSearch/)
 assert.match(board,/Buscar no histórico/)
 assert.match(board,/Ver histórico de concluídas/)
 assert.match(board,/column\.status!=='concluida'/)
 assert.match(css,/tone-done \.sgq-kanban-card\{border:1\.5px solid/)
 assert.match(css,/\.is-archive-only/)
})

test('modo fotos mostra apenas inspeções que não estão concluídas',()=>{
 assert.match(photos,/i\.status==='cancelada'\|\|i\.status==='concluida'/)
 assert.match(photos,/active:processes\.filter\(p=>map\.has\(p\.id\)\)/)
})

test('referências a IT apresentam também o título e não só o código',()=>{
 assert.match(board,/it_versoes\?\.instrucoes_trabalho/)
 assert.match(board,/instrucoes_trabalho\.titulo/)
 assert.match(app,/detail\.it_versoes\.instrucoes_trabalho\.titulo/)
 assert.match(app,/it\.instrucoes_trabalho\?\.titulo \|\| 'Sem título'/)
})

test('novo cadastro de modelos preserva ITs oficiais e possui escopo e checklist configuráveis',()=>{
 assert.match(app,/tab==='modelos'/)
 assert.match(app,/tab==='its'/)
 assert.match(models,/Modelo salvo com sucesso/)
 assert.match(models,/authClient\.from\('sgq_modelos_inspecao'\)/)
 for(const term of ['armazem','qualidade','ambos','conformidade','texto','numero','foto','obrigatorio','status'])
  assert.ok(models.includes(term),term)
 assert.match(schema,/enable row level security/)
 assert.match(schema,/private\.current_sgq_role\(\)/)
 assert.match(schema,/grant update\(codigo,nome,escopo,status,checklist,atualizado_em\)/)
})

test('textos administrativos solicitados não aparecem e popups ganharam largura',()=>{
 assert.doesNotMatch(settings,/Usuário: <strong>\{profile.nome\}<\/strong>/)
 assert.doesNotMatch(settings,/As flags abaixo refletem/)
 assert.match(read('src/styles.css'),/width:min\(680px/)
})

test('mensagem de vínculo não pressupõe inexistência de produtos',()=>{
 assert.doesNotMatch(board,/Produtos ainda não vinculados à entrada/)
 assert.match(board,/onRefreshProducts/)
 assert.match(board,/Atualizar produtos/)
})
