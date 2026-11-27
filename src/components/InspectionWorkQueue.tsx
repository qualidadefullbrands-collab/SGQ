import {useMemo,useState} from 'react'
import {AlertTriangle,CheckCircle2,ClipboardCheck,Copy,Edit3,FileText,MoreHorizontal,Package,Plus,Search,Trash2} from 'lucide-react'
import './InspectionWorkQueue.css'

type Process={id:string;codigo:string;cliente:string|null;nota_fiscal?:string|null;chegada_cd?:string|null}
type Inspection={
  id:string;numero:string;status:string;resultado:string|null;tamanho_amostra:number|null;total_inspecionado:number;criado_em:string
  grupos_inspecao?:{nome:string;tipo?:string;processo_id:string;id?:string;subprocesso_codigo?:string|null;nota_fiscal?:string|null;chegada_cd?:string|null;processos?:{codigo:string;cliente:string|null;nota_fiscal?:string|null}|null}|null
}
type ItemLink={grupo_inspecao_id:string;grupos_inspecao?:{tipo?:string}|null;processo_itens?:{id?:string;codigo_cliente?:string|null;quantidade?:number|null;produtos?:{sku?:string|null;nome?:string|null}|null}|null}
type Props={
  inspections:Inspection[];processes:Process[];canDelete:boolean;deletingProcessId:string|null
  externalQuery?:string;itemLinksLoading?:boolean;focusProcessId?:string|null
  onOpen:(id:string)=>void;onCreate:()=>void;onReuseProcess:(id:string)=>void;onEditProcess:(id:string)=>void
  onDeleteProcess:(id:string)=>void;onDeleteInspection:(id:string)=>void
  formatFst:(value:string|null|undefined)=>string;itemLinks?:ItemLink[]
}
type Filter='ativas'|'aberta'|'em_andamento'|'concluida'|'todas'
const filterOptions:Array<{id:Filter;label:string}>=[
  {id:'ativas',label:'Pendentes e em execução'},{id:'aberta',label:'Não iniciadas'},
  {id:'em_andamento',label:'Em andamento'},{id:'concluida',label:'Concluídas'},{id:'todas',label:'Todas'}
]
const statusLabel:Record<string,string>={aberta:'Não iniciada',em_andamento:'Em andamento',concluida:'Concluída'}
function normalize(value:unknown){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function arrivalDate(value:string|null|undefined){
  if(!value)return ''
  const raw=String(value).slice(0,10),[year,month,day]=raw.split('-')
  return year&&month&&day?day+'/'+month+'/'+year:raw
}
function InspectionActions({inspection,process,canDelete,deletingProcessId,onReuseProcess,onEditProcess,onDeleteProcess,onDeleteInspection}:{
  inspection:Inspection;process:Process|undefined;canDelete:boolean;deletingProcessId:string|null
  onReuseProcess:(id:string)=>void;onEditProcess:(id:string)=>void;onDeleteProcess:(id:string)=>void;onDeleteInspection:(id:string)=>void
}){
  if(!process&&!canDelete)return null
  return <details className="sgq-work-actions-menu">
    <summary aria-label="Mais ações da inspeção" title="Mais ações"><MoreHorizontal size={17}/></summary>
    <div>
      {process&&<button type="button" onClick={()=>onReuseProcess(process.id)}><Copy size={14}/> Nova entrada</button>}
      {process&&<button type="button" onClick={()=>onEditProcess(process.id)}><Edit3 size={14}/> Editar processo</button>}
      {canDelete&&<button type="button" className="danger-item" onClick={()=>onDeleteInspection(inspection.id)}><Trash2 size={14}/> Excluir inspeção</button>}
      {canDelete&&process&&<button type="button" className="danger-item" disabled={deletingProcessId!==null} onClick={()=>onDeleteProcess(process.id)}><Trash2 size={14}/> Excluir processo</button>}
    </div>
  </details>
}
export default function InspectionWorkQueue({
  inspections,processes,canDelete,deletingProcessId,externalQuery,itemLinksLoading=false,focusProcessId=null,
  onOpen,onCreate,onReuseProcess,onEditProcess,onDeleteProcess,onDeleteInspection,formatFst,itemLinks=[]
}:Props){
  const [query,setQuery]=useState('')
  const [filter,setFilter]=useState<Filter>('ativas')
  const search=normalize(query||externalQuery||'')
  const processById=useMemo(()=>new Map(processes.map(process=>[process.id,process])),[processes])
  const productsByGroup=useMemo(()=>{
    const result=new Map<string,Array<{sku:string;description:string}>>(),seen=new Map<string,Set<string>>()
    for(const link of itemLinks){
      const groupId=link.grupo_inspecao_id
      const sku=String(link.processo_itens?.produtos?.sku||link.processo_itens?.codigo_cliente||'').trim()
      const description=String(link.processo_itens?.produtos?.nome||'').trim()
      if(!sku&&!description)continue
      const key=sku+'|'+description,keys=seen.get(groupId)||new Set<string>()
      if(keys.has(key))continue
      keys.add(key);seen.set(groupId,keys)
      const current=result.get(groupId)||[]
      current.push({sku,description});result.set(groupId,current)
    }
    return result
  },[itemLinks])
  const rows=useMemo(()=>inspections.filter(item=>item.status!=='cancelada').map(item=>{
    const group=item.grupos_inspecao,process=processById.get(group?.processo_id??''),linked=group?.processos
    const products=productsByGroup.get(group?.id??'')||[]
    const isKit=String(group?.tipo||'')==='kit_componentes',needsReview=products.length>1&&!isKit
    const processCode=process?.codigo||linked?.codigo||'',client=process?.cliente??linked?.cliente??'Cliente não informado'
    const invoice=group?.nota_fiscal||linked?.nota_fiscal||process?.nota_fiscal||null
    const arrival=group?.chegada_cd||process?.chegada_cd||null
    const inspected=Math.max(0,Number(item.total_inspecionado)||0),sample=Math.max(0,Number(item.tamanho_amostra)||0)
    const progress=sample>0?Math.min(100,Math.round(inspected/sample*100)):0
    return {item,group,process,products,isKit,needsReview,processCode,client,invoice,arrival,inspected,sample,progress}
  }).filter(row=>!search||normalize([
    row.item.numero,row.processCode,formatFst(row.processCode),row.client,row.invoice,row.arrival,row.group?.subprocesso_codigo,row.group?.nome,
    ...row.products.flatMap(product=>[product.sku,product.description])
  ].join(' ')).includes(search)).sort((a,b)=>{
    const rank=(status:string)=>status==='em_andamento'?0:status==='aberta'?1:status==='concluida'?2:3
    return rank(a.item.status)-rank(b.item.status)||String(b.item.criado_em||'').localeCompare(String(a.item.criado_em||''))
  }),[inspections,processById,productsByGroup,search,formatFst])
  const counts=useMemo(()=>({
    aberta:rows.filter(row=>row.item.status==='aberta').length,
    em_andamento:rows.filter(row=>row.item.status==='em_andamento').length,
    concluida:rows.filter(row=>row.item.status==='concluida').length,
    ativas:rows.filter(row=>row.item.status==='aberta'||row.item.status==='em_andamento').length,
    todas:rows.length
  }),[rows])
  const filteredRows=rows.filter(row=>{
    if(filter==='ativas')return row.item.status==='aberta'||row.item.status==='em_andamento'
    if(filter==='todas')return true
    return row.item.status===filter
  })
  const activeProcessIds=useMemo(()=>new Set(inspections.filter(item=>item.status!=='cancelada')
    .map(item=>item.grupos_inspecao?.processo_id).filter((id):id is string=>Boolean(id))),[inspections])
  const processesWithoutEntry=useMemo(()=>processes.filter(process=>!activeProcessIds.has(process.id)&&
    (!search||normalize([process.codigo,formatFst(process.codigo),process.cliente,process.nota_fiscal].join(' ')).includes(search)))
    .sort((a,b)=>Number(b.id===focusProcessId)-Number(a.id===focusProcessId)),[processes,activeProcessIds,search,focusProcessId,formatFst])
  const countLabel=filter==='ativas'?counts.ativas:filter==='todas'?counts.todas:counts[filter]
  return <section className="sgq-inspection-center" aria-label="Central de inspeções">
    <header className="sgq-center-header">
      <div><span className="sgq-center-eyebrow"><ClipboardCheck size={15}/> QUALIDADE · OPERAÇÃO</span>
        <h1>Central de inspeções</h1><p>Veja o que precisa começar, continuar ou ter o resultado consultado.</p></div>
      <button type="button" className="sgq-center-create" onClick={onCreate}><Plus size={17}/> Nova inspeção</button>
    </header>
    <div className="sgq-center-toolbar">
      <label className="sgq-center-search"><Search size={17}/>
        <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar FST, cliente, SKU ou NF" aria-label="Buscar inspeções por FST, cliente, SKU ou nota fiscal"/>
        {query&&<button type="button" onClick={()=>setQuery('')} aria-label="Limpar busca">×</button>}
      </label>
      <div className="sgq-center-total"><strong>{countLabel}</strong><span>{countLabel===1?'inspeção':'inspeções'} nesta visualização</span></div>
    </div>
    <nav className="sgq-center-filters" aria-label="Filtrar inspeções por situação">
      {filterOptions.map(option=>{
        const count=option.id==='ativas'?counts.ativas:option.id==='todas'?counts.todas:counts[option.id]
        return <button key={option.id} type="button" className={filter===option.id?'is-active':''}
          aria-pressed={filter===option.id} onClick={()=>setFilter(option.id)}><span>{option.label}</span><b>{count}</b></button>
      })}
    </nav>
    <section className="sgq-center-list" aria-label="Fila de trabalho das inspeções">
      {filteredRows.map(row=>{
        const status=row.item.status,result=row.item.resultado==='aprovado'?'Aprovada':row.item.resultado==='reprovado'?'Reprovada':null
        const action=status==='aberta'?'Preparar inspeção':status==='em_andamento'?'Continuar inspeção':'Ver resultado'
        const entry=row.group?.subprocesso_codigo||'—'
        const classification=row.isKit?'Kit · '+row.products.length+' componentes':row.needsReview?'Relação de SKUs a confirmar':row.products.length===1?'SKU independente':'Produto'
        return <article className="sgq-work-row" key={row.item.id}>
          <div className="sgq-work-identity">
            <div className="sgq-work-code-line"><strong>{formatFst(row.processCode)||'FST não informado'}</strong><span>Entrada {entry}</span></div>
            <b className="sgq-work-client">{row.client}</b>
            <div className="sgq-work-meta">{row.invoice&&<span>NF {row.invoice}</span>}{row.arrival&&<span>Chegada {arrivalDate(row.arrival)}</span>}</div>
          </div>
          <div className="sgq-work-products">
            <div className="sgq-work-products-heading"><span>Produtos da inspeção</span>
              <span className={'sgq-work-classification '+(row.isKit?'is-kit':row.needsReview?'needs-review':'')}>
                {row.needsReview&&<AlertTriangle size={12}/ >}{row.isKit&&<Package size={12}/ >}{classification}
              </span>
            </div>
            {row.products.length>0?<div className="sgq-work-sku-list">{row.products.map((product,index)=><div key={product.sku+'-'+index}>
              <b>{product.sku||'SKU não informado'}</b><span>{product.description||'Descrição não informada'}</span>
            </div>)}</div>:<small>{itemLinksLoading?'Carregando SKUs…':'SKU ainda não vinculado'}</small>}
          </div>
          <div className="sgq-work-progress">
            <span className={'sgq-work-status status-'+status}>{statusLabel[status]||status}</span>
            {row.sample>0&&<div className="sgq-work-progress-copy"><span>Amostragem</span><b>{row.inspected.toLocaleString('pt-BR')} / {row.sample.toLocaleString('pt-BR')}</b>
              <div className="sgq-work-progress-track" role="progressbar" aria-label={'Amostragem '+formatFst(row.processCode)+' entrada '+entry}
                aria-valuenow={row.progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:row.progress+'%'}}/></div>
            </div>}
            {result&&<span className={'sgq-work-result '+(row.item.resultado==='aprovado'?'is-approved':'is-rejected')}>{result}</span>}
          </div>
          <div className="sgq-work-row-actions">
            <button type="button" className="sgq-work-open" onClick={()=>onOpen(row.item.id)}>
              {status==='concluida'?<FileText size={15}/>:status==='em_andamento'?<CheckCircle2 size={15}/>:<ClipboardCheck size={15}/ >}{action}
            </button>
            <InspectionActions inspection={row.item} process={row.process} canDelete={canDelete} deletingProcessId={deletingProcessId}
              onReuseProcess={onReuseProcess} onEditProcess={onEditProcess} onDeleteProcess={onDeleteProcess} onDeleteInspection={onDeleteInspection}/>
          </div>
        </article>
      })}
      {!filteredRows.length&&<div className="sgq-center-empty">{search?'Nenhuma inspeção corresponde à busca.':'Não há inspeções nesta situação.'}</div>}
    </section>
    {processesWithoutEntry.length>0&&filter!=='concluida'&&filter!=='em_andamento'&&<section className="sgq-center-unassigned">
      <header><div><h2>Processos sem entrada</h2><p>Registros que ainda precisam ser transformados em uma inspeção.</p></div><span>{processesWithoutEntry.length}</span></header>
      <div className="sgq-center-unassigned-list">{processesWithoutEntry.map(process=><article key={process.id}>
        <div><strong>{formatFst(process.codigo)}</strong><span>{process.cliente||'Cliente não informado'}</span></div>
        <button type="button" onClick={()=>onReuseProcess(process.id)}><Plus size={15}/> Criar entrada</button>
      </article>)}</div>
    </section>}
  </section>
}
