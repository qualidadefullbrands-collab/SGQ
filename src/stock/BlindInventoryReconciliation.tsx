import {useEffect,useMemo,useState} from 'react'
import {ArrowRight,CheckCircle2,ClipboardCheck,FileSearch,RefreshCw,ShieldAlert} from 'lucide-react'
import {authClient} from '../lib/supabase'
import {blindInventoryError as explain} from './blindInventoryErrors'
import InventoryOmieComparison from './InventoryOmieComparison'
import {invalidQuantityReferenceSource,isApprovedLocalSource,localQuantityReference,LOCAL_QUANTITY_SOURCES,quantitySourceLabel} from './StockQuantityPolicy'
import './BlindInventoryReconciliation.css'

type Session={
 id:string;codigo:string;status:string;endereco:string;processo_codigo:string|null;
 cliente_nome:string|null;nf_entrada:string|null;criado_em:string;fechado_em:string|null
}
type Count={
 id:string;inventario_id:string;codigo_omie:string;descricao_omie:string;endereco:string;
 quantidade_contada:number;criado_em:string
}
type Review={
 item_id:string;inventario_id:string;quantidade_original:number;
 quantidade_referencia:number|null;referencia_fonte:string|null;referencia_evidencia:string|null;
 quantidade_recontagem:number|null;recontagem_justificativa:string|null;status:string;
 justificativa_analise:string|null;revisado_por:string|null;revisado_em:string|null
}
type Header={inventario_id:string;status:string;concluido_em:string|null}
type Photo={item_id:string;storage_path:string;status:string}
type Event={id:number;item_id:string|null;acao:string;registrado_por:string;criado_em:string;dados:unknown}
type Draft={reference:string;source:string;evidence:string;recount:string;recountNote:string;reviewNote:string}
const blank=():Draft=>({reference:'',source:'',evidence:'',recount:'',recountNote:'',reviewNote:''})
const num=(value:number)=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:3})

const when=(value:string)=>new Date(value).toLocaleString('pt-BR')
const reviewed=(status:string)=>status==='conciliado'||status==='divergencia_aprovada'
const statusName:Record<string,string>={
 pendente:'Aguardando análise',recontagem_solicitada:'Recontagem solicitada',
 recontada:'Recontagem registrada',conciliado:'Sem divergência',
 divergencia_aprovada:'Divergência aprovada'
}
const operationName:Record<string,string>={
 encerrar:'Contagem encerrada',referencia:'Referência registrada',
 solicitar_recontagem:'Recontagem solicitada',recontar:'Recontagem informada',
 revisar:'Análise aprovada',finalizar:'Conciliação concluída'
}

export default function BlindInventoryReconciliation({canWrite,canApprove}:{
 canWrite:boolean;canApprove:boolean
}){
 const [sessions,setSessions]=useState<Session[]>([])
 const [selectedId,setSelectedId]=useState('')
 const [items,setItems]=useState<Count[]>([])
 const [revisions,setRevisions]=useState<Review[]>([])
 const [header,setHeader]=useState<Header|null>(null)
 const [photos,setPhotos]=useState<Photo[]>([])
 const [events,setEvents]=useState<Event[]>([])
 const [actors,setActors]=useState<Record<string,string>>({})
 const [drafts,setDrafts]=useState<Record<string,Draft>>({})
 const [filter,setFilter]=useState<'todos'|'divergentes'|'pendentes'>('todos')
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const selected=sessions.find(s=>s.id===selectedId)
 const byItem=useMemo(()=>new Map(revisions.map(row=>[row.item_id,row])),[revisions])
 const stats=useMemo(()=>{
  let pending=0,different=0,complete=0,needsCount=0
  for(const item of items){
   const row=byItem.get(item.id)
   const expected=localQuantityReference(row)
   if(expected===null)needsCount++
   const q=row?.quantidade_recontagem??item.quantidade_contada
   if(expected!==null&&Number(q)!==expected)different++
   if(row&&reviewed(row.status)&&expected!==null)complete++
   else pending++
  }
  const invalidSources=revisions.filter(row=>invalidQuantityReferenceSource(row.referencia_fonte)).length
  return {pending,different,complete,needsCount,invalidSources}
 },[items,byItem,revisions])
 const canEdit=!!selected&&selected.status==='fechado'&&header?.status==='em_analise'
 const visible=items.filter(item=>{
  const row=byItem.get(item.id)
  if(filter==='pendentes')return !row||!reviewed(row.status)
  if(filter==='divergentes'){
   const expected=localQuantityReference(row)
   return expected!==null&&Number(row?.quantidade_recontagem??item.quantidade_contada)!==expected
  }
  return true
 })

 async function loadSessions(){
  const {data,error:dbError}=await authClient.from('sgq_inventarios_cegos')
   .select('id,codigo,status,endereco,processo_codigo,cliente_nome,nf_entrada,criado_em,fechado_em')
   .in('status',['aberto','fechado']).not('processo_codigo','is',null)
   .order('criado_em',{ascending:false}).limit(200)
  if(dbError)throw dbError
  const rows=(data||[]) as Session[]
  setSessions(rows)
  return rows
 }
 async function loadDetail(id:string){
  const [counts,analysis,itemsReview,history]=await Promise.all([
   authClient.from('sgq_inventario_cego_itens')
    .select('id,inventario_id,codigo_omie,descricao_omie,endereco,quantidade_contada,criado_em')
    .eq('inventario_id',id).order('codigo_omie').limit(1500),
   authClient.from('sgq_inventario_conciliacoes')
    .select('inventario_id,status,concluido_em').eq('inventario_id',id).maybeSingle(),
   authClient.from('sgq_inventario_conciliacao_itens')
    .select('item_id,inventario_id,quantidade_original,quantidade_referencia,referencia_fonte,referencia_evidencia,quantidade_recontagem,recontagem_justificativa,status,justificativa_analise,revisado_por,revisado_em')
    .eq('inventario_id',id).limit(1500),
   authClient.from('sgq_inventario_conciliacao_eventos')
    .select('id,item_id,acao,registrado_por,criado_em,dados')
    .eq('inventario_id',id).order('criado_em',{ascending:false}).limit(100)
  ])
  const problem=counts.error||analysis.error||itemsReview.error||history.error
  if(problem)throw problem
  const countRows=(counts.data||[]) as Count[]
  const reviewRows=(itemsReview.data||[]) as Review[]
  setItems(countRows)
  setHeader(analysis.data as Header|null)
  setRevisions(reviewRows)
  setEvents((history.data||[]) as Event[])
  const prefill:Record<string,Draft>={}
  for(const row of reviewRows){
   prefill[row.item_id]={reference:row.quantidade_referencia===null?'':String(row.quantidade_referencia),
    source:row.referencia_fonte||'',evidence:row.referencia_evidencia||'',
    recount:'',recountNote:'',reviewNote:row.justificativa_analise||''}
  }
  setDrafts(prefill)
  const ids=countRows.map(row=>row.id)
  if(ids.length){
   const {data,error:photoError}=await authClient.from('sgq_inventario_cego_imagens')
    .select('item_id,storage_path,status').in('item_id',ids).limit(1500)
   if(photoError)throw photoError
   setPhotos((data||[]) as Photo[])
  }else setPhotos([])
  const actorIds=[...new Set((history.data||[]).map(row=>row.registrado_por).filter(Boolean))]
  if(actorIds.length){
   const {data:profiles}=await authClient.from('profiles').select('id,nome').in('id',actorIds)
   setActors(Object.fromEntries((profiles||[]).map(person=>[person.id,person.nome||'Usuário'])))
  }else setActors({})
 }
 useEffect(()=>{void loadSessions().catch(e=>setError(explain(e)))},[])
 async function chooseSession(id:string){
  setSelectedId(id);setError('');setMessage('');setLoading(true)
  try{await loadDetail(id)}catch(e){setError('Falha ao carregar conciliação: '+explain(e))}
  finally{setLoading(false)}
 }
 async function refresh(){
  setError('')
  try{await loadSessions();if(selectedId)await loadDetail(selectedId)}
  catch(e){setError('Não foi possível atualizar: '+explain(e))}
 }
 function patch(id:string,value:Partial<Draft>){
  setDrafts(current=>({...current,[id]:{...(current[id]||blank()),...value}}))
 }
 function parseQty(input:string){
  const value=input.trim().replace(',','.')
  return /^\d+(?:\.\d{1,3})?$/.test(value)?Number(value):null
 }
 async function operate(action:string,itemId?:string,qty?:number|null,source?:string|null,note?:string|null){
  if(!selectedId||busy)return
  if(action==='referencia'&&invalidQuantityReferenceSource(source)){
   setError('Selecione uma fonte física válida do SGQ para a mesma localização, sem quantidades do Omie.');return
  }
  if(action==='revisar'&&revisions.some(row=>row.item_id===itemId&&invalidQuantityReferenceSource(row.referencia_fonte))){
   setError('Atualize a origem da quantidade esperada para um controle físico do SGQ antes de aprovar.');return
  }
  if(action==='finalizar'&&revisions.some(row=>invalidQuantityReferenceSource(row.referencia_fonte))){
   setError('Existem referências de quantidade vinculadas ao Omie. Corrija a origem no SGQ antes de concluir.');return
  }
  if(action==='encerrar'&&!window.confirm('Encerrar a contagem física? A conciliação será iniciada e os itens não poderão mais ser editados.'))return
  if(action==='finalizar'&&!window.confirm('Concluir a conciliação de todos os itens? As decisões ficarão bloqueadas. Nenhum saldo do Omie será alterado.'))return
  setBusy(true);setError('');setMessage('')
  try{
   const {data,error:opError}=await authClient.rpc('sgq_conciliacao_operar',{
    p_acao:action,p_inventario:selectedId,p_item:itemId||null,
    p_quantidade:qty??null,p_fonte:source??null,p_justificativa:note??null
   })
   if(opError)throw opError
   if(!data?.ok)throw new Error('A ação não foi confirmada pelo servidor.')
   await loadSessions();await loadDetail(selectedId)
   setMessage((operationName[action]||'Registro atualizado')+'. Nenhum saldo foi movimentado.')
  }catch(e){setError('Não foi possível registrar: '+explain(e))}
  finally{setBusy(false)}
 }
 async function openPhoto(itemId:string){
  const photo=photos.find(p=>p.item_id===itemId)
  if(!photo){setError('Este item não possui foto registrada.');return}
  const {data,error:signError}=await authClient.storage.from('sgq-inventario-cego')
   .createSignedUrl(photo.storage_path,300)
  if(signError||!data?.signedUrl){setError('Não foi possível abrir a foto: '+explain(signError));return}
  window.open(data.signedUrl,'_blank','noopener,noreferrer')
 }

 return <div className="sgq-recon">
  <header className="sgq-recon-header">
   <div><h2>Conciliação pós-inventário</h2>
    <p>Encerramento da contagem → referência da localização → divergências → aprovação</p></div>
   <button className="secondary small" type="button" disabled={busy||loading} onClick={()=>void refresh()}>
    <RefreshCw size={16}/> Atualizar</button>
  </header>
  <p className="sgq-recon-intro"><ShieldAlert size={16}/>
   A quantidade esperada deve corresponder ao mesmo SKU e à mesma localização da contagem.
   A referência deve vir de controle físico documentado no SGQ, para o mesmo endereço.
   O Omie é consultado somente para código e descrição. A aprovação registra uma decisão auditável, sem ajustar saldos.</p>
  {error&&<div className="sgq-single-alert" role="alert">{error}</div>}
  {message&&<div className="sgq-single-success" role="status"><CheckCircle2 size={16}/>{message}</div>}

  <section className="sgq-recon-panel">
   <h3>Contagens por processo FST</h3>
   <label className="sgq-recon-selector">Inventário
    <select value={selectedId} disabled={busy} onChange={e=>{if(e.target.value)void chooseSession(e.target.value);else{setSelectedId('');setError('');setMessage('')}}}>
     <option value="">Selecione um processo e a localização</option>
     {sessions.map(s=><option key={s.id} value={s.id}>
      {s.processo_codigo} · {s.endereco} · {s.status==='aberto'?'Contagem aberta':'Contagem encerrada'} · {new Date(s.criado_em).toLocaleDateString('pt-BR')}
     </option>)}
    </select>
   </label>
   {!sessions.length&&<p className="sgq-recon-muted">Nenhum inventário FST aberto ou encerrado foi localizado.</p>}
  </section>

  {selected&&<div className="sgq-recon-detail">
   <section className="sgq-recon-panel">
    <div className="sgq-recon-title">
     <div><h3>{selected.processo_codigo} · {selected.endereco}</h3>
      <p>{selected.cliente_nome||'Cliente não informado'} · NF {selected.nf_entrada||'não registrada'} · {selected.codigo}</p></div>
     <span className="sgq-recon-chip">{header?.status==='concluida'?'Conciliação concluída':selected.status==='aberto'?'Contagem aberta':'Em conciliação'}</span>
    </div>
    <div className="sgq-recon-stats">
     <div><small>Itens contados</small><strong>{items.length}</strong></div>
     <div><small>Sem referência</small><strong>{stats.needsCount}</strong></div>
     <div><small>Divergências</small><strong>{stats.different}</strong></div>
     <div><small>Revisões pendentes</small><strong>{stats.pending}</strong></div>
     <div><small>Itens aprovados</small><strong>{stats.complete}</strong></div>
    </div>
    {selected.status==='aberto'&&<div className="sgq-recon-actions">
     <p>O encerramento congela as quantidades da contagem e abre a análise das diferenças.</p>
     {canApprove&&<button type="button" className="primary" disabled={busy||!items.length}
      onClick={()=>void operate('encerrar')}><ClipboardCheck size={17}/> Encerrar contagem e conciliar</button>}
     {!canApprove&&<p className="sgq-recon-muted">Aguardando encerramento pelo responsável pela aprovação.</p>}
    </div>}
    {canEdit&&canApprove&&<div className="sgq-recon-actions">
     <button type="button" className="primary" disabled={busy||!items.length||stats.pending>0||stats.needsCount>0||stats.invalidSources>0}
      onClick={()=>void operate('finalizar')}><CheckCircle2 size={16}/> Concluir conciliação</button>
     {(stats.pending>0||stats.needsCount>0||stats.invalidSources>0)&&<small>Revise todas as referências locais e divergências antes de concluir.</small>}
    </div>}
    {header?.status==='concluida'&&<p className="sgq-recon-complete">
     <CheckCircle2 size={16}/> Conciliação registrada em {header.concluido_em?when(header.concluido_em):'data não informada'}. Análise bloqueada; saldos não alterados.</p>}
   </section>

   <section className="sgq-recon-panel">
    <div className="sgq-recon-title"><h3>Conferência por produto</h3>
     <label className="sgq-recon-filter">Exibir
      <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
       <option value="todos">Todos</option><option value="divergentes">Somente divergências</option>
       <option value="pendentes">Pendentes de revisão</option>
      </select>
     </label></div>
    <div className="sgq-recon-rows">
     {visible.map(item=>{
      const row=byItem.get(item.id)
      const draft=drafts[item.id]||blank()
      const original=Number(item.quantidade_contada)
      const counted=Number(row?.quantidade_recontagem??original)
      const ref=localQuantityReference(row)
      const delta=ref===null||ref===undefined?null:counted-Number(ref)
      const isPending=row?.status==='recontagem_solicitada'
      return <article key={item.id} className="sgq-recon-item">
       <div className="sgq-recon-item-head">
        <div><strong>{item.codigo_omie}</strong><span>{item.descricao_omie}</span><small>{item.endereco}</small></div>
        <div className="sgq-recon-item-status">{row?statusName[row.status]||row.status:selected.status==='aberto'?'Em contagem':'Aguardando conciliação'}</div>
       </div>
       <div className="sgq-recon-values">
        <div><small>Contagem inicial</small><b>{num(original)}</b></div>
        <div><small>Quantidade esperada · local</small><b>{ref===null||ref===undefined?'—':num(Number(ref))}</b></div>
        {row?.quantidade_recontagem!==null&&row?.quantidade_recontagem!==undefined&&
         <div><small>Recontagem</small><b>{num(Number(row.quantidade_recontagem))}</b></div>}
        <div><small>Diferença</small><b className={delta!==null&&delta!==0?'sgq-recon-different':''}>{delta===null?'—':(delta>0?'+':'')+num(delta)}</b></div>
       </div>
       <div className="sgq-recon-notes">
        <div role="group" aria-label="Conferência cadastral do produto no Omie, sem quantidades"><InventoryOmieComparison sku={item.codigo_omie} descricao={item.descricao_omie}/></div>
        {row?.referencia_fonte&&<p><b>Origem da referência física:</b> {quantitySourceLabel(row.referencia_fonte)} · {row.referencia_evidencia}</p>}
        {invalidQuantityReferenceSource(row?.referencia_fonte)&&<p className="sgq-single-alert" role="alert">Origem de quantidade não reconhecida. Selecione uma fonte física SGQ válida para esta localização antes de aprovar.</p>}
        {row?.recontagem_justificativa&&<p><b>Recontagem:</b> {row.recontagem_justificativa}</p>}
        {row?.justificativa_analise&&<p><b>Decisão:</b> {row.justificativa_analise}</p>}
        {photos.some(p=>p.item_id===item.id)&&<button className="secondary small" type="button" onClick={()=>void openPhoto(item.id)}>
         <FileSearch size={15}/> Ver foto da contagem</button>}
       </div>
       {canEdit&&canApprove&&row&&<div className="sgq-recon-edit">
        <h4>Quantidade esperada na mesma localização</h4>
        <div className="sgq-recon-fields">
         <label>Quantidade esperada<input type="number" min="0" step="0.001" inputMode="decimal"
          value={draft.reference} onChange={e=>patch(item.id,{reference:e.target.value})}/></label>
         <label>Origem da referência física (SGQ)
          <select value={draft.source} onChange={e=>patch(item.id,{source:e.target.value})}>
           <option value="">Selecione o registro de referência</option>
           {invalidQuantityReferenceSource(draft.source)&&
            <option value={draft.source} disabled>Origem anterior — regularização necessária</option>}
           {LOCAL_QUANTITY_SOURCES.map(source=><option key={source.value} value={source.value}>{source.label}</option>)}
          </select>
         </label>
         <label>Evidência / documento físico<input maxLength={500} value={draft.evidence}
          placeholder="Ex.: relatório, data e localização conferida"
          onChange={e=>patch(item.id,{evidence:e.target.value})}/></label>
        </div>
        {invalidQuantityReferenceSource(draft.source)&&<p className="sgq-single-alert" role="alert">Esta origem não é válida para uma quantidade de referência. Selecione um registro físico do mesmo endereço no SGQ; não use saldos do Omie.</p>}
        <button type="button" className="secondary small" disabled={busy||parseQty(draft.reference)===null||!isApprovedLocalSource(draft.source)||draft.evidence.trim().length<5}
         onClick={()=>void operate('referencia',item.id,parseQty(draft.reference),draft.source.trim(),draft.evidence.trim())}>
         Salvar referência</button>
       </div>}
       {canEdit&&row&&localQuantityReference(row)!==null&&
        <div className="sgq-recon-edit">
         {canApprove&&!reviewed(row.status)&&row.status!=='recontagem_solicitada'&&<>
          <label>Justificativa da análise ou pedido de recontagem
           <textarea rows={2} maxLength={500} value={draft.reviewNote}
            onChange={e=>patch(item.id,{reviewNote:e.target.value})}
            placeholder="Motivo, conferência ou decisão registrada"/></label>
          <div className="sgq-recon-actions">
           <button className="secondary small" disabled={busy||draft.reviewNote.trim().length<5}
            onClick={()=>void operate('solicitar_recontagem',item.id,null,null,draft.reviewNote.trim())}>
            Solicitar recontagem</button>
           <button type="button" className="primary" disabled={busy||invalidQuantityReferenceSource(row.referencia_fonte)||(delta!==0&&draft.reviewNote.trim().length<5)}
            onClick={()=>void operate('revisar',item.id,null,null,draft.reviewNote.trim())}>
            {delta===0?'Confirmar conciliação':'Aprovar divergência'}</button>
          </div>
         </>}
         {isPending&&canWrite&&<>
          <h4>Registrar recontagem solicitada</h4>
          <div className="sgq-recon-fields">
           <label>Quantidade recontada<input type="number" step="0.001" min="0" inputMode="decimal"
            value={draft.recount} onChange={e=>patch(item.id,{recount:e.target.value})}/></label>
           <label>Observação da recontagem<input maxLength={500}
            placeholder="Descreva a conferência física" value={draft.recountNote}
            onChange={e=>patch(item.id,{recountNote:e.target.value})}/></label>
          </div>
          <button type="button" className="primary" disabled={busy||parseQty(draft.recount)===null||draft.recountNote.trim().length<5}
           onClick={()=>void operate('recontar',item.id,parseQty(draft.recount),null,draft.recountNote.trim())}>
           Salvar recontagem</button>
         </>}
        </div>}
      </article>
     })}
    </div>
    {visible.length===0&&<p className="sgq-recon-muted">{loading?'Carregando…':'Nenhum item corresponde ao filtro selecionado.'}</p>}
   </section>
   {events.length>0&&<section className="sgq-recon-panel">
    <h3>Histórico de decisões</h3>
    <div className="sgq-recon-events">
     {events.map(e=><p key={e.id}><ArrowRight size={14}/><span><b>{operationName[e.acao]||e.acao}</b>
      <small>{when(e.criado_em)} · {actors[e.registrado_por]||'Usuário autorizado'}{e.item_id?' · '+items.find(i=>i.id===e.item_id)?.codigo_omie:''}</small></span></p>)}
    </div>
   </section>}
  </div>}
 </div>
}
