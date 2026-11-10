import { useMemo, useState } from 'react'
import { ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Filter, Layers3, Package, Plus, TrendingUp, X } from 'lucide-react'
import './SgqDashboard.css'

type DashboardInspection = {
  id: string
  status: string
  criado_em: string
  concluida_em?: string | null
}

type Props = {
  inspections: DashboardInspection[]
  processCount: number
  stockCount: number
  searchQuery: string
  onSearchChange: (value: string) => void
  onNewInspection: () => void
  onInsights: () => void
  onProcesses: () => void
  onStock: () => void
  onAllInspections: () => void
  children: React.ReactNode
}

function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

export default function SgqDashboard({
  inspections, processCount, stockCount, searchQuery, onSearchChange,
  onNewInspection, onInsights, onProcesses, onStock, onAllInspections, children,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'aberta' | 'em_andamento' | 'concluida'>('all')
  const metrics = useMemo(() => {
    const active = inspections.filter(item => item.status !== 'cancelada')
    const done = active.filter(item => item.status === 'concluida').length
    const ongoing = active.filter(item => item.status === 'em_andamento').length
    const queued = active.filter(item => item.status === 'aberta').length
    const count = active.length
    const percent = count ? Math.round(done / count * 100) : 0

    const today = dayStart(new Date())
    const daySeries = Array.from({length: 7}, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (6 - index))
      const value = active.filter(item => {
        if (item.status !== 'concluida' || !item.concluida_em) return false
        const dateValue = new Date(item.concluida_em)
        return !Number.isNaN(dateValue.getTime()) && dayStart(dateValue).getTime() === date.getTime()
      }).length
      return { label: new Intl.DateTimeFormat('pt-BR', {weekday: 'short'}).format(date).replace('.', ''), count: value }
    })
    const latest = daySeries.reduce((sum, item) => sum + item.count, 0)
    const lastWeekStart = new Date(today)
    lastWeekStart.setDate(today.getDate() - 13)
    const lastWeekEnd = new Date(today)
    lastWeekEnd.setDate(today.getDate() - 7)
    const previous = active.filter(item => {
      if (item.status !== 'concluida' || !item.concluida_em) return false
      const value = new Date(item.concluida_em)
      if (Number.isNaN(value.getTime())) return false
      const started = dayStart(value).getTime()
      return started >= lastWeekStart.getTime() && started <= lastWeekEnd.getTime()
    }).length
    return {done,ongoing,queued,count,percent,daySeries,latest,previous}
  }, [inspections])

  const maxBar = Math.max(1, ...metrics.daySeries.map(item => item.count))
  const completionChange = metrics.previous > 0
    ? Math.round((metrics.latest - metrics.previous) / metrics.previous * 100)
    : null
  const showOnly = statusFilter === 'all'
    ? 'Todas as inspeções'
    : statusFilter === 'aberta' ? 'Não iniciadas'
      : statusFilter === 'em_andamento' ? 'Em andamento' : 'Concluídas'

  return <section className="workspace sgq-dashboard" aria-label="Painel do SGQ">
    <header className="sgq-dashboard-intro">
      <div>
        <h1>Painel do SGQ</h1>
        <p>Visão geral das operações de qualidade e inspeções</p>
      </div>
      <div className="sgq-dashboard-intro-actions">
        <button className="secondary sgq-dashboard-insights" type="button" onClick={onInsights}>
          <BarChart3 size={18} aria-hidden="true"/> Insights
        </button>
        <button className="primary sgq-dashboard-create" type="button" onClick={onNewInspection}>
          <Plus size={20} aria-hidden="true"/> Nova inspeção
        </button>
      </div>
    </header>

    <div className="sgq-dashboard-kpis" aria-label="Indicadores atuais">
      <button type="button" className="sgq-kpi-card" onClick={onProcesses} aria-label={formatCount(processCount)+' processos. Ver processos'}>
        <span className="sgq-kpi-icon sgq-kpi-blue"><Layers3 size={29}/></span>
        <span className="sgq-kpi-copy"><strong>{formatCount(processCount)}</strong><span>Processos</span></span>
        <span className="sgq-kpi-hint">Ver todos <ArrowRight size={14}/></span>
      </button>
      <button type="button" className="sgq-kpi-card is-focused" onClick={() => document.getElementById('sgq-dashboard-inspections')?.scrollIntoView({behavior:'smooth',block:'start'})} aria-label={formatCount(metrics.count)+' inspeções. Ir para o quadro'}>
        <span className="sgq-kpi-icon sgq-kpi-sky"><ClipboardCheck size={29}/></span>
        <span className="sgq-kpi-copy"><strong>{formatCount(metrics.count)}</strong><span>Inspeções</span></span>
        <span className="sgq-kpi-hint">Ver quadro <ArrowRight size={14}/></span>
      </button>
      <button type="button" className="sgq-kpi-card" onClick={onStock} aria-label={formatCount(stockCount)+' amostras em estoque. Abrir estoque'}>
        <span className="sgq-kpi-icon sgq-kpi-slate"><Package size={29}/></span>
        <span className="sgq-kpi-copy"><strong>{formatCount(stockCount)}</strong><span>Estoque</span></span>
        <span className="sgq-kpi-hint">Ver estoque <ArrowRight size={14}/></span>
      </button>
      <button type="button" className="sgq-kpi-card" onClick={() => document.getElementById('sgq-dashboard-inspections')?.scrollIntoView({behavior:'smooth',block:'start'})} aria-label={formatCount(metrics.done)+' inspeções concluídas'}>
        <span className="sgq-kpi-icon sgq-kpi-green"><CheckCircle2 size={29}/></span>
        <span className="sgq-kpi-copy"><strong>{formatCount(metrics.done)}</strong><span>Concluídas</span></span>
        <span className="sgq-kpi-hint">Total atual <CheckCircle2 size={14}/></span>
      </button>
    </div>

    <section className="sgq-dashboard-summary" aria-label="Indicadores de inspeções">
      <div className="sgq-summary-description">
        <span className="sgq-summary-icon"><BarChart3 size={24}/></span>
        <div><h2>Indicadores de Inspeções</h2><p>Acompanhe o andamento e a taxa de conclusão das inspeções.</p></div>
      </div>
      <div className="sgq-summary-distribution">
        <div className="sgq-summary-donut" role="img" aria-label={metrics.percent+'% de conclusão, '+metrics.done+' concluídas, '+metrics.ongoing+' em andamento e '+metrics.queued+' não iniciadas'} style={{
          background: metrics.count
            ? `conic-gradient(#17b891 0% ${metrics.done/metrics.count*100}%, #168dda ${metrics.done/metrics.count*100}% ${(metrics.done+metrics.ongoing)/metrics.count*100}%, #bcc9de ${(metrics.done+metrics.ongoing)/metrics.count*100}% 100%)`
            : '#e0e8f3',
        }}>
          <div className="sgq-summary-donut-center"><strong>{metrics.percent}%</strong><span>Conclusão</span></div>
        </div>
        <div className="sgq-summary-legend" aria-label="Distribuição por status">
          <div><span className="sgq-legend-dot is-done"/>Concluídas <strong>{metrics.done} ({metrics.count?Math.round(metrics.done/metrics.count*100):0}%)</strong></div>
          <div><span className="sgq-legend-dot is-active"/>Em andamento <strong>{metrics.ongoing} ({metrics.count?Math.round(metrics.ongoing/metrics.count*100):0}%)</strong></div>
          <div><span className="sgq-legend-dot is-queued"/>Não iniciadas <strong>{metrics.queued} ({metrics.count?Math.round(metrics.queued/metrics.count*100):0}%)</strong></div>
        </div>
      </div>
      <div className="sgq-summary-week">
        <h3>Inspeções concluídas <span>(últimos 7 dias)</span></h3>
        <div className="sgq-week-chart" aria-label="Conclusões por dia nos últimos sete dias">
          {metrics.daySeries.map((day,index) => <div className="sgq-week-day" key={index}>
            <div className="sgq-week-bar-track" title={day.count+' inspeção(ões) concluída(s)'}>
              <div className={'sgq-week-bar '+(index===6?'is-today':'')} style={{height:(day.count?Math.max(15,day.count/maxBar*100):0)+'%'}}/>
            </div>
            <span>{day.label}</span>
          </div>)}
        </div>
      </div>
      <div className="sgq-summary-trend">
        <span className="sgq-trend-value"><TrendingUp size={20}/> {metrics.latest}</span>
        <strong>concluídas nos últimos 7 dias</strong>
        <small>{completionChange === null
          ? 'Sem base na semana anterior'
          : (completionChange >= 0 ? '+' : '') + completionChange + '% em relação à semana anterior'}</small>
      </div>
    </section>

    <section id="sgq-dashboard-inspections" className="sgq-dashboard-inspections" aria-label="Quadro de inspeções">
      <div className="sgq-dashboard-board-actions">
        <div className="sgq-dashboard-title">
          <h2>Inspeções</h2><span>{formatCount(metrics.count)}</span>
        </div>
        <div className="sgq-dashboard-board-controls">
          <button className="secondary sgq-dashboard-filter-button" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>
            <Filter size={17}/> Filtrar {statusFilter!=='all'?'· '+showOnly:''}
          </button>
          <button className="secondary" type="button" onClick={onAllInspections}>Ver todas <ArrowRight size={17}/></button>
        </div>
      </div>
      {filtersOpen && <div className="sgq-dashboard-filter-panel" aria-label="Filtros do painel">
        <label>Buscar no quadro
          <input type="search" value={searchQuery} onChange={e=>onSearchChange(e.target.value)} placeholder="FST, cliente, NF ou produto"/>
        </label>
        <label>Situação
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">Todas</option>
            <option value="aberta">Não iniciadas</option>
            <option value="em_andamento">Em andamento</option>
            <option value="concluida">Concluídas</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={()=>{onSearchChange('');setStatusFilter('all')}}><X size={16}/> Limpar</button>
      </div>}
      <div data-status-filter={statusFilter} className="sgq-dashboard-board">
        {children}
      </div>
      {showHistory && <div className="sgq-dashboard-history">
        <p>As inspeções são exibidas nas três colunas conforme o status atual. Para consultar processos sem inspeção, abra <strong>Processos</strong>.</p>
      </div>}
      <button type="button" className="sgq-dashboard-board-info" onClick={()=>setShowHistory(v=>!v)} aria-expanded={showHistory}>
        {showHistory?'Ocultar orientações':'Como funciona o quadro?'}
      </button>
    </section>
  </section>
