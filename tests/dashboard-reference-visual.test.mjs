import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const dashboard=read('src/components/SgqDashboard.tsx')
const css=read('src/components/SgqDashboard.css')
const app=read('src/App.tsx')
const board=read('src/components/InspectionsKanban.tsx')
const api=read('backend/Sgq.Api/Program.cs')
const shell=read('src/styles.css')

test('dashboard is constructed with real operational values, not illustrative numbers',()=>{
 assert.match(app,/<SgqDashboard/)
 assert.match(app,/inspections=\{inspections\}/)
 assert.match(app,/processCount=\{processes\.length\}/)
 assert.match(app,/stockCount=\{samples\.length\}/)
 assert.match(dashboard,/const done = active\.filter\(item => item\.status === 'concluida'\)\.length/)
 assert.match(dashboard,/const percent = count \? Math\.round\(done \/ count \* 100\) : 0/)
 assert.doesNotMatch(dashboard,/\+17%|\+29%|216 amostras|FST26125/)
})

test('seven day completion chart uses the real concluded timestamp from both API lists',()=>{
 assert.match(dashboard,/item\.concluida_em/)
 assert.match(dashboard,/const latest = daySeries\.reduce/)
 assert.match(dashboard,/metrics\.previous > 0/)
 assert.match(dashboard,/Sem base na semana anterior/)
 const matches=api.match(/codigo_amostragem,criado_em,concluida_em,grupos_inspecao/g)||[]
 assert.equal(matches.length,2)
})

test('reference dashboard provides responsive cards, chart, navigation and real filters',()=>{
 for(const pattern of [
  /sgq-dashboard-kpis/,/sgq-summary-donut/,/sgq-week-chart/,
  /sgq-dashboard-board/,/sgq-dashboard-filter-panel/,/aria-expanded=\{filtersOpen\}/,
 ])assert.match(dashboard,pattern)
 assert.match(dashboard,/setStatusFilter\(e\.target\.value/)
 assert.match(dashboard,/onSearchChange\(e\.target\.value\)/)
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
 assert.match(css,/@media\(max-width:620px\)/)
 assert.match(css,/data-status-filter="concluida"/)
 assert.match(board,/externalQuery \?\? \(mode==='page'\?'':query\)/)
 assert.match(board,/mode==='panel'\s*\?column\.items/)
})

test('new SGQ shell preserves notifications, global search and logout actions',()=>{
 assert.match(app,/id="sgq-global-search"/)
 assert.match(app,/setDashboardSearch\(e\.target\.value\)/)
 assert.match(app,/omieUnread>0&&/)
 assert.match(app,/sgq-topbar-bell/)
 assert.match(app,/supabase\.auth\.signOut\(\)/)
 assert.match(app,/tab==='quadro'/)
 assert.match(shell,/linear-gradient\(165deg,#092c50/)
 assert.match(shell,/sgq-topbar-search/)
})
