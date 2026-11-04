import {useEffect,useMemo,useState} from 'react'
import {ArrowLeft,ChevronRight,RefreshCw,Search,X} from 'lucide-react'
import {apiGet} from '../lib/supabase'
import {inspectionInsightRows,type InsightRow} from './insightsData'
import './insights.css'

const fmt=(value:number)=>value.toLocaleString('pt-BR',{maximumFractionDigits:3})
const date=(value:string)=>value?new Date(value).toLocaleDateString('pt-BR'):'—'
const norm=(value:string)=>value.toLocaleLowerCase('pt-BR')
const different=(row:InsightRow)=>row.evidence==='verified'&&row.difference!==null&&Math.abs(row.difference)>0.000001
const signed=(value:number|null)=>value===null?'—':(value>0?'+':'')+fmt(value)

export default function InsightsPage({onOpenInspection,onBack}:{
  onOpenInspection:(id:string)=>void;onBack:()=>void
}){
  const [data,setData]=useState<{inspections:any[];links:any[]}|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [term,setTerm]=useState('')
  const [scope,setScope]=useState('todos')
  const [openMetric,setOpenMetric]=useState<number|null>(null)

  async function reload(){
    if(!navigator.onLine){setError('Sem conexão para consultar os dados.');setLoading(false);return}
    setLoading(true);setError('')
    const reply=await apiGet<any>('/api/app/insights')
    if(reply.error||!reply.data)setError(reply.error?.message||'Não foi possível consultar os dados.')
    else setData(reply.data)
    setLoading(false)
  }
  useEffect(()=>{void reload()},[])

  const all=useMemo(()=>inspectionInsightRows(data?.inspections||[],data?.links||[]),[data])
  const comparable=all.filter(row=>row.evidence==='verified')
  const deviations=all.filter(different)
  const missing=all.filter(row=>row.evidence!=='verified')
  const completed=(data?.inspections||[]).filter(row=>row.status==='concluida')
  const durations=completed.map(row=>row.iniciada_em&&row.concluida_em
    ?(Date.parse(row.concluida_em)-Date.parse(row.iniciada_em))/60000:null)
    .filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0)
  const avgTime=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null
  const readableTime=(minutes:number|null)=>minutes===null?'—':
    Math.floor(minutes/60)+'h '+String(Math.round(minutes%60)).padStart(2,'0')+'min'

  const summary=[
    {label:'Com referência PV',value:fmt(comparable.length),
      info:'SKUs com quantidade e pedido de venda confirmados.',rows:comparable},
    {label:'Divergências',value:fmt(deviations.length),
      info:'Quantidade cadastrada na inspeção diferente da quantidade do PV, por SKU.',rows:deviations},
    {label:'Sem comparação',value:fmt(missing.length),
      info:'PV ausente ou referências conflitantes; estes valores não são tratados como zero.',rows:missing},
    {label:'Tempo médio',value:readableTime(avgTime),
      info:'Entre o início e a conclusão, somente quando ambas as datas existem.',
      rows:completed.map(row=>({
        inspectionId:String(row.id||''),inspectionNumber:String(row.numero||''),
        status:String(row.status||''),date:String(row.criado_em||''),
        fst:String(row.grupos_inspecao?.processos?.codigo||''),client:String(row.grupos_inspecao?.processos?.cliente||''),
        pv:'',sku:'Inspeção concluída',product:'',ordered:null,received:0,difference:null,evidence:'missing' as const
      }))}
  ]
  const filtered=useMemo(()=>all.filter(row=>{
    const search=norm([row.fst,row.client,row.pv,row.sku,row.product,row.inspectionNumber].join(' '))
    if(term.trim()&&!search.includes(norm(term.trim())))return false
    if(scope==='divergentes')return different(row)
    if(scope==='sem-pv')return row.evidence!=='verified'
    if(scope==='com-pv')return row.evidence==='verified'
    return true
  }).sort((a,b)=>Number(different(b))-Number(different(a))||
    Number(b.evidence!=='verified')-Number(a.evidence!=='verified')||
    b.date.localeCompare(a.date)),[all,term,scope])

  return <section className="workspace sgq-insights">
    <header className="insights-heading">
      <div><button type="button" className="insights-back" onClick={onBack}><ArrowLeft size={15}/> Painel</button><h1>Insights</h1></div>
      <button className="secondary small" type="button" disabled={loading} onClick={()=>void reload()}><RefreshCw size={15}/> Atualizar</button>
    </header>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="insights-kpis">
      {summary.map((metric,index)=><button key={metric.label} type="button" className="insights-kpi-card" onClick={()=>setOpenMetric(index)}>
        <span>{metric.label}</span><strong>{metric.value}</strong><ChevronRight size={15}/>
      </button>)}
    </div>
    <section className="panel insights-table-panel">
      <div className="insights-table-heading">
        <h2>Conferência por SKU</h2>
        <span>{fmt(filtered.length)} registros</span>
      </div>
      <div className="insights-filters">
        <label className="insights-search"><Search size={16}/><input aria-label="Buscar por FST, cliente, PV ou SKU" placeholder="Buscar FST, cliente, PV ou SKU" value={term} onChange={event=>setTerm(event.target.value)}/></label>
        <select aria-label="Filtrar comparação" value={scope} onChange={event=>setScope(event.target.value)}>
          <option value="todos">Todos</option><option value="divergentes">Divergências</option>
          <option value="sem-pv">Sem comparação</option><option value="com-pv">Com PV</option>
        </select>
      </div>
      {loading?<p className="insights-empty">Carregando...</p>:filtered.length===0?
        <p className="insights-empty">Nenhum registro encontrado.</p>:
        <div className="insights-table-wrap"><table className="insights-table">
          <thead><tr><th>Processo</th><th>SKU / produto</th><th>PV</th><th>Qtd. PV</th><th>Qtd. cadastrada</th><th>Diferença</th><th>Situação</th></tr></thead>
          <tbody>{filtered.slice(0,500).map(row=><tr key={row.inspectionId+'-'+row.sku}>
            <td><button type="button" className="insights-detail-link" onClick={()=>onOpenInspection(row.inspectionId)}>{row.fst||'Sem FST'}</button><small>{row.client||'—'} · {date(row.date)}</small></td>
            <td><b>{row.sku}</b><small>{row.product||'—'}</small></td>
            <td>{row.pv||'—'}</td>
            <td>{row.ordered===null?'—':fmt(row.ordered)}</td>
            <td>{fmt(row.received)}</td>
            <td className={different(row)?(row.difference!<0?'insights-negative':'insights-positive'):''}>{row.difference===null?'—':signed(row.difference)}</td>
            <td><span className={'insights-state'+(different(row)?' discrepancy':row.evidence!=='verified'?' missing':'')}>
              {row.evidence==='ambiguous'?'PV conflitante':row.evidence==='missing'?'Sem referência PV':different(row)?'Divergente':'Conferido'}
            </span></td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    {openMetric!==null&&<div className="insights-drilldown-overlay" onClick={()=>setOpenMetric(null)} role="presentation">
      <section className="insights-drilldown" role="dialog" aria-modal="true" aria-label={'Detalhes: '+summary[openMetric].label} onClick={event=>event.stopPropagation()}>
        <header><div><h2>{summary[openMetric].label}</h2><p>{summary[openMetric].info}</p></div>
          <button type="button" aria-label="Fechar" onClick={()=>setOpenMetric(null)}><X size={18}/></button></header>
        <div className="insights-drilldown-rows">{summary[openMetric].rows.length?
          summary[openMetric].rows.slice(0,100).map((row,index)=><button type="button" key={row.inspectionId+'-'+row.sku+'-'+index}
            onClick={()=>{setOpenMetric(null);onOpenInspection(row.inspectionId)}}>
            <span><b>{row.fst||row.inspectionNumber} · {row.sku}</b><small>{row.pv?'PV '+row.pv+' · ':''}{row.client}</small></span>
            <strong>{openMetric===3?'Concluída':row.difference===null?'Sem referência':signed(row.difference)+' un.'}</strong><ChevronRight size={15}/>
          </button>):<p className="insights-empty">Sem registros.</p>}</div>
      </section>
    </div>}
  </section>
}
