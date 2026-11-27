import {useMemo,useState} from 'react'
import {AlertTriangle,CheckCircle2,ChevronRight,ClipboardCheck,Copy,Edit3,MoreHorizontal,Package,Play,Plus,Search,Trash2} from 'lucide-react'
import {indexActiveInspections,workspaceQuery,canTransitionInspection,workQueue,workQueueCounts} from '../lib/inspection-board.mjs'
import './InspectionsKanban.css'

type Process={
  id:string
  codigo:string
  cliente:string|null
  nota_fiscal?:string|null
  status?:string
  it_versao_id?:string|null
  chegada_cd?:string|null
}
type Inspection={
  id:string
  numero:string
  status:string
  resultado:string|null
  tamanho_amostra:number|null
  total_inspecionado:number
  criado_em:string
  grupos_inspecao?:{
    nome:string
    tipo?:string
    processo_id:string
    id?:string
    subprocesso_codigo?:string|null
    nota_fiscal?:string|null
    chegada_cd?:string|null
    processos?:{codigo:string;cliente:string|null;nota_fiscal?:string|null}|null
  }|null
}
type ItemLink={
  grupo_inspecao_id:string
  grupos_inspecao?:{tipo?:string}|null
  processo_itens?:{id?:string;codigo_cliente?:string|null;quantidade?:number|null;produtos?:{sku?:string|null;nome?:string|null}|null}|null
}
type Props={
  inspections:Inspection[]
  processes:Process[]
  canDelete:boolean
  deletingProcessId:string|null
  canMove?:boolean
  movingInspectionId?:string|null
  onMove?:(id:string,target:'aberta'|'em_andamento')=>void
  mode?:'page'|'panel'
  initialView?:'processos'|'kanban'
  externalQuery?:string
  itemLinksLoading?:boolean
  focusProcessId?:string|null
  onViewAll?:()=>void
  onOpen:(id:string)=>void
  onCreate:()=>void
  onReuseProcess:(id:string)=>void
  onEditProcess:(id:string)=>void
  onDeleteProcess:(id:string)=>void
  onDeleteInspection:(id:string)=>void
  formatFst:(value:string|null|undefined)=>string
  itemLinks?:ItemLink[]
}
const columns=[
  {status:'aberta',label:'Não iniciadas',tone:'queued'},
  {status:'em_andamento',label:'Em andamento',tone:'active'},
  {status:'concluida',label:'Concluídas',tone:'done'}
] as const

function formatArrival(value:string|null|undefined){
  if(!value)return '—'
  const raw=String(value).slice(0,10)
  const [year,month,day]=raw.split('-')
  return year&&month&&day?`${day}/${month}/${year}`:raw
}
function normalized(value:unknown){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
}
function formatQuantity(value:number){
  return Math.max(0,Math.floor(Number(value)||0)).toLocaleString('pt-BR')
}
function InspectionMenu({inspection,process,canDelete,deletingProcessId,onReuseProcess,onEditProcess,onDeleteProcess,onDeleteInspection}:{
  inspection:Inspection
  process:Process|undefined
  canDelete:boolean
  deletingProcessId:string|null
  onReuseProcess:(id:string)=>void
  onEditProcess:(id:string)=>void
  onDeleteProcess:(id:string)=>void
  onDeleteInspection:(id:string)=>void
}){
  if(!process&&!canDelete)return null
  const fst=process?.codigo||inspection.grupos_inspecao?.processos?.codigo||''
  return <details className="sgq-kanban-actions">
    <summary title="Ações da inspeção" aria-label={'Ações de '+fst}><MoreHorizontal size={18}/></summary>
    <div className="sgq-kanban-actions-menu">
      {process&&<button type="button" onClick={()=>onReuseProcess(process.id)}><Copy size={15}/> Nova entrada</button>}
      {process&&<button type="button" onClick={()=>onEditProcess(process.id)}><Edit3 size={15}/> Editar processo</button>}
      {canDelete&&<button type="button" className="danger-item" onClick={()=>onDeleteInspection(inspection.id)}><Trash2 size={15}/> Excluir inspeção</button>}
      {canDelete&&process&&<button type="button" className="danger-item" disabled={deletingProcessId!==null} onClick={()=>onDeleteProcess(process.id)}><Trash2 size={15}/> {deletingProcessId===process.id?'Excluindo…':'Excluir processo'}</button>}
    </div>
  </details>
}

export default function InspectionsKanban({
  inspections,processes,canDelete,deletingProcessId,canMove=false,movingInspectionId=null,onMove,
  mode='page',initialView='processos',externalQuery,focusProcessId=null,onViewAll,onOpen,onCreate,onReuseProcess,onEditProcess,
  onDeleteProcess,onDeleteInspection,formatFst,itemLinks=[],itemLinksLoading=false
}:Props){
  const [query,setQuery]=useState('')
  const [view,setView]=useState<'processos'|'kanban'>(initialView)
  const [expandedProcessId,setExpandedProcessId]=useState<string|null>(null)
  const [shownByLane,setShownByLane]=useState<Record<string,number>>({})
  const [workFilter,setWorkFilter]=useState<'pendentes'|'em_andamento'|'aberta'|'concluida'|'todas'>('pendentes')
  const pageSize=mode==='panel'?8:24
  const effectiveQuery=workspaceQuery(mode,query,externalQuery)
  const search=normalized(effectiveQuery)
  const processById=useMemo(()=>new Map(processes.map(p=>[p.id,p])),[processes])
  const linkedItemsByGroup=useMemo(()=>{
    const items=new Map<string,Array<{sku:string;descricao:string;quantidade:number|null}>>()
    for(const link of itemLinks){
      const sku=String(link.processo_itens?.produtos?.sku||link.processo_itens?.codigo_cliente||'').trim()
      const descricao=String(link.processo_itens?.produtos?.nome||'').trim()
      if(!sku&&!descricao)continue
      const current=items.get(link.grupo_inspecao_id)||[]
      if(!current.some(x=>x.sku===sku&&x.descricao===descricao))
        current.push({sku,descricao,quantidade:link.processo_itens?.quantidade??null})
      items.set(link.grupo_inspecao_id,current)
    }
    return items
  },[itemLinks])
  const groupTypeById=useMemo(()=>{
    const types=new Map<string,string>()
    for(const link of itemLinks)if(link.grupos_inspecao?.tipo)types.set(link.grupo_inspecao_id,String(link.grupos_inspecao.tipo))
    return types
  },[itemLinks])
  const visible=useMemo(()=>{
    const sorted=inspections.filter(i=>i.status!=='cancelada').sort((a,b)=>
      String(b.criado_em||'').localeCompare(String(a.criado_em||'')))
    if(!search)return sorted
    return sorted.filter(item=>{
      const group=item.grupos_inspecao
      const process=processById.get(group?.processo_id??'')
      const linked=group?.processos
      const products=linkedItemsByGroup.get(group?.id??'')||[]
      return normalized([
        item.numero,group?.nome,process?.codigo,linked?.codigo,group?.subprocesso_codigo,
        group?.nota_fiscal,group?.chegada_cd,process?.cliente,linked?.cliente,
        process?.nota_fiscal,linked?.nota_fiscal,
        ...products.flatMap(x=>[x.sku,x.descricao])
      ].join(' ')).includes(search)
    })
  },[inspections,processById,linkedItemsByGroup,search])
  const columnsToShow=useMemo(()=>columns.map(c=>({...c,items:visible.filter(i=>i.status===c.status)}))
    .concat(visible.some(i=>!columns.some(c=>c.status===i.status))?[{
      status:'other',label:'Outras',tone:'other',items:visible.filter(i=>!columns.some(c=>c.status===i.status))
    } as any]:[]),[visible])
  const workCounts=useMemo(()=>workQueueCounts(visible),[visible])
  const displayColumns=useMemo(()=>mode==='panel'?columnsToShow:[{status:'work',label:'Lista de trabalho',tone:'work',items:workQueue(visible,workFilter)}],[mode,columnsToShow,visible,workFilter])
  const inspectionsByProcess=useMemo(()=>indexActiveInspections(inspections),[inspections])
  const processTree=useMemo(()=>processes.map(process=>{
    const own=inspectionsByProcess.get(process.id)||[]
    const groups=new Map<string,{key:string;letter:string;invoice:string|null;arrival:string|null;name:string;items:Inspection[]}>()
    for(const item of own){
      const group=item.grupos_inspecao
      const letter=String(group?.subprocesso_codigo??'').trim().toUpperCase()
      const key=group?.id||letter||item.id
      const prior=groups.get(key)
      if(prior)prior.items.push(item)
      else groups.set(key,{key,letter,invoice:group?.nota_fiscal??null,arrival:group?.chegada_cd??null,name:group?.nome??'Inspeção',items:[item]})
    }
    const subprocesses=[...groups.values()].sort((a,b)=>a.letter.localeCompare(b.letter,'pt-BR')||a.name.localeCompare(b.name,'pt-BR'))
    const searchable=normalized([
      process.codigo,formatFst(process.codigo),process.cliente,process.nota_fiscal,process.chegada_cd,
      ...subprocesses.flatMap(sub=>[
        sub.letter,sub.letter?formatFst(process.codigo)+'-'+sub.letter:'',sub.invoice,sub.arrival,sub.name,
        ...sub.items.map(item=>item.numero),
        ...(linkedItemsByGroup.get(sub.key)||[]).flatMap(x=>[x.sku,x.descricao])
      ])
    ].join(' '))
    return {process,subprocesses,searchable,inspectionCount:own.length,
      allCompleted:own.length>0&&own.every(item=>item.status==='concluida'),
      anyStarted:own.some(item=>item.status==='em_andamento')}
  }).filter(entry=>!search||entry.searchable.includes(search))
    .sort((a,b)=>Number(b.process.id===focusProcessId)-Number(a.process.id===focusProcessId)),
  [inspectionsByProcess,processes,search,focusProcessId,linkedItemsByGroup,formatFst])
  const activeProcessIds=useMemo(()=>new Set(inspections.map(i=>i.grupos_inspecao?.processo_id).filter(Boolean)),[inspections])
  const emptyProcesses=processes.filter(p=>!activeProcessIds.has(p.id)&&
    (!search||normalized([p.codigo,p.cliente,p.nota_fiscal].join(' ')).includes(search)))
  const totalMatches=visible.length+emptyProcesses.length
  const canMoveCard=(item:Inspection)=>canTransitionInspection(item.status,Boolean(canMove&&onMove),Boolean(movingInspectionId))
  const moveCard=(id:string,target:'aberta'|'em_andamento')=>{
    const item=inspections.find(i=>i.id===id)
    if(!item||!canMoveCard(item)||item.status===target)return
    onMove?.(id,target)
  }
  const searchInput=<label className="sgq-kanban-search">
    <Search size={17}/>
    <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar FST, cliente, SKU ou NF" aria-label="Buscar FST, cliente, SKU ou nota fiscal"/>
    {query&&<button type="button" onClick={()=>setQuery('')} aria-label="Limpar busca">×</button>}
  </label>
  return <section className={'workspace sgq-kanban-page '+(mode==='panel'?'sgq-kanban-embedded':'')} aria-label="Inspeções">
    <header className="sgq-kanban-toolbar">
      <div className="sgq-kanban-title">
        {mode==='panel'?<h2>Inspeções</h2>:<><h1>{view==='processos'?'Processos':'Central de inspeções'}</h1><p>{view==='processos'?'Entradas e dados de cada FST.':'Retome as inspeções em andamento ou escolha o próximo trabalho da fila.'}</p></>}
        <span className="sgq-kanban-total">{mode==='panel'?inspections.filter(i=>i.status!=='cancelada').length:view==='processos'?processTree.length:workCounts[workFilter]}</span>
      </div>
      {mode==='panel'?<button type="button" className="secondary small" onClick={onViewAll}>Ver todas</button>:
      <div className="sgq-kanban-tools">
        {searchInput}
        <div className="sgq-process-view-toggle" role="group" aria-label="Visualizar processos ou lista de trabalho">
          <button type="button" className={view==='processos'?'is-active':''} aria-pressed={view==='processos'} onClick={()=>setView('processos')}>Processos</button>
          <button type="button" className={view==='kanban'?'is-active':''} aria-pressed={view==='kanban'} onClick={()=>setView('kanban')}>Lista de trabalho</button>
        </div>
        <button type="button" className="primary sgq-kanban-new" onClick={onCreate}><Plus size={17}/> Nova inspeção</button>
      </div>}
    </header>

    {mode==='page'&&view==='processos'&&<section className="sgq-process-tree" aria-label="Processos e entradas">
      {processTree.map(entry=>{
        const process=entry.process
        const processLabel=formatFst(process.codigo)
        const expanded=search.length>0||expandedProcessId===process.id||
          (expandedProcessId===null&&process.id===(focusProcessId||processTree[0]?.process.id))
        const progressLabel=entry.allCompleted?'Concluído':entry.anyStarted?'Em andamento':'Não iniciado'
        return <article className="sgq-process-node" key={process.id}>
          <div className="sgq-process-node-heading">
            <button type="button" className="sgq-process-node-toggle" onClick={()=>setExpandedProcessId(expanded?'':process.id)} aria-expanded={expanded} aria-controls={'sgq-process-children-'+process.id}>
              <ChevronRight size={18} className={expanded?'is-expanded':''}/>
              <span className="sgq-process-node-identity">
                <span className="sgq-process-identity-head"><strong>{processLabel}</strong>
                  <small className="sgq-process-arrival">Chegada ao CD: {formatArrival(process.chegada_cd)}</small></span>
                <span>{process.cliente||'Cliente não informado'}</span>
              </span>
            </button>
            <div className="sgq-process-node-summary"><span>{entry.subprocesses.length} entrada(s)</span><span className={'sgq-process-status '+(entry.allCompleted?'is-complete':'')}>{progressLabel}</span></div>
            <div className="sgq-process-node-actions">
              <button type="button" onClick={()=>onReuseProcess(process.id)}><Plus size={15}/> Nova entrada</button>
              <button type="button" onClick={()=>onEditProcess(process.id)}><Edit3 size={15}/> Editar processo</button>
              {canDelete&&<button type="button" className="sgq-process-danger" disabled={deletingProcessId!==null} onClick={()=>onDeleteProcess(process.id)} title={'Excluir '+processLabel}><Trash2 size={15}/></button>}
            </div>
          </div>
          {expanded&&<div className="sgq-process-children" id={'sgq-process-children-'+process.id}>
            {entry.subprocesses.map(sub=>{
              const done=sub.items.length>0&&sub.items.every(i=>i.status==='concluida')
              const started=sub.items.some(i=>i.status==='em_andamento')
              const products=linkedItemsByGroup.get(sub.key)||[]
              const groupType=groupTypeById.get(sub.key)||sub.items[0]?.grupos_inspecao?.tipo||'individual'
              const isKit=groupType==='kit_componentes'
              const needsReview=products.length>1&&!isKit
              return <section className="sgq-subprocess-node" key={sub.key}>
                <div className="sgq-subprocess-node-heading">
                  <span className="sgq-subprocess-letter">{sub.letter||'—'}</span>
                  <div className="sgq-subprocess-node-name">
                    <strong>Entrada {sub.letter||'—'}</strong>
                    <div className="sgq-subprocess-products">
                      {products.length?products.map((product,i)=><span key={product.sku+'-'+i} className="sgq-subprocess-product"><b>{product.sku||'SKU não informado'}</b><span>{product.descricao||'Descrição não informada'}</span></span>)
                        :<span>{itemLinksLoading?'Carregando SKUs…':'SKUs não vinculados'}</span>}
                    </div>
                  </div>
                  <span className="sgq-subprocess-invoice">{sub.invoice?'NF '+sub.invoice:'NF não informada'}</span>
                  <span className={'sgq-kit-type '+(isKit?'is-kit':needsReview?'needs-review':'')}>{needsReview?<><AlertTriangle size={13}/> Revisar SKUs</>:isKit?<><Package size={13}/> Conjunto</>:<><Package size={13}/> Produto</>}</span>
                  <span className={'sgq-process-status '+(done?'is-complete':'')}>{done?'Concluída':started?'Em andamento':'Não iniciada'}</span>
                </div>
                {sub.items.map(item=><div className="sgq-subprocess-inspection" key={item.id}>
                  <span className="sgq-subprocess-inspection-number">Inspeção</span>
                  <span>{item.status==='concluida'?(item.resultado==='aprovado'?'Aprovado':item.resultado==='reprovado'?'Reprovado':'Concluída'):item.status==='em_andamento'?'Em andamento':'Não iniciada'}</span>
                  <button type="button" onClick={()=>onOpen(item.id)}>{item.status==='concluida'?<CheckCircle2 size={15}/>:<ChevronRight size={15}/>} Abrir inspeção</button>
                </div>)}
              </section>
            })}
            {!entry.subprocesses.length&&<div className="sgq-process-empty">Nenhuma entrada cadastrada.<button type="button" onClick={()=>onReuseProcess(process.id)}><Plus size={15}/> Adicionar entrada</button></div>}
          </div>}
        </article>
      })}
      {!processTree.length&&<div className="sgq-kanban-no-results">{search?'Nenhum processo encontrado para “'+query+'”.':'Nenhum processo cadastrado.'}</div>}
    </section>}

    {mode==='page'&&view==='kanban'&&<div className="sgq-work-filters" role="group" aria-label="Filtrar fila de inspeções">
      {([{id:'pendentes',label:'Fila de trabalho'},{id:'em_andamento',label:'Em andamento'},{id:'aberta',label:'A iniciar'},{id:'concluida',label:'Histórico'},{id:'todas',label:'Todas'}] as const).map(filter=><button key={filter.id} type="button" aria-pressed={workFilter===filter.id} onClick={()=>{setWorkFilter(filter.id);setShownByLane({})}}><span>{filter.label}</span><strong>{workCounts[filter.id]}</strong></button>)}
    </div>}
    {(mode==='panel'||view==='kanban')&&<div className={'sgq-kanban-board '+(mode==='page'?'sgq-work-list':'')} aria-label={mode==='page'?'Lista de trabalho de inspeções':'Quadro Kanban de inspeções'}>
      {displayColumns.map(column=><section id={'sgq-kanban-lane-'+column.status} className={'sgq-kanban-lane tone-'+column.tone} key={column.status} aria-label={column.label}>
        {mode==='panel'&&<div className="sgq-kanban-lane-head"><span className="sgq-kanban-lane-dot" aria-hidden="true"/><h2>{column.label}</h2><span className="sgq-kanban-lane-count">{column.items.length}</span></div>}
        <div className="sgq-kanban-lane-content">
          {column.items.slice(0,shownByLane[column.status]??pageSize).map(item=>{
            const group=item.grupos_inspecao
            const process=processById.get(group?.processo_id??'')
            const linked=group?.processos
            const processCode=formatFst(process?.codigo??linked?.codigo)
            const entryCode=group?.subprocesso_codigo||'—'
            const client=process?.cliente??linked?.cliente
            const products=linkedItemsByGroup.get(group?.id??'')||[]
            const groupType=groupTypeById.get(group?.id??'')||group?.tipo||'individual'
            const isKit=groupType==='kit_componentes'
            const needsReview=products.length>1&&!isKit
            const target=Number(item.tamanho_amostra)||0
            const inspected=Number(item.total_inspecionado)||0
            const percent=target>0?Math.min(100,Math.max(0,(inspected/target)*100)):0
            const done=item.status==='concluida'
            const active=item.status==='em_andamento'
            const result=item.resultado==='aprovado'?'Aprovada':item.resultado==='reprovado'?'Reprovada':null
            return <article className="sgq-kanban-card" key={item.id}>
              <div className="sgq-kanban-card-top">
                <span className="sgq-kanban-fst">{processCode||'FST não informado'}</span>
                <span className="sgq-kanban-entry">Entrada {entryCode}</span>
                {mode==='page'&&<span className="sgq-work-status">{done?'Concluída':active?'Em andamento':item.status==='aberta'?'A iniciar':item.status}</span>}
                <InspectionMenu inspection={item} process={process} canDelete={canDelete} deletingProcessId={deletingProcessId}
                  onReuseProcess={onReuseProcess} onEditProcess={onEditProcess} onDeleteProcess={onDeleteProcess} onDeleteInspection={onDeleteInspection}/>
              </div>
              <h3 title={client||'Cliente não informado'}>{client||'Cliente não informado'}</h3>
              <div className="sgq-kanban-card-meta">
                <span>{group?.nota_fiscal?'NF '+group.nota_fiscal:'NF não informada'}</span><span>Chegada {formatArrival(group?.chegada_cd)}</span>
              </div>
              <div className="sgq-kanban-card-products">
                <div className="sgq-kanban-products-title">
                  <span>Produtos</span>
                  <span className={'sgq-kit-type '+(isKit?'is-kit':needsReview?'needs-review':'')}>{needsReview?<><AlertTriangle size={12}/> Revisar</>:isKit?<><Package size={12}/> Conjunto · {products.length} SKUs</>:<><Package size={12}/> Produto</>}</span>
                </div>
                {products.length?products.map((product,i)=><div className="sgq-kanban-product-row" key={product.sku+'-'+i}>
                  <b>{product.sku||'SKU não informado'}</b><span>{product.descricao||'Descrição não informada'}</span>
                </div>):<small>{itemLinksLoading?'Carregando SKUs…':'Nenhum SKU vinculado'}</small>}
              </div>
              {(active||done)&&target>0&&<div className="sgq-kanban-progress">
                <div className="sgq-kanban-progress-label"><span>Amostra inspecionada</span><strong>{formatQuantity(inspected)} / {formatQuantity(target)}</strong></div>
                <div className="sgq-kanban-progress-track" role="progressbar" aria-label={'Amostragem '+processCode+'-'+entryCode} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{width:percent+'%'}}/></div>
              </div>}
              <div className="sgq-kanban-card-bottom">
                {result?<span className={'sgq-kanban-result '+(item.resultado==='aprovado'?'is-approved':'is-rejected')}>{result}</span>:<span className="sgq-kanban-card-spacer"/>}
                {canMove&&onMove&&(active||item.status==='aberta')&&
                  <button className="sgq-kanban-move" type="button" disabled={!!movingInspectionId} onClick={()=>moveCard(item.id,active?'aberta':'em_andamento')}>
                    {active?'Voltar para não iniciada':'Iniciar inspeção'}
                  </button>}
                <button className="sgq-kanban-open" type="button" onClick={()=>onOpen(item.id)}>
                  {active?<Play size={14}/>:done?<CheckCircle2 size={15}/>:<ChevronRight size={16}/>}
                  {active?(mode==='page'&&target>0&&inspected<target?'Continuar amostragem':'Continuar inspeção'):done?'Ver inspeção':'Abrir inspeção'}
                </button>
              </div>
            </article>
          })}
          {column.items.length>(shownByLane[column.status]??pageSize)&&
            <button type="button" className="sgq-kanban-loadmore" onClick={()=>setShownByLane(current=>({...current,[column.status]:(current[column.status]??pageSize)+pageSize}))}>Ver mais</button>}
          {!column.items.length&&<div className="sgq-kanban-empty">{mode==='page'?'Nenhuma inspeção neste filtro.':'Nenhuma inspeção nesta etapa'}</div>}
        </div>
      </section>)}
    </div>}
    {mode==='page'&&view==='kanban'&&(workFilter==='pendentes'||workFilter==='todas')&&emptyProcesses.length>0&&<section className="sgq-kanban-unassigned" aria-label="Processos sem inspeção">
      <div className="sgq-kanban-unassigned-head"><ClipboardCheck size={17}/><h2>Processos sem entrada</h2><span>{emptyProcesses.length}</span></div>
      <div className="sgq-kanban-unassigned-list">
        {emptyProcesses.map(process=><article className="sgq-kanban-unassigned-card" key={process.id}>
          <div><strong>{formatFst(process.codigo)}</strong><span>{process.cliente||'Cliente não informado'}</span></div>
          <div className="sgq-kanban-unassigned-actions">
            <button type="button" onClick={()=>onReuseProcess(process.id)} title="Nova entrada neste processo" aria-label={'Nova entrada em '+formatFst(process.codigo)}><Plus size={16}/></button>
            <button type="button" onClick={()=>onEditProcess(process.id)} title="Editar processo" aria-label={'Editar '+formatFst(process.codigo)}><Edit3 size={16}/></button>
            {canDelete&&<button type="button" onClick={()=>onDeleteProcess(process.id)} className="danger-item" disabled={deletingProcessId!==null} title="Excluir processo" aria-label={'Excluir '+formatFst(process.codigo)}><Trash2 size={15}/></button>}
          </div>
        </article>)}
      </div>
    </section>}
    {mode==='page'&&view==='kanban'&&!totalMatches&&search&&<div className="sgq-kanban-no-results">Nenhum resultado para “{effectiveQuery}”.</div>}
  </section>
}
