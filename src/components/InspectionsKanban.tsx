import {useMemo,useState} from 'react'
import {ArrowRightLeft,CheckCircle2,ChevronRight,ClipboardCheck,Copy,Edit3,MoreHorizontal,Play,Plus,Search,Trash2} from 'lucide-react'
import './InspectionsKanban.css'

type Process={
  id:string
  codigo:string
  cliente:string|null
  nota_fiscal?:string|null
  status?:string
  it_versao_id?:string|null
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
    id?:string
    subprocesso_codigo?:string|null
    nota_fiscal?:string|null
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
  focusProcessId?:string|null
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
  mode='page',focusProcessId=null,onViewAll,onOpen,onCreate,onReuseProcess,onEditProcess,
  onDeleteProcess,onDeleteInspection,formatFst
}:Props){
  const [query,setQuery]=useState('')
  const [view,setView]=useState<'processos'|'kanban'>('processos')
  const [expandedProcessId,setExpandedProcessId]=useState<string|null>(null)
  const [shownByLane,setShownByLane]=useState<Record<string,number>>({})
  const [draggingId,setDraggingId]=useState<string|null>(null)
  const [overLane,setOverLane]=useState<string|null>(null)
  const pageSize=mode==='panel'?8:24
  const search=normalized(query)
  const processTree=useMemo(()=>{
    const active=inspections.filter(item=>item.status!=='cancelada')
    return processes.map(process=>{
      const own=active.filter(item=>item.grupos_inspecao?.processo_id===process.id)
      const groups=new Map<string,{
        key:string,letter:string,invoice:string|null,name:string,items:Inspection[]
      }>()
      for(const item of own){
        const group=item.grupos_inspecao
        const letter=String(group?.subprocesso_codigo??'').trim().toUpperCase()
        const key=group?.id||letter||item.id
        const prior=groups.get(key)
        if(prior)prior.items.push(item)
        else groups.set(key,{key,letter,invoice:group?.nota_fiscal??null,
          name:group?.nome??'Inspeção',items:[item]})
      }
      const subprocesses=[...groups.values()].sort((a,b)=>
        a.letter.localeCompare(b.letter,'pt-BR')||a.name.localeCompare(b.name,'pt-BR'))
      const searchable=normalized([
        process.codigo,formatFst(process.codigo),process.cliente,
        ...subprocesses.flatMap(sub=>[
          sub.letter,sub.letter?formatFst(process.codigo)+'-'+sub.letter:'',
          sub.invoice,sub.name,...sub.items.map(item=>item.numero)
        ])
      ].join(' '))
      return {process,subprocesses,searchable,inspectionCount:own.length,
        allCompleted:own.length>0&&own.every(item=>item.status==='concluida'),
        anyStarted:own.some(item=>item.status==='em_andamento'),
      }
    }).filter(entry=>!search||entry.searchable.includes(search))
      .sort((a,b)=>Number(b.process.id===focusProcessId)-Number(a.process.id===focusProcessId))
  },[inspections,processes,search,focusProcessId])
  // Cada FST ocupa uma única coluna, mesmo quando possui subprocessos em fases diferentes.
  // Concluído apenas quando todas as inspeções do processo estiverem concluídas.
  const groupedBoard=useMemo(()=>processTree.map(entry=>{
    const children=entry.subprocesses.flatMap(sub=>sub.items)
    const lane=children.length===0||children.every(item=>item.status==='aberta')
      ?'aberta':children.every(item=>item.status==='concluida')
      ?'concluida':'em_andamento'
    return {...entry,lane}
  }),[processTree])
  const columnsToShow=useMemo(()=>columns.map(c=>({
    ...c,items:groupedBoard.filter(entry=>entry.lane===c.status)
  })),[groupedBoard])
  const totalMatches=groupedBoard.length
  const canMoveCard=(item:Inspection)=>Boolean(canMove&&onMove&&!movingInspectionId&&
    (item.status==='aberta'||item.status==='em_andamento'))
  const moveCard=(id:string,target:'aberta'|'em_andamento')=>{
    const item=inspections.find(i=>i.id===id)
    if(!item||!canMoveCard(item)||item.status===target)return
    onMove?.(id,target)
  }
  return <section className={'workspace sgq-kanban-page '+(mode==='panel'?'sgq-kanban-embedded':'')} aria-label="Inspeções">
    <header className="sgq-kanban-toolbar">
      <div className="sgq-kanban-title">{mode==='panel'?<h2>Inspeções</h2>:<h1>Processos</h1>}
        <span className="sgq-kanban-total">{mode==='panel'?inspections.filter(i=>i.status!=='cancelada').length:processes.length}</span></div>
      {mode==='panel'?<button type="button" className="secondary small" onClick={onViewAll}>Ver todas</button>:
      <div className="sgq-kanban-tools">
        <div className="sgq-process-view-toggle" role="group" aria-label="Visualizar por processo ou Kanban">
          <button type="button" className={view==='processos'?'is-active':''} aria-pressed={view==='processos'}
            onClick={()=>setView('processos')}>Por processo</button>
          <button type="button" className={view==='kanban'?'is-active':''} aria-pressed={view==='kanban'}
            onClick={()=>setView('kanban')}>Kanban</button>
        </div>
        <label className="sgq-kanban-search">
          <Search size={17} aria-hidden="true"/>
          <input type="search" value={query} onChange={e=>{setQuery(e.target.value);setShownByLane({})}}
            placeholder="Buscar FST, letra, NF ou cliente" aria-label="Buscar processos"/>
        </label>
        <button type="button" className="primary sgq-kanban-new" onClick={onCreate}><Plus size={17}/> Novo FST</button>
      </div>}
    </header>

    {mode==='page'&&view==='processos'&&<section className="sgq-process-tree" aria-label="Processos e subprocessos">
      {processTree.map((entry,index)=>{
        const process=entry.process
        const processLabel=formatFst(process.codigo)
        const expanded=search.length>0||expandedProcessId===process.id||
          (expandedProcessId===null&&process.id===(focusProcessId||processTree[0]?.process.id))
        const progressLabel=entry.allCompleted?'Concluído':entry.anyStarted?'Em andamento':'Não iniciado'
        return <article className="sgq-process-node" key={process.id}>
          <div className="sgq-process-node-heading">
            <button type="button" className="sgq-process-node-toggle" onClick={()=>
              setExpandedProcessId(expanded?'':process.id)} aria-expanded={expanded}
              aria-controls={'sgq-process-children-'+process.id}>
              <ChevronRight size={18} className={expanded?'is-expanded':''}/>
              <span className="sgq-process-node-identity">
                <strong>{processLabel}</strong>
                <span>{process.cliente||'Cliente não informado'}</span>
              </span>
            </button>
            <div className="sgq-process-node-summary">
              <span>{entry.subprocesses.length} subprocesso(s)</span>
              <span className={'sgq-process-status '+(entry.allCompleted?'is-complete':'')}>{progressLabel}</span>
            </div>
            <div className="sgq-process-node-actions">
              <button type="button" onClick={()=>onReuseProcess(process.id)} title={'Adicionar subprocesso a '+processLabel}>
                <Plus size={15}/> Subprocesso
              </button>
              <button type="button" onClick={()=>onEditProcess(process.id)} title={'Editar dados do FST '+processLabel}>
                <Edit3 size={15}/> Editar FST
              </button>
              {canDelete&&<button type="button" className="sgq-process-danger"
                disabled={deletingProcessId!==null} onClick={()=>onDeleteProcess(process.id)}
                title={'Excluir FST '+processLabel}><Trash2 size={15}/></button>}
            </div>
          </div>
          {expanded&&<div className="sgq-process-children" id={'sgq-process-children-'+process.id}>
            {entry.subprocesses.map(sub=>{
              const done=sub.items.length>0&&sub.items.every(i=>i.status==='concluida')
              const started=sub.items.some(i=>i.status==='em_andamento')
              return <section className="sgq-subprocess-node" key={sub.key}>
                <div className="sgq-subprocess-node-heading">
                  <span className="sgq-subprocess-letter">{sub.letter||'—'}</span>
                  <div className="sgq-subprocess-node-name">
                    <strong>{sub.letter?'Subprocesso '+sub.letter:'Inspeção vinculada'}</strong>
                    <span>{sub.name}</span>
                  </div>
                  <span className="sgq-subprocess-invoice">{sub.invoice?'NF '+sub.invoice:'NF não informada'}</span>
                  <span className={'sgq-process-status '+(done?'is-complete':'')}>
                    {done?'Concluído':started?'Em andamento':'Não iniciado'}
                  </span>
                </div>
                {sub.items.map(item=><div className="sgq-subprocess-inspection" key={item.id}>
                  <span className="sgq-subprocess-inspection-number">{item.numero}</span>
                  <span>{item.status==='concluida'?
                    (item.resultado==='aprovado'?'Aprovado':item.resultado==='reprovado'?'Reprovado':'Concluído'):
                    item.status==='em_andamento'?'Inspeção em andamento':'Inspeção aberta'}</span>
                  <button type="button" onClick={()=>onOpen(item.id)}>
                    {item.status==='concluida'?<CheckCircle2 size={15}/>:<ChevronRight size={15}/>}
                    Abrir inspeção
                  </button>
                </div>)}
              </section>
            })}
            {!entry.subprocesses.length&&<div className="sgq-process-empty">
              Nenhum subprocesso cadastrado.
              <button type="button" onClick={()=>onReuseProcess(process.id)}><Plus size={15}/> Adicionar subprocesso A</button>
            </div>}
            {entry.allCompleted&&<div className="sgq-process-report-note">
              <ClipboardCheck size={15}/> Laudo único disponível ao abrir uma inspeção concluída.
            </div>}
          </div>}
        </article>
      })}
      {!processTree.length&&<div className="sgq-kanban-no-results">
        {search?'Nenhum processo encontrado para “'+query+'”.':'Nenhum processo ativo cadastrado.'}
      </div>}
    </section>}
    {(mode==='panel'||view==='kanban')&&<div className="sgq-kanban-board" aria-label="Quadro Kanban de inspeções">
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
          {column.items.slice(0,shownByLane[column.status]??pageSize).map(entry=>{
            const process=entry.process
            const fst=formatFst(process.codigo)
            return <article className="sgq-kanban-card sgq-kanban-process-card" key={process.id}>
              <div className="sgq-kanban-card-top">
                <span className="sgq-kanban-fst">{fst}</span>
                <div className="sgq-kanban-process-actions">
                  <button type="button" title={'Novo subprocesso em '+fst} onClick={()=>onReuseProcess(process.id)}><Plus size={15}/></button>
                  <button type="button" title={'Editar '+fst} onClick={()=>onEditProcess(process.id)}><Edit3 size={15}/></button>
                  {canDelete&&<button type="button" title={'Excluir '+fst} disabled={deletingProcessId!==null} onClick={()=>onDeleteProcess(process.id)}><Trash2 size={15}/></button>}
                </div>
              </div>
              <h3 title={process.cliente||'Cliente não informado'}>{process.cliente||'Cliente não informado'}</h3>
              <p className="sgq-kanban-group">{entry.subprocesses.length} subprocesso(s) · {entry.inspectionCount} inspeção(ões)</p>
              <div className="sgq-kanban-subprocess-list">
                {entry.subprocesses.map(sub=><section className="sgq-kanban-subprocess" key={sub.key}>
                  <div className="sgq-kanban-subprocess-heading">
                    <strong>{sub.letter?'Subprocesso '+sub.letter:'Inspeção vinculada'}</strong>
                    <span>{sub.invoice?'NF '+sub.invoice:'NF não informada'}</span>
                  </div>
                  {sub.items.map(item=>{
                    const target=Number(item.tamanho_amostra)||0
                    const inspected=Number(item.total_inspecionado)||0
                    const percent=target>0?Math.min(100,Math.max(0,inspected/target*100)):0
                    const active=item.status==='em_andamento'
                    const done=item.status==='concluida'
                    return <div className="sgq-kanban-subprocess-item" key={item.id}
                      draggable={canMoveCard(item)}
                      onDragStart={e=>{
                        if(!canMoveCard(item)){e.preventDefault();return}
                        e.dataTransfer.setData('text/plain',item.id)
                        e.dataTransfer.effectAllowed='move'
                        setDraggingId(item.id)
                      }}
                      onDragEnd={()=>{setDraggingId(null);setOverLane(null)}}>
                      <div className="sgq-kanban-subprocess-identity">
                        <span>{item.numero}</span>
                        <span className={'sgq-process-status '+(done?'is-complete':'')}>{done?'Concluída':active?'Em andamento':'Não iniciada'}</span>
                      </div>
                      {target>0&&<div className="sgq-kanban-progress">
                        <div className="sgq-kanban-progress-label"><span>Amostra</span><strong>{formatQuantity(inspected)} / {formatQuantity(target)}</strong></div>
                        <div className="sgq-kanban-progress-track" role="progressbar" aria-label={'Amostragem '+fst+'-'+sub.letter}
                          aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                          <span style={{width:percent+'%'}}/>
                        </div>
                      </div>}
                      <div className="sgq-kanban-subprocess-buttons">
                        {canMove&&onMove&&canMoveCard(item)&&<button type="button" className="sgq-kanban-move"
                          disabled={!!movingInspectionId} onClick={()=>moveCard(item.id,active?'aberta':'em_andamento')}
                          aria-label={(active?'Voltar para Não iniciadas':'Mover para Em andamento')+' · '+fst+'-'+sub.letter}>
                          <ArrowRightLeft size={15}/>
                        </button>}
                        <InspectionMenu inspection={item} process={process} canDelete={canDelete}
                          deletingProcessId={deletingProcessId} onReuseProcess={onReuseProcess}
                          onEditProcess={onEditProcess} onDeleteProcess={onDeleteProcess}
                          onDeleteInspection={onDeleteInspection}/>
                        <button type="button" className="sgq-kanban-open" onClick={()=>onOpen(item.id)}>
                          {done?<CheckCircle2 size={15}/>:active?<Play size={14}/>:<ChevronRight size={15}/>}
                          Abrir
                        </button>
                      </div>
                    </div>
                  })}
                </section>)}
                {!entry.subprocesses.length&&<div className="sgq-process-empty">
                  Nenhum subprocesso cadastrado.
                  <button type="button" onClick={()=>onReuseProcess(process.id)}>Adicionar subprocesso A</button>
                </div>}
              </div>
            </article>
          })}
          {column.items.length>(shownByLane[column.status]??pageSize)&&
            <button type="button" className="sgq-kanban-loadmore"
              onClick={()=>setShownByLane(current=>({...current,[column.status]:(current[column.status]??pageSize)+pageSize}))}>
              Ver mais
            </button>}
          {!column.items.length&&<div className="sgq-kanban-empty">Nenhum processo</div>}
        </div>
      </section>)}
    </div>}
    {mode==='page'&&view==='kanban'&&!totalMatches&&search&&<div className="sgq-kanban-no-results">Nenhum resultado para “{query}”.</div>}
  </section>
}
