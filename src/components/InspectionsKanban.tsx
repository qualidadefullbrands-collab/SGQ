import {useMemo,useState} from 'react'
import {ArrowRightLeft,CheckCircle2,ChevronRight,ClipboardCheck,Copy,Edit3,MoreHorizontal,Play,Plus,Search,Trash2} from 'lucide-react'
import './InspectionsKanban.css'

type Process={
  id:string
  codigo:string
  cliente:string|null
  nota_fiscal?:string|null
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
    processo_id:string
    processos?:{codigo:string;cliente:string|null;nota_fiscal?:string|null}|null
  }|null
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
  onViewAll?:()=>void
  onOpen:(id:string)=>void
  onCreate:()=>void
  onReuseProcess:(id:string)=>void
  onEditProcess:(id:string)=>void
  onDeleteProcess:(id:string)=>void
  onDeleteInspection:(id:string)=>void
  formatFst:(value:string|null|undefined)=>string
}
const columns=[
  {status:'aberta',label:'Não iniciadas',tone:'queued'},
  {status:'em_andamento',label:'Em andamento',tone:'active'},
  {status:'concluida',label:'Concluídas',tone:'done'}
] as const

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
  return <details className="sgq-kanban-actions">
    <summary title="Ações" aria-label={'Ações da inspeção '+inspection.numero}><MoreHorizontal size={18}/></summary>
    <div className="sgq-kanban-actions-menu">
      {process&&<button type="button" onClick={()=>onReuseProcess(process.id)}><Copy size={15}/> Nova neste processo</button>}
      {process&&<button type="button" onClick={()=>onEditProcess(process.id)}><Edit3 size={15}/> Editar processo</button>}
      {canDelete&&<button type="button" className="danger-item" onClick={()=>onDeleteInspection(inspection.id)}><Trash2 size={15}/> Excluir inspeção</button>}
      {canDelete&&process&&<button type="button" className="danger-item" disabled={deletingProcessId!==null} onClick={()=>onDeleteProcess(process.id)}><Trash2 size={15}/> {deletingProcessId===process.id?'Excluindo…':'Excluir processo'}</button>}
    </div>
  </details>
}

export default function InspectionsKanban({
  inspections,processes,canDelete,deletingProcessId,canMove=false,movingInspectionId=null,onMove,
  mode='page',onViewAll,onOpen,onCreate,onReuseProcess,onEditProcess,
  onDeleteProcess,onDeleteInspection,formatFst
}:Props){
  const [query,setQuery]=useState('')
  const [shownByLane,setShownByLane]=useState<Record<string,number>>({})
  const [draggingId,setDraggingId]=useState<string|null>(null)
  const [overLane,setOverLane]=useState<string|null>(null)
  const pageSize=mode==='panel'?8:24
  const search=normalized(query)
  const processById=useMemo(()=>new Map(processes.map(p=>[p.id,p])),[processes])
  const visible=useMemo(()=>{
    // Cancelled/archived records do not occupy an operational Kanban lane.
    const sorted=inspections.filter(i=>i.status!=='cancelada').sort((a,b)=>
      String(b.criado_em||'').localeCompare(String(a.criado_em||'')))
    if(!search)return sorted
    return sorted.filter(item=>{
      const process=processById.get(item.grupos_inspecao?.processo_id??'')
      const p=item.grupos_inspecao?.processos
      return normalized([
        item.numero,item.grupos_inspecao?.nome,process?.codigo,p?.codigo,
        process?.cliente,p?.cliente,process?.nota_fiscal,p?.nota_fiscal
      ].join(' ')).includes(search)
    })
  },[inspections,processById,search])
  const columnsToShow=useMemo(()=>{
    const base=columns.map(c=>({...c,items:visible.filter(i=>i.status===c.status)}))
    const others=visible.filter(i=>!columns.some(c=>c.status===i.status))
    return others.length?[...base,{status:'other',label:'Outras',tone:'other',items:others}]:base
  },[visible])
  const activeProcessIds=useMemo(()=>new Set(inspections.map(i=>i.grupos_inspecao?.processo_id).filter(Boolean)),[inspections])
  const emptyProcesses=processes.filter(p=>!activeProcessIds.has(p.id)&&
    (!search||normalized([p.codigo,p.cliente,p.nota_fiscal].join(' ')).includes(search)))
  const totalMatches=visible.length+emptyProcesses.length
  const canMoveCard=(item:Inspection)=>Boolean(canMove&&onMove&&!movingInspectionId&&
    (item.status==='aberta'||item.status==='em_andamento'))
  const moveCard=(id:string,target:'aberta'|'em_andamento')=>{
    const item=inspections.find(i=>i.id===id)
    if(!item||!canMoveCard(item)||item.status===target)return
    onMove?.(id,target)
  }
  return <section className={'workspace sgq-kanban-page '+(mode==='panel'?'sgq-kanban-embedded':'')} aria-label="Inspeções">
    <header className="sgq-kanban-toolbar">
      <div className="sgq-kanban-title">{mode==='panel'?<h2>Inspeções</h2>:<h1>Inspeções</h1>}
        <span className="sgq-kanban-total">{inspections.filter(i=>i.status!=='cancelada').length}</span></div>
      {mode==='panel'?<button type="button" className="secondary small" onClick={onViewAll}>Ver todas</button>:
      <div className="sgq-kanban-tools">
        <label className="sgq-kanban-search">
          <Search size={17} aria-hidden="true"/>
          <input type="search" value={query} onChange={e=>{setQuery(e.target.value);setShownByLane({})}}
            placeholder="Buscar FST ou cliente" aria-label="Buscar inspeções"/>
        </label>
        <button type="button" className="primary sgq-kanban-new" onClick={onCreate}><Plus size={17}/> Nova inspeção</button>
      </div>}
    </header>

    <div className="sgq-kanban-board" aria-label="Quadro Kanban de inspeções">
      {columnsToShow.map(column=><section className={'sgq-kanban-lane tone-'+column.tone}
        key={column.status} aria-label={column.label}
        data-drop-active={overLane===column.status}
        onDragOver={e=>{
          if(!draggingId||!canMove||movingInspectionId||
            !['aberta','em_andamento'].includes(column.status))return
          const item=inspections.find(i=>i.id===draggingId)
          if(!item||item.status===column.status||!canMoveCard(item))return
          e.preventDefault()
          e.dataTransfer.dropEffect='move'
          if(overLane!==column.status)setOverLane(column.status)
        }}
        onDrop={e=>{
          const id=e.dataTransfer.getData('text/plain')||draggingId
          setDraggingId(null);setOverLane(null)
          if(id&&['aberta','em_andamento'].includes(column.status)){
            e.preventDefault()
            moveCard(id,column.status as 'aberta'|'em_andamento')
          }
        }}>
        <div className="sgq-kanban-lane-head">
          <span className="sgq-kanban-lane-dot" aria-hidden="true"/>
          <h2>{column.label}</h2>
          <span className="sgq-kanban-lane-count">{column.items.length}</span>
        </div>
        <div className="sgq-kanban-lane-content">
          {column.items.slice(0,shownByLane[column.status]??pageSize).map(item=>{
            const group=item.grupos_inspecao
            const process=processById.get(group?.processo_id??'')
            const linked=group?.processos
            const fst=formatFst(process?.codigo??linked?.codigo)
            const client=process?.cliente??linked?.cliente
            const target=Number(item.tamanho_amostra)||0
            const inspected=Number(item.total_inspecionado)||0
            const percent=target>0?Math.min(100,Math.max(0,(inspected/target)*100)):0
            const done=item.status==='concluida'
            const active=item.status==='em_andamento'
            const result=item.resultado==='aprovado'?'Aprovado':item.resultado==='reprovado'?'Reprovado':null
            return <article className="sgq-kanban-card" key={item.id}
              draggable={canMoveCard(item)}
              data-dragging={draggingId===item.id}
              onDragStart={e=>{
                if(!canMoveCard(item)){e.preventDefault();return}
                e.dataTransfer.setData('text/plain',item.id)
                e.dataTransfer.effectAllowed='move'
                setDraggingId(item.id)
              }}
              onDragEnd={()=>{setDraggingId(null);setOverLane(null)}}>
              <div className="sgq-kanban-card-top">
                <span className="sgq-kanban-fst">{fst}</span>
                <InspectionMenu inspection={item} process={process} canDelete={canDelete} deletingProcessId={deletingProcessId}
                  onReuseProcess={onReuseProcess} onEditProcess={onEditProcess}
                  onDeleteProcess={onDeleteProcess} onDeleteInspection={onDeleteInspection}/>
              </div>
              <h3 title={client||'Cliente não informado'}>{client||'Cliente não informado'}</h3>
              {group?.nome&&<p className="sgq-kanban-group" title={group.nome}>{group.nome}</p>}
              {(active||done)&&target>0&&<div className="sgq-kanban-progress">
                <div className="sgq-kanban-progress-label"><span>Amostra</span><strong>{formatQuantity(inspected)} / {formatQuantity(target)}</strong></div>
                <div className="sgq-kanban-progress-track" role="progressbar"
                  aria-label={'Amostragem '+fst} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{width:percent+'%'}}/>
                </div>
              </div>}
              <div className="sgq-kanban-card-bottom">
                {result?<span className={'sgq-kanban-result '+(item.resultado==='aprovado'?'is-approved':'is-rejected')}>
                  {result}
                </span>:<span className="sgq-kanban-card-spacer"/>}
                {canMove&&onMove&&(active||item.status==='aberta')&&
                  <button className="sgq-kanban-move" type="button"
                    disabled={!!movingInspectionId}
                    title={active?'Voltar para Não iniciadas':'Mover para Em andamento'}
                    aria-label={(active?'Voltar para Não iniciadas':'Mover para Em andamento')+' · '+fst}
                    onClick={()=>moveCard(item.id,active?'aberta':'em_andamento')}>
                    <ArrowRightLeft size={15}/>
                  </button>}
                <button className="sgq-kanban-open" type="button" onClick={()=>onOpen(item.id)}>
                  {active?<Play size={14}/>:done?<CheckCircle2 size={15}/>:<ChevronRight size={16}/>}
                  {active?'Continuar':'Abrir'}
                </button>
              </div>
            </article>
          })}
          {column.items.length>(shownByLane[column.status]??pageSize)&&
            <button type="button" className="sgq-kanban-loadmore"
              onClick={()=>setShownByLane(current=>({...current,[column.status]:(current[column.status]??pageSize)+pageSize}))}>
              Ver mais
            </button>}
          {!column.items.length&&<div className="sgq-kanban-empty">Nenhuma inspeção</div>}
        </div>
      </section>)}
    </div>
    {mode==='page'&&emptyProcesses.length>0&&<section className="sgq-kanban-unassigned" aria-label="Processos sem inspeção">
      <div className="sgq-kanban-unassigned-head"><ClipboardCheck size={17}/><h2>Processos sem inspeção</h2><span>{emptyProcesses.length}</span></div>
      <div className="sgq-kanban-unassigned-list">
        {emptyProcesses.map(process=><article className="sgq-kanban-unassigned-card" key={process.id}>
          <div><strong>{formatFst(process.codigo)}</strong><span>{process.cliente||'Cliente não informado'}</span></div>
          <div className="sgq-kanban-unassigned-actions">
            <button type="button" onClick={()=>onReuseProcess(process.id)} title="Nova inspeção neste processo" aria-label={'Nova inspeção em '+formatFst(process.codigo)}><Plus size={16}/></button>
            <button type="button" onClick={()=>onEditProcess(process.id)} title="Editar processo" aria-label={'Editar '+formatFst(process.codigo)}><Edit3 size={16}/></button>
            {canDelete&&<button type="button" onClick={()=>onDeleteProcess(process.id)} className="danger-item" disabled={deletingProcessId!==null} title="Excluir processo" aria-label={'Excluir '+formatFst(process.codigo)}><Trash2 size={15}/></button>}
          </div>
        </article>)}
      </div>
    </section>}
    {!totalMatches&&search&&<div className="sgq-kanban-no-results">Nenhum resultado para “{query}”.</div>}
  </section>
}
