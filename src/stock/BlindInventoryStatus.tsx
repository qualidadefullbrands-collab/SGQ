import {useEffect,useMemo,useState} from 'react'
import {AlertTriangle,Camera,CheckCircle2,ClipboardList,RefreshCw,Search,TrendingUp} from 'lucide-react'
import {authClient} from '../lib/supabase'
import {blindInventoryError as explain} from './blindInventoryErrors'
import InventoryOmieComparison from './InventoryOmieComparison'
import {invalidQuantityReferenceSource,localQuantityReference,quantitySourceLabel} from './StockQuantityPolicy'
import './BlindInventoryStatus.css'

type Session={
 id:string;codigo:string;status:string;endereco:string;processo_codigo:string|null;cliente_nome:string|null;
 nf_entrada:string|null;criado_em:string;fechado_em:string|null
}
type Count={
 id:string;inventario_id:string;codigo_omie:string;descricao_omie:string;endereco:string;
 quantidade_contada:number;criado_em:string
}
type Photo={item_id:string;status:string;erro:string|null;sincronizada_em:string|null}
type Reconciliation={inventario_id:string;status:string;iniciado_em:string;concluido_em:string|null}
type Review={inventario_id:string;item_id:string;status:string;quantidade_referencia:number|null;quantidade_recontagem:number|null;referencia_fonte:string|null}
type StatusFilter='todos'|'aberto'|'fechado'|'cancelado'|'foto_erro'|'analise'|'concluida'
const group=<T,>(rows:T[],getKey:(row:T)=>string)=>{
 const result=new Map<string,T[]>()
 for(const row of rows){const key=getKey(row);result.set(key,[...(result.get(key)||[]),row])}
 return result
}
const dt=(date?:string|null)=>date?new Date(date).toLocaleString('pt-BR'):'—'
const fnum=(value:number)=>value.toLocaleString('pt-BR',{maximumFractionDigits:3})
const completed=(s:string)=>s==='conciliado'||s==='divergencia_aprovada'
const photoLabel=(status?:string)=>{
 if(status==='sincronizada')return 'Enviada ao Omie'
 if(status==='erro')return 'Erro no Omie'
 if(status==='enviando')return 'Enviando'
 if(status==='pendente')return 'Pendente de envio'
 return 'Sem foto registrada'
}
const reconciliationLabel=(session:Session,recon?:Reconciliation)=>{
 if(session.status==='cancelado')return 'Não aplicável (cancelado)'
 if(session.status==='aberto')return 'Contagem em andamento'
 if(recon?.status==='concluida')return 'Conciliação concluída'
 if(recon?.status==='em_analise')return 'Conciliação em análise'
 return 'Aguardando abertura de conciliação'
}

export default function BlindInventoryStatus({onOpenCount,onOpenReconciliation}:{
 onOpenCount:()=>void;onOpenReconciliation:()=>void
}){
 const [sessions,setSessions]=useState<Session[]>([])
 const [counts,setCounts]=useState<Count[]>([])
 const [photos,setPhotos]=useState<Photo[]>([])
 const [reconciliations,setReconciliations]=useState<Reconciliation[]>([])
 const [reviews,setReviews]=useState<Review[]>([])
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [query,setQuery]=useState('')
 const [filter,setFilter]=useState<StatusFilter>('todos')
 const [selectedId,setSelectedId]=useState('')
 const [truncated,setTruncated]=useState(false)
 const bySession=useMemo(()=>group(counts,row=>row.inventario_id),[counts])
 const photoByItem=useMemo(()=>new Map(photos.map(photo=>[photo.item_id,photo])),[photos])
 const reconBySession=useMemo(()=>new Map(reconciliations.map(row=>[row.inventario_id,row])),[reconciliations])
 const reviewsBySession=useMemo(()=>group(reviews,row=>row.inventario_id),[reviews])
 const reviewsByItem=useMemo(()=>new Map(reviews.map(row=>[row.item_id,row])),[reviews])
 const selected=sessions.find(row=>row.id===selectedId)
 const stats=useMemo(()=>{
  const current=sessions.filter(s=>s.status!=='cancelado')
  return {
   sessions:sessions.length,open:current.filter(s=>s.status==='aberto').length,
   toReconcile:current.filter(s=>s.status==='fechado'&&reconBySession.get(s.id)?.status!=='concluida').length,
   reconciled:current.filter(s=>reconBySession.get(s.id)?.status==='concluida').length,
   skuCount:counts.filter(c=>sessions.some(s=>s.id===c.inventario_id&&s.status!=='cancelado')).length,
   photoErrors:photos.filter(p=>p.status==='erro').length,
   quantityDifferences:counts.filter(c=>{const review=reviewsByItem.get(c.id);const expected=localQuantityReference(review);return expected!==null&&Number(review?.quantidade_recontagem??c.quantidade_contada)!==expected}).length,
   photoPending:photos.filter(p=>p.status==='pendente'||p.status==='enviando').length
  }
 },[sessions,counts,photos,reconBySession,reviewsByItem])
 const visible=useMemo(()=>{
  const needle=query.trim().toUpperCase()
  return sessions.filter(s=>{
   const entries=bySession.get(s.id)||[]
   const errors=entries.some(c=>photoByItem.get(c.id)?.status==='erro')
   const reconciliation=reconBySession.get(s.id)
   if(filter==='foto_erro'&&!errors)return false
   if(filter==='analise'&&reconciliation?.status!=='em_analise')return false
   if(filter==='concluida'&&reconciliation?.status!=='concluida')return false
   if(['aberto','fechado','cancelado'].includes(filter)&&s.status!==filter)return false
   return !needle||[s.processo_codigo,s.endereco,s.codigo,s.cliente_nome,s.nf_entrada].some(v=>String(v||'').toUpperCase().includes(needle))
    ||entries.some(c=>c.codigo_omie.toUpperCase().includes(needle)||c.descricao_omie.toUpperCase().includes(needle))
  })
 },[sessions,query,filter,bySession,photoByItem,reconBySession])

 async function reload(){
  setLoading(true);setError('')
  try{
   const {data,error:sessionError}=await authClient.from('sgq_inventarios_cegos')
    .select('id,codigo,status,endereco,processo_codigo,cliente_nome,nf_entrada,criado_em,fechado_em')
    .not('processo_codigo','is',null).order('criado_em',{ascending:false}).limit(300)
   if(sessionError)throw sessionError
   const found=(data||[]) as Session[]
   const ids=found.map(s=>s.id)
   setTruncated(found.length===300)
   setSessions(found)
   if(!ids.length){setCounts([]);setPhotos([]);setReconciliations([]);setReviews([]);setSelectedId('');return}
   const sessionChunks=Array.from({length:Math.ceil(ids.length/80)},(_,i)=>ids.slice(i*80,i*80+80))
   const allCounts:Count[]=[]
   const allRecon:Reconciliation[]=[]
   for(const chunk of sessionChunks){
    const recon=await authClient.from('sgq_inventario_conciliacoes')
     .select('inventario_id,status,iniciado_em,concluido_em').in('inventario_id',chunk)
    if(recon.error)throw recon.error
    allRecon.push(...((recon.data||[]) as Reconciliation[]))
    // Fetch every page. The Data API commonly limits results to 1,000 rows.
    let page=0
    while(true){
     const reply=await authClient.from('sgq_inventario_cego_itens')
      .select('id,inventario_id,codigo_omie,descricao_omie,endereco,quantidade_contada,criado_em')
      .in('inventario_id',chunk).order('id',{ascending:true}).range(page*500,page*500+499)
     if(reply.error)throw reply.error
     const rows=(reply.data||[]) as Count[]
     allCounts.push(...rows)
     if(rows.length<500)break
     page++
    }
   }
   setCounts(allCounts);setReconciliations(allRecon)
   const allPhotos:Photo[]=[],allReviews:Review[]=[]
   const itemIds=allCounts.map(row=>row.id)
   for(let offset=0;offset<itemIds.length;offset+=80){
    const chunk=itemIds.slice(offset,offset+80)
    const photo=await authClient.from('sgq_inventario_cego_imagens')
     .select('item_id,status,erro,sincronizada_em').in('item_id',chunk)
    if(photo.error)throw photo.error
    allPhotos.push(...((photo.data||[]) as Photo[]))
   }
   for(const chunk of sessionChunks){
    let page=0
    while(true){
     const reply=await authClient.from('sgq_inventario_conciliacao_itens')
      .select('inventario_id,item_id,status,quantidade_referencia,quantidade_recontagem,referencia_fonte').in('inventario_id',chunk)
      .order('item_id',{ascending:true}).range(page*500,page*500+499)
     if(reply.error)throw reply.error
     const rows=(reply.data||[]) as Review[]
     allReviews.push(...rows)
     if(rows.length<500)break
     page++
    }
   }
   setPhotos(allPhotos);setReviews(allReviews)
   setSelectedId(current=>found.some(s=>s.id===current)?current:'')
  }catch(e){setError('Não foi possível consultar os status: '+explain(e))}
  finally{setLoading(false)}
 }
 useEffect(()=>{void reload()},[])
 return <div className="sgq-inventory-status">
  <header className="sgq-inventory-status-header">
   <div><h2>Status do inventário FST</h2>
    <p>Visão por processo FST e localização, com andamento da contagem, fotos no Omie e conciliação.</p></div>
   <button type="button" className="secondary small" disabled={loading} onClick={()=>void reload()}>
    <RefreshCw size={16}/>{loading?'Atualizando…':'Atualizar'}</button>
  </header>
  <div className="sgq-inventory-status-kpis">
   <div><small>Sessões</small><b>{stats.sessions}</b></div>
   <div><small>Em contagem</small><b>{stats.open}</b></div>
   <div><small>A conciliar</small><b>{stats.toReconcile}</b></div>
   <div><small>Conciliações concluídas</small><b>{stats.reconciled}</b></div>
   <div><small>Itens contados</small><b>{stats.skuCount}</b></div>
   <div><small>Fotos com erro</small><b>{stats.photoErrors}</b></div>
   <div><small>Diferenças físicas confirmáveis</small><b>{stats.quantityDifferences}</b></div>
  </div>
  <p className="sgq-inventory-status-explain">Itens contados representam registros realizados, não percentual de cobertura.
   A referência de quantidade é física e local ao SGQ. O Omie é utilizado somente para conferir código e descrição do produto.
   Nenhum saldo é movimentado nesta tela.</p>
  {truncated&&<p className="sgq-inventory-status-warning">Exibindo as 300 sessões mais recentes. Para um período anterior, será necessária consulta ao histórico completo.</p>}
  {error&&<div role="alert" className="sgq-single-alert">{error}</div>}
  <section className="sgq-inventory-status-panel">
   <div className="sgq-inventory-status-title"><h3>Acompanhamento por localização</h3>
    <div className="sgq-inventory-status-actions">
     <button type="button" className="secondary small" onClick={onOpenCount}><ClipboardList size={15}/> Abrir contagem</button>
     <button type="button" className="primary" onClick={onOpenReconciliation}><TrendingUp size={16}/> Abrir conciliação</button>
    </div>
   </div>
   <div className="sgq-inventory-status-filter">
    <label><Search size={15}/> Pesquisar FST, localização ou SKU
     <input value={query} placeholder="Ex.: FST26125, ARM 07, MK000191"
      onChange={e=>setQuery(e.target.value)}/></label>
    <label>Etapa
     <select value={filter} onChange={e=>setFilter(e.target.value as StatusFilter)}>
      <option value="todos">Todas</option><option value="aberto">Contagens abertas</option>
      <option value="fechado">Contagens encerradas</option><option value="cancelado">Canceladas</option>
      <option value="foto_erro">Com fotos em erro</option><option value="analise">Em conciliação</option>
      <option value="concluida">Conciliação concluída</option>
     </select></label>
   </div>
   <div className="sgq-inventory-status-rows">
    {visible.map(session=>{
     const entries=bySession.get(session.id)||[]
     const reconciliation=reconBySession.get(session.id)
     const reviewedRows=reviewsBySession.get(session.id)||[]
     const sent=entries.filter(c=>photoByItem.get(c.id)?.status==='sincronizada').length
     const errors=entries.filter(c=>photoByItem.get(c.id)?.status==='erro').length
     const pending=entries.filter(c=>['pendente','enviando'].includes(photoByItem.get(c.id)?.status||'')).length
     const analyzed=reviewedRows.filter(r=>completed(r.status)).length
     const lastActivity=entries.map(i=>i.criado_em).sort().at(-1)
     const expanded=selectedId===session.id
     return <article className="sgq-inventory-status-card" key={session.id}>
      <div className="sgq-inventory-status-card-title">
       <div><strong>{session.processo_codigo}</strong><span>{session.endereco} · {session.codigo}</span>
        <small>{session.cliente_nome||'Cliente não informado'} · NF {session.nf_entrada||'não registrada'}</small></div>
       <span className={'sgq-inventory-status-chip '+session.status}>{session.status==='aberto'?'Em contagem':session.status==='fechado'?'Contagem encerrada':'Cancelado'}</span>
      </div>
      <div className="sgq-inventory-status-mini">
       <span><b>{entries.length}</b> SKUs registrados</span>
       <span><b>{sent}</b> fotos confirmadas</span>
       <span className={errors?'sgq-inventory-status-critical':''}><b>{errors}</b> erros de foto</span>
       <span><b>{pending}</b> fotos pendentes</span>
       <span>{reconciliationLabel(session,reconciliation)}{reconciliation?.status==='em_analise'?' · '+analyzed+'/'+reviewedRows.length+' revisados':''}</span>
      </div>
      <div className="sgq-inventory-status-card-bottom"><small>Início: {dt(session.criado_em)} · Última contagem: {dt(lastActivity)}
       {session.fechado_em?' · Encerrado: '+dt(session.fechado_em):''}</small>
       <button type="button" className="secondary small" onClick={()=>setSelectedId(expanded?'':session.id)}>
        {expanded?'Ocultar itens':'Ver itens e fotos'}</button>
      </div>
      {expanded&&<div className="sgq-inventory-status-details">
       <h4>Itens registrados nesta localização</h4>
       {entries.length===0?<p>Esta sessão ainda não possui itens registrados.</p>:
        <div className="sgq-inventory-status-detail-list">
         {entries.map(c=>{
          const photo=photoByItem.get(c.id)
          const review=reviewsByItem.get(c.id)
          const expected=localQuantityReference(review)
          const counted=Number(review?.quantidade_recontagem??c.quantidade_contada)
          const difference=expected===null||expected===undefined?null:counted-Number(expected)
          return <div key={c.id} className="sgq-inventory-status-item">
           <div><b>{c.codigo_omie}</b><span>{c.descricao_omie}</span><small>{c.endereco}</small></div>
           <div className="sgq-inventory-status-quantity">
            <span>Referência física SGQ: <b>{expected===null?'Não verificada':fnum(expected)}</b></span>
            <span>Contado: <b>{fnum(counted)}</b></span>
            <span className={difference!==null&&difference!==0?'sgq-inventory-status-critical':''}>
             Diferença: <b>{difference===null?'—':(difference>0?'+':'')+fnum(difference)}</b>
            </span>
            {review?.referencia_fonte&&<small>Fonte informada: {quantitySourceLabel(review.referencia_fonte)}</small>}
            {invalidQuantityReferenceSource(review?.referencia_fonte)&&<small className="sgq-inventory-status-critical" role="alert">A origem de quantidade vinculada ao Omie não é válida; registre uma referência física do SGQ na conciliação.</small>}
           </div>
           <span className={photo?.status==='erro'?'sgq-inventory-status-critical':''}>
            <Camera size={13}/> {photoLabel(photo?.status)}
            {photo?.erro&&<small title={photo.erro}> · {photo.erro}</small>}
           </span>
           <div className="sgq-inventory-status-audit" role="group" aria-label="Conferência de código e descrição no Omie"><InventoryOmieComparison sku={c.codigo_omie} descricao={c.descricao_omie}/></div>
          </div>
         })}
        </div>}
       {errors>0&&<p className="sgq-inventory-status-warning"><AlertTriangle size={15}/>
        Existem fotos com erro. O arquivo e a contagem estão preservados; use Reenviar foto na tela de contagem.</p>}
       {reconciliation?.status==='concluida'&&<p className="sgq-inventory-status-okay"><CheckCircle2 size={15}/>
        Conciliação concluída em {dt(reconciliation.concluido_em)}. Nenhum ajuste de estoque é aplicado automaticamente.</p>}
      </div>}
     </article>
    })}
   </div>
   {!visible.length&&<p className="sgq-inventory-status-empty">{loading?'Consultando inventários…':'Nenhum inventário corresponde aos filtros selecionados.'}</p>}
  </section>
 </div>
}
