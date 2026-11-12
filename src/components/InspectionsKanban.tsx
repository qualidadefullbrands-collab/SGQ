import {useMemo,useState} from 'react'
import {ArrowRightLeft,CheckCircle2,ChevronRight,ClipboardCheck,Copy,Edit3,MoreHorizontal,Play,Plus,Trash2} from 'lucide-react'
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
    processo_id:string
    id?:string
    subprocesso_codigo?:string|null
    nota_fiscal?:string|null
    chegada_cd?:string|null
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
  initialView?:'processos'|'kanban'
  externalQuery?:string
  focusProcessId?:string|null
  onViewAll?:()=>void
  onOpen:(id:string)=>void
  onCreate:()=>void
  onReuseProcess:(id:string)=>void
  onEditProcess:(id:string)=>void
  onDeleteProcess:(id:string)=>void
  onDeleteInspection:(id:string)=>void
  formatFst:(value:string|null|undefined)=>string
  itemLinks?:Array<{grupo_inspecao_id:string;processo_itens?:{id?:string;codigo_cliente?:string|null;produtos?:{sku?:string|null;nome?:string|null}|null}|null}>
}
const columns=[
  {status:'aberta',label:'Não iniciadas',tone:'queued'},
  {status:'em_andamento',label:'Em andamento',tone:'active'},
  {status:'concluida',label:'Concluídas',tone:'done'}
] as const

function groupByFst(items:Inspection[]){
  const groups=new Map<string,Inspection[]>()
  for(const item of items){
    const key=item.grupos_inspecao?.processo_id||item.id
    const current=groups.get(key)
    if(current)current.push(item)
    else groups.set(key,[item])
  }
  return Array.from(groups.entries()).map(([key,children])=>({key,children}))
}
function formatArrival(value:string|null|undefined){
  if(!value)return 'não registrada'
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
  return <details className="sgq-kanban-actions">
    <summary title="Ações" aria-label={'Ações da inspeção '+(process?((String(process.codigo).toUpperCase().startsWith('FST')?'':'FST')+process.codigo+(inspection.grupos_inspecao?.subprocesso_codigo?'-'+inspection.grupos_inspecao.subprocesso_codigo:'')):'selecionada')}><MoreHorizontal size={18}/></summary>
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
  mode='page',initialView='processos',externalQuery,focusProcessId=null,onViewAll,onOpen,onCreate,onReuseProcess,onEditProcess,
  onDeleteProcess,onDeleteInspection,formatFst,itemLinks=[]
}:Props){
  const [query]=useState('')
  const [view,setView]=useState<'processos'|'kanban'>(initialView)
  const [expandedProcessId,setExpandedProcessId]=useState<string|null>(null)
  const [shownByLane,setShownByLane]=useState<Record<string,number>>({})
  const [draggingId,setDraggingId]=useState<string|null>(null)
  const [overLane,setOverLane]=useState<string|null>(null)
  const pageSize=mode==='panel'?8:24
  const search=normalized(externalQuery ?? (mode==='page'?'':query))
  const processById=useMemo(()=>new Map(processes.map(p=>[p.id,p])),[processes])
  const linkedItemsByGroup=useMemo(()=>{
    const items=new Map<string,Array<{sku:string;descricao:string}>>()
    for(const link of itemLinks){
      const sku=String(link.processo_itens?.produtos?.sku||link.processo_itens?.codigo_cliente||'').trim()
      const descricao=String(link.processo_itens?.produtos?.nome||'').trim()
      if(!sku&&!descricao)continue
      const current=items.get(link.grupo_inspecao_id)||[]
      if(!current.some(x=>x.sku===sku&&x.descricao===descricao))current.push({sku,descricao})
      items.set(link.grupo_inspecao_id,current)
    }
    return items
  },[itemLinks])
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
        item.grupos_inspecao?.subprocesso_codigo,
        item.grupos_inspecao?.nota_fiscal,
        (process?.codigo??p?.codigo??'')+(item.grupos_inspecao?.subprocesso_codigo?'-'+item.grupos_inspecao?.subprocesso_codigo:''),
        process?.cliente,p?.cliente,process?.nota_fiscal,p?.nota_fiscal
      ].join(' ')).includes(search)
    })
  },[inspections,processById,search])
  const columnsToShow=useMemo(()=>{
    const base=columns.map(c=>({...c,items:visible.filter(i=>i.status===c.status)}))
    const others=visible.filter(i=>!columns.some(c=>c.status===i.status))
    return others.length?[...base,{status:'other',label:'Outras',tone:'other',items:others}]:base
  },[visible])
  const processTree=useMemo(()=>{
    const active=inspections.filter(item=>item.status!=='cancelada')
    return processes.map(process=>{
      const own=active.filter(item=>item.grupos_inspecao?.processo_id===process.id)
      const groups=new Map<string,{
        key:string,letter:string,invoice:string|null,arrival:string|null,name:string,items:Inspection[]
      }>()
      for(const item of own){
        const group=item.grupos_inspecao
        const letter=String(group?.subprocesso_codigo??'').trim().toUpperCase()
        const key=group?.id||letter||item.id
        const prior=groups.get(key)
        if(prior)prior.items.push(item)
        else groups.set(key,{key,letter,invoice:group?.nota_fiscal??null,
          arrival:group?.chegada_cd??null,name:group?.nome??'Inspeção',items:[item]})
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
        <button type="button" className="primary sgq-kanban-new" onClick={onCreate}><Plus size={17}/> Novo Processo</button>
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
                <span className="sgq-process-identity-head">
                  <strong>{processLabel}</strong>
                  {(()=>{const arrivals=entry.subprocesses.filter(x=>x.arrival).map(x=>x.letter+': '+formatArrival(x.arrival));const arrival=process.chegada_cd?formatArrival(process.chegada_cd):[...new Set(arrivals)].join(' · ');return <small className="sgq-process-arrival">Chegada ao CD: {arrival||'não registrada'}</small>})()}
                </span>
                <span>{process.cliente||'Cliente não informado'}</span>
              </span>
            </button>
            <div className="sgq-process-node-summary">
              <span>{entry.subprocesses.length} entrada(s)</span>
              <span className={'sgq-process-status '+(entry.allCompleted?'is-complete':'')}>{progressLabel}</span>
            </div>
            <div className="sgq-process-node-actions">
              <button type="button" onClick={()=>onReuseProcess(process.id)} title={'Adicionar nova entrada a '+processLabel}>
                <Plus size={15}/> Nova Entrada
              </button>
              <button type="button" onClick={()=>onEditProcess(process.id)} title={'Editar dados do FST '+processLabel}>
                <Edit3 size={15}/> Editar Processo
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
                    <strong>{processLabel}{sub.letter?'-'+sub.letter:''}</strong>
                    <div className="sgq-subprocess-products">
                      {(linkedItemsByGroup.get(sub.key)||[]).length
                        ?(linkedItemsByGroup.get(sub.key)||[]).map((product,i)=><span key={product.sku+'-'+i} className="sgq-subprocess-product"><b>{product.sku||'SKU não informado'}</b><span>{product.descricao||'Descrição não informada'}</span></span>)
                        :<span>Produtos ainda não vinculados à entrada.</span>}
                    </div>
                  </div>
                  <span className="sgq-subprocess-invoice">{sub.invoice?'NF '+sub.invoice:'NF não informada'}</span>
                  <span className={'sgq-process-status '+(done?'is-complete':'')}>
                    {done?'Concluído':started?'Em andamento':'Não iniciado'}
                  </span>
                </div>
                {sub.items.map(item=><div className="sgq-subprocess-inspection" key={item.id}>
                  <span className="sgq-subprocess-inspection-number">{processLabel}{sub.letter?'-'+sub.letter:''}</span>
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
              <button type="button" onClick={()=>onReuseProcess(process.id)}><Plus size={15}/> Adicionar {formatFst(process.codigo)}-A</button>
            </div>}
          </div>}
        </article>
      })}
      {!processTree.length&&<div className="sgq-kanban-no-results">
        {search?'Nenhum processo encontrado para “'+query+'”.':'Nenhum processo ativo cadastrado.'}
      </div>}
    </section>}
    {(mode==='panel'||view==='kanban')&&<div className="sgq-kanban-board" aria-label="Quadro Kanban de inspeções">
      {columnsToShow.map(column=><section id={'sgq-kanban-lane-'+column.status} className={'sgq-kanban-lane tone-'+column.tone}
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
          {(mode==='panel'
            ?column.items.slice(0,shownByLane[column.status]??pageSize).map(item=>({key:item.id,children:[item]}))
            :groupByFst(column.items.slice(0,shownByLane[column.status]??pageSize))
          ).map(({key,children})=><section
            className={'sgq-kanban-process-group '+(mode==='panel'?'sgq-panel-individual':'')} key={key} aria-label={'Processo '+formatFst(processById.get(key)?.codigo??children[0]?.grupos_inspecao?.processos?.codigo)}>
            {mode!=='panel'&&<div className="sgq-kanban-process-group-title">
              <strong>{formatFst(processById.get(key)?.codigo??children[0]?.grupos_inspecao?.processos?.codigo)}</strong>
              <span>{children.length} inspeção(ões) independentes</span>
            </div>}
            {children.map(item=>{
            const group=item.grupos_inspecao
            const process=processById.get(group?.processo_id??'')
            const linked=group?.processos
            const fst=formatFst(process?.codigo??linked?.codigo)+(group?.subprocesso_codigo?'-'+group.subprocesso_codigo:'')
            const client=process?.cliente??linked?.cliente
            const target=Number(item.tamanho_amostra)||0
            const inspected=Number(item.total_inspecionado)||0
            const percent=target>0?Math.min(100,Math.max(0,(inspected/target)*100)):0
            const done=item.status==='concluida'
            const active=item.status==='em_andamento'
            const result=item.resultado==='aprovado'?'Aprovado':item.resultado==='reprovado'?'Reprovado':null
            return <article className="sgq-kanban-card sgq-kanban-independent-inspection" key={item.id}
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
                {mode==='panel'?<span className="sgq-card-status-tag">
                  {done?<CheckCircle2 size={12}/>:active?<Play size={12}/>:null}
                  {done?'Concluída':active?'Em andamento':'Não iniciada'}
                </span>:<InspectionMenu inspection={item} process={process} canDelete={canDelete} deletingProcessId={deletingProcessId}
                  onReuseProcess={onReuseProcess} onEditProcess={onEditProcess}
                  onDeleteProcess={onDeleteProcess} onDeleteInspection={onDeleteInspection}/>}
              </div>
              <h3 title={client||'Cliente não informado'}>{client||'Cliente não informado'}</h3>
              {group?.nome&&<p className="sgq-kanban-group" title={group.nome}>{group.nome}</p>}
              {group?.subprocesso_codigo&&<p className="sgq-kanban-group">{group.nota_fiscal?'NF '+group.nota_fiscal:'NF não informada'}</p>}
              {(active||done)&&target>0&&<div className="sgq-kanban-progress">
                <div className="sgq-kanban-progress-label"><span>Amostra</span><strong>{formatQuantity(inspected)} / {formatQuantity(target)}</strong></div>
                <div className="sgq-kanban-progress-track" role="progressbar"
                  aria-label={'Amostragem '+fst} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{width:percent+'%'}}/>
                </div>
              </div>}
              <div className="sgq-kanban-card-bottom">
                {mode==='panel' && <InspectionMenu inspection={item} process={process} canDelete={canDelete} deletingProcessId={deletingProcessId}
                  onReuseProcess={onReuseProcess} onEditProcess={onEditProcess}
                  onDeleteProcess={onDeleteProcess} onDeleteInspection={onDeleteInspection}/>}
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
          </section>)}
          {column.items.length>(shownByLane[column.status]??pageSize)&&
            <button type="button" className="sgq-kanban-loadmore"
              onClick={()=>setShownByLane(current=>({...current,[column.status]:(current[column.status]??pageSize)+pageSize}))}>
              Ver mais
            </button>}
          {!column.items.length&&<div className="sgq-kanban-empty">Nenhuma inspeção</div>}
        </div>
      </section>)}
    </div>}
    {mode==='page'&&view==='kanban'&&emptyProcesses.length>0&&<section className="sgq-kanban-unassigned" aria-label="Processos sem inspeção">
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
    {mode==='page'&&view==='kanban'&&!totalMatches&&search&&<div className="sgq-kanban-no-results">Nenhum resultado para “{query}”.</div>}
  </section>
}
