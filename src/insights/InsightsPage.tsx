import {useEffect,useMemo,useState} from 'react'
import {Activity,AlertTriangle,ArrowDownRight,ArrowUpRight,BarChart3,ClipboardCheck,RefreshCw,Search,X,ChevronRight} from 'lucide-react'
import {apiGet} from '../lib/supabase'
import {inspectionInsightRows,type InsightRow} from './insightsData'
import './insights.css'

const fmt=(x:number)=>x.toLocaleString('pt-BR',{maximumFractionDigits:3})
const date=(x:string)=>x?new Date(x).toLocaleDateString('pt-BR'):'—'
const normalize=(s:string)=>s.toLocaleLowerCase('pt-BR')
const reportStatus=(s:string)=>({em_andamento:'Em andamento',aberta:'Não iniciada',concluida:'Concluída',cancelada:'Cancelada'} as Record<string,string>)[s]||s

export default function InsightsPage({onOpenInspection}:{onOpenInspection:(id:string)=>void}){
  const [data,setData]=useState<{inspections:any[];links:any[];maxInspections:number}|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [term,setTerm]=useState('')
  const [scope,setScope]=useState('divergente')
  const [status,setStatus]=useState('todos')
  const [openMetric,setOpenMetric]=useState<number|null>(null)
  async function reload(){
    if(!navigator.onLine){setError('Sem conexão. Os Insights exigem dados consolidados do servidor.');setLoading(false);return}
    setLoading(true);setError('')
    const reply=await apiGet<any>('/api/app/insights')
    if(reply.error||!reply.data)setError(reply.error?.message||'Não foi possível consultar os Insights.')
    else setData(reply.data)
    setLoading(false)
  }
  useEffect(()=>{void reload()},[])
  const all=useMemo(()=>inspectionInsightRows(data?.inspections||[],data?.links||[]),[data])
  const filtered=useMemo(()=>all.filter(row=>{
    if(status!=='todos'&&row.status!==status)return false
    const searched=normalize([row.fst,row.client,row.pv,row.sku,row.product,row.inspectionNumber].join(' '))
    if(term&& !searched.includes(normalize(term.trim())))return false
    return scope==='todos'||(scope==='divergente'?row.difference!==null&&Math.abs(row.difference)>0.000001:
      scope==='sem-pv'?row.evidence!=='verified':row.evidence==='verified')
  }),[all,status,term,scope])
  const withEvidence=all.filter(r=>r.evidence==='verified')
  const deviations=withEvidence.filter(r=>r.difference!==null&&Math.abs(r.difference)>0.000001)
  const shortages=deviations.filter(r=>(r.difference||0)<0)
  const excess=deviations.filter(r=>(r.difference||0)>0)
  const totalAbs=deviations.reduce((sum,row)=>sum+Math.abs(row.difference||0),0)
  const processCount=new Set((data?.inspections||[]).map(x=>x?.grupos_inspecao?.processos?.id).filter(Boolean)).size
  const clientCount=new Set((data?.inspections||[]).map(x=>String(x?.grupos_inspecao?.processos?.cliente||'').trim().toUpperCase()).filter(Boolean)).size
  const completed=(data?.inspections||[]).filter(x=>x.status==='concluida')
  const inProgress=(data?.inspections||[]).filter(x=>x.status==='em_andamento').length
  const inspectedPieces=(data?.inspections||[]).reduce((sum,x)=>sum+Number(x.total_inspecionado||0),0)
  const nonConforming=(data?.inspections||[]).reduce((sum,x)=>sum+Number(x.total_nao_conforme||0),0)
  const completedDuration=completed.map(row=>({row,minutes:row.iniciada_em&&row.concluida_em
    ?(Date.parse(row.concluida_em)-Date.parse(row.iniciada_em))/60000:null}))
    .filter((x):x is {row:any;minutes:number}=>typeof x.minutes==='number'&&Number.isFinite(x.minutes)&&x.minutes>=0)
  const avgDuration=completedDuration.length?completedDuration.reduce((sum,x)=>sum+x.minutes,0)/completedDuration.length:null
  const durationLabel=(minutes:number|null)=>minutes===null?'—':
    Math.floor(minutes/60)+'h '+String(Math.round(minutes%60)).padStart(2,'0')+'min'
  const conformity=inspectedPieces>0?100*(inspectedPieces-nonConforming)/inspectedPieces:null
  const countedComponents=all.reduce((sum,x)=>sum+x.received,0)
  const recent=useMemo(()=>[...deviations].sort((a,b)=>Math.abs(b.difference||0)-Math.abs(a.difference||0)).slice(0,6),[data])
  const months=useMemo(()=>{
    const map=new Map<string,{total:number;delta:number}>()
    for(const row of withEvidence){
      const key=row.date.slice(0,7)
      if(!/^\d{4}-\d{2}$/.test(key))continue
      const old=map.get(key)||{total:0,delta:0}
      old.total++
      if(Math.abs(row.difference||0)>0.000001)old.delta++
      map.set(key,old)
    }
    return [...map.entries()].sort(([a],[b])=>b.localeCompare(a)).slice(0,6).reverse()
  },[data])
  const maxMonth=Math.max(1,...months.map(([,v])=>v.total))
  const records=data?.inspections||[]
  const inspectionName=(i:any)=>String(i.grupos_inspecao?.processos?.codigo||i.numero||'Inspeção')
  const inspectionRows=(items:any[],show:(i:any)=>string)=>items.slice(0,60).map(i=>({
    id:String(i.id||''),title:inspectionName(i),
    sub:String(i.grupos_inspecao?.processos?.cliente||''),
    value:show(i)
  }))
  const skuRows=(items:InsightRow[])=>items.slice(0,60).map(i=>({
    id:i.inspectionId,title:(i.fst||'FST')+' · '+i.sku,
    sub:i.client+' · '+(i.pv||'Sem PV'),
    value:i.difference===null?'Não comparável':(i.difference>0?'+':'')+fmt(i.difference)
  }))
  const distinctBy=(items:any[],key:(i:any)=>string)=>[...new Map(items.map(i=>[key(i),i])).values()]
  const metricDetails=[
    {how:'SKUs com uma quantidade original e um PV Omie confirmados. Contagem única por SKU da inspeção.',
      rows:skuRows(withEvidence)},
    {how:'SKUs em que o total recebido difere da quantidade do PV, sem presumir valores ausentes.',
      rows:skuRows(deviations)},
    {how:'SKUs com quantidade recebida menor que a quantidade registrada no PV.',
      rows:skuRows(shortages)},
    {how:'Soma do valor absoluto das diferenças por SKU verificável; não é valor monetário.',
      rows:skuRows([...deviations].sort((a,b)=>Math.abs(b.difference||0)-Math.abs(a.difference||0)))},
    {how:'Total de processos FST distintos nas inspeções consultadas.',
      rows:inspectionRows(distinctBy(records.filter(i=>i.grupos_inspecao?.processos?.id),
        i=>String(i.grupos_inspecao.processos.id)),i=>reportStatus(i.status))},
    {how:'Clientes distintos dos processos vinculados às inspeções, agrupados por nome.',
      rows:inspectionRows(distinctBy(records.filter(i=>i.grupos_inspecao?.processos?.cliente),
        i=>String(i.grupos_inspecao.processos.cliente).trim().toUpperCase()),i=>reportStatus(i.status))},
    {how:'Soma das peças efetivamente avaliadas. Não equivale ao total recebido.',
      rows:inspectionRows(records.filter(i=>Number(i.total_inspecionado)>0),i=>fmt(Number(i.total_inspecionado))+' peças')},
    {how:'(Peças inspecionadas menos unidades NC) dividido pelas peças inspecionadas; sem amostra a taxa não é calculada.',
      rows:inspectionRows(records.filter(i=>Number(i.total_inspecionado)>0),i=>fmt(Number(i.total_nao_conforme||0))+' NC / '+fmt(Number(i.total_inspecionado))+' avaliadas')},
    {how:'Inspeções cujo status já foi formalmente concluído; em andamento não equivale a concluída.',
      rows:inspectionRows(completed,i=>reportStatus(i.status))},
    {how:'Diferença entre INICIAR e CONCLUIR a inspeção, nunca a data de criação. Registros sem início/fim válidos não entram na média.',
      rows:completedDuration.slice(0,60).map(x=>({id:String(x.row.id||''),title:inspectionName(x.row),
        sub:'Início '+new Date(x.row.iniciada_em).toLocaleString('pt-BR')+' · Fim '+new Date(x.row.concluida_em).toLocaleString('pt-BR'),
        value:durationLabel(x.minutes)}))},
    {how:'Soma das unidades recebidas por SKU em cada inspeção. Componentes podem diferir de produtos acabados.',
      rows:skuRows(all.filter(i=>i.received>0)).map((x,k)=>({...x,value:fmt(all.filter(i=>i.received>0)[k].received)+' recebidas'}))},
    {how:'SKUs sem referência válida ou com dados de PV conflitantes, excluídos das comparações.',
      rows:skuRows(all.filter(i=>i.evidence!=='verified'))}
  ]

  return <section className="workspace sgq-insights">
    <div className="insights-heading">
      <div><span className="eyebrow">INTELIGÊNCIA OPERACIONAL</span><h1>Insights</h1><p>Conciliação entre pedido de venda e inspeção, com evidência por SKU.</p></div>
      <button className="secondary" type="button" disabled={loading} onClick={()=>void reload()}><RefreshCw size={16}/> Atualizar</button>
    </div>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="insights-kpis">
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(0)}><span>SKUs com PV validado</span><strong>{fmt(withEvidence.length)}</strong><small>Referência preservada</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(1)}><span>Divergências</span><strong>{fmt(deviations.length)}</strong><small>{withEvidence.length?fmt(100*deviations.length/withEvidence.length)+'% dos comparáveis':'Sem base comparável'}</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(2)}><span>Recebido a menos</span><strong>{fmt(shortages.length)}</strong><small>SKUs abaixo do pedido</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(3)}><span>Diferença absoluta</span><strong>{fmt(totalAbs)}</strong><small>Unidades dos SKUs divergentes</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
    </div>
    <div className="insights-kpis insights-kpis-secondary">
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(4)}><span>Processos</span><strong>{fmt(processCount)}</strong><small>Identificados no SGQ</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(5)}><span>Clientes</span><strong>{fmt(clientCount)}</strong><small>Com inspeções registradas</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(6)}><span>Peças inspecionadas</span><strong>{fmt(inspectedPieces)}</strong><small>{fmt(nonConforming)} unidades NC</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(7)}><span>Conformidade das amostras</span><strong>{conformity===null?'—':fmt(conformity)+'%'}</strong><small>Unidades conformes / inspecionadas</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(8)}><span>Inspeções concluídas</span><strong>{fmt(completed.length)}</strong><small>{fmt(inProgress)} em andamento</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(9)}><span>Tempo médio de inspeção</span><strong>{avgDuration===null?'—':durationLabel(avgDuration)}</strong><small>Início até conclusão ({completedDuration.length})</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(10)}><span>Componentes recebidos</span><strong>{fmt(countedComponents)}</strong><small>Soma dos SKUs nas inspeções</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
      <button type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(11)}><span>SKUs sem referência PV</span><strong>{fmt(all.filter(x=>x.evidence!=='verified').length)}</strong><small>Não comparados automaticamente</small><ChevronRight className="insights-kpi-arrow" size={16}/></button>
    </div>
    {openMetric!==null&&<div className="insights-drilldown-overlay" role="presentation" onClick={()=>setOpenMetric(null)}>
      <section className="insights-drilldown" role="dialog" aria-modal="true" aria-label="Panorama do indicador"
        onClick={e=>e.stopPropagation()}>
        <header><div><small>DETALHAMENTO DO INDICADOR</small>
          <h2>{(["SKUs com PV validado","Divergências","Recebido a menos","Diferença absoluta","Processos","Clientes","Peças inspecionadas","Conformidade das amostras","Inspeções concluídas","Tempo médio de inspeção","Componentes recebidos","SKUs sem referência PV"][openMetric])}</h2>
        </div><button type="button" onClick={()=>setOpenMetric(null)} aria-label="Fechar"><X size={20}/></button></header>
        <p>{metricDetails[openMetric]?.how}</p>
        <div className="insights-drilldown-rows">
          {metricDetails[openMetric]?.rows.length?metricDetails[openMetric].rows.map((line,i)=>
            <button type="button" key={line.id+'-'+i} disabled={!line.id} onClick={()=>{
              setOpenMetric(null);if(line.id)onOpenInspection(line.id)
            }}><span><b>{line.title}</b><small>{line.sub}</small></span>
              <strong>{line.value}</strong><ChevronRight size={15}/></button>):
            <div className="insights-empty">Sem registros para detalhar.</div>}
        </div>
      </section>
    </div>}
    <div className="insights-grid">
      <section className="panel insights-focus">
        <div className="section-title"><h2><AlertTriangle size={17}/> Maiores divergências</h2><small>{fmt(excess.length)} acima do PV</small></div>
        {recent.length===0?<p className="insights-empty">Não há divergências verificáveis nos dados disponíveis.</p>:
          <div className="insights-priority">{recent.map(row=><button type="button" key={row.inspectionId+row.sku} onClick={()=>onOpenInspection(row.inspectionId)}>
            <span><b>{row.fst} · {row.sku}</b><small>PV {row.pv} · Inspeção {row.inspectionNumber}</small></span>
            <b className={row.difference!<0?'insights-negative':'insights-positive'}>{row.difference!>0?'+':''}{fmt(row.difference!)} un.</b>
          </button>)}</div>}
      </section>
      <section className="panel insights-trend">
        <div className="section-title"><h2><BarChart3 size={17}/> Histórico</h2><small>SKUs avaliados por mês</small></div>
        {months.length===0?<p className="insights-empty">Histórico disponível somente para registros com referência do PV preservada.</p>:
          months.map(([key,value])=><div className="insights-month" key={key}>
            <span>{key.slice(5,7)}/{key.slice(2,4)}</span>
            <div className="insights-month-bar" title={value.total+' SKUs, '+value.delta+' divergências'}>
              <div style={{width:(value.total/maxMonth*100)+'%'}}/>
              <div className="insights-month-delta" style={{width:(value.delta/maxMonth*100)+'%'}}/>
            </div>
            <b>{value.delta}/{value.total}</b>
          </div>)}
        <div className="insights-legend"><span><i/> Comparáveis</span><span><i/> Divergentes</span></div>
      </section>
    </div>
    <section className="panel insights-table-panel">
      <div className="section-title"><h2><Activity size={17}/> Análise por processo e produto</h2><small>{filtered.length} registro(s)</small></div>
      <div className="insights-filters">
        <div className="insights-search"><Search size={17}/><input aria-label="Pesquisar Insights por FST, cliente, PV ou SKU" placeholder="Buscar FST, cliente, PV ou SKU" value={term} onChange={e=>setTerm(e.target.value)}/></div>
        <select aria-label="Filtrar divergências" value={scope} onChange={e=>setScope(e.target.value)}>
          <option value="divergente">Divergências</option><option value="todos">Todos</option><option value="com-pv">Com referência PV</option><option value="sem-pv">Sem referência</option>
        </select>
        <select aria-label="Filtrar status de inspeção" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="todos">Todos os status</option><option value="em_andamento">Em andamento</option><option value="aberta">Não iniciada</option><option value="concluida">Concluída</option>
        </select>
      </div>
      {loading?<div className="insights-empty">Consultando registros...</div>:filtered.length===0?
        <div className="insights-empty">Nenhum registro corresponde aos filtros. As inspeções anteriores à captura do PV não têm comparação automática.</div>:
        <div className="insights-table-wrap"><table className="insights-table"><thead><tr>
          <th>Processo / Cliente</th><th>Produto</th><th>PV</th><th>Qtd. PV</th><th>Qtd. inspeção</th><th>Diferença</th><th>Status</th>
        </tr></thead><tbody>
        {filtered.slice(0,200).map((row:InsightRow)=><tr key={row.inspectionId+'-'+row.sku}>
          <td><button type="button" className="insights-detail-link" onClick={()=>onOpenInspection(row.inspectionId)}><strong>{row.fst||'Sem FST'}</strong></button><small>{row.client||'—'} · {date(row.date)}</small></td>
          <td><strong>{row.sku}</strong><small>{row.product||'—'}</small></td>
          <td>{row.pv||'—'}</td><td>{row.ordered===null?'—':fmt(row.ordered)}</td><td>{fmt(row.received)}</td>
          <td>{row.difference===null?<span className="insights-unknown">{row.evidence==='ambiguous'?'Referência inconsistente':'Sem referência'}</span>:
            <span className={row.difference<0?'insights-negative':row.difference>0?'insights-positive':'insights-equal'}>
              {row.difference>0?<ArrowUpRight size={14}/>:row.difference<0?<ArrowDownRight size={14}/>:<ClipboardCheck size={14}/>}
              {row.difference>0?'+':''}{fmt(row.difference)}
            </span>}</td>
          <td><span className="insights-status">{reportStatus(row.status)}</span></td>
        </tr>)}</tbody></table></div>}
      {filtered.length>200&&<p className="insights-footnote">Exibindo os 200 primeiros registros filtrados.</p>}
      <p className="insights-footnote">Indicadores por registros atuais; o tempo considera somente inspeções concluídas com início e término válidos. Componentes não equivalem a produtos acabados. Histórico anterior ao registro do PV permanece sem referência. Limites atuais: 1.000 inspeções e 10.000 vínculos de itens por consulta.</p>
      <p className="insights-footnote">Referência: quantidade original por SKU no PV Omie vinculada à inspeção. Não estima valores ausentes nem compara SKUs com referências conflitantes. Atualização mediante consulta online.</p>
    </section>
  </section>
}
