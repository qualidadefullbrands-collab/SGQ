import {useEffect,useMemo,useState} from 'react'
import {ArrowLeft,CheckCircle2,ClipboardList,RefreshCw,Search,ShieldCheck} from 'lucide-react'
import {apiGet,apiPost,apiPut} from '../lib/supabase'
import './InventoryPanel.css'

type Session={id:string;codigo:string;status:string;endereco:string|null;criado_em:string;concluido_em?:string|null}
type Item={id:string;amostra_id:string;sku:string|null;descricao:string|null;endereco:string|null;
 unidade_controle:string;saldo_sistema:number;quantidade_contada:number|null;contado_em:string|null}
type Detail={inventario:Session;itens:Item[]}
type StockSample={endereco?:string|null}
const fmt=(v:number)=>Number(v).toLocaleString('pt-BR',{maximumFractionDigits:3})
const date=(s:string)=>new Date(s).toLocaleDateString('pt-BR')
export default function InventoryPanel({samples,canWrite,canApprove,onRefreshStock}:{
 samples:StockSample[];canWrite:boolean;canApprove:boolean;onRefreshStock:()=>Promise<void>
}){
 const [sessions,setSessions]=useState<Session[]>([])
 const [detail,setDetail]=useState<Detail|null>(null)
 const [busy,setBusy]=useState(false)
 const [savingId,setSavingId]=useState<string|null>(null)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [address,setAddress]=useState('')
 const [query,setQuery]=useState('')
 const [drafts,setDrafts]=useState<Record<string,string>>({})
 const [onlyDifferences,setOnlyDifferences]=useState(false)
 const addresses=useMemo(()=>[...new Set(samples.map(s=>s.endereco||'').filter(Boolean))].sort(),[samples])
 async function loadSessions(){
  setError('')
  const r=await apiGet<{inventarios:Session[]}>('/api/estoque/inventarios')
  if(r.error){setError(r.error.message);return}
  setSessions(r.data?.inventarios||[])
 }
 async function open(id:string){
  setBusy(true);setError('');setMessage('')
  const r=await apiGet<Detail>('/api/estoque/inventarios/'+encodeURIComponent(id))
  if(r.error||!r.data)setError(r.error?.message||'Falha ao abrir inventário.')
  else{
   setDetail(r.data);setDrafts(Object.fromEntries((r.data.itens||[]).map(i=>[
    i.amostra_id,i.quantidade_contada===null?'':String(i.quantidade_contada)])))
  }
  setBusy(false)
 }
 useEffect(()=>{void loadSessions()},[])
 async function create(){
  if(!canWrite||busy)return
  setBusy(true);setError('');setMessage('')
  const r=await apiPost<{id:string;codigo:string;itens:number}>('/api/estoque/inventarios',
    {endereco:address||null})
  if(r.error||!r.data?.id)setError(r.error?.message||'Falha ao criar inventário.')
  else{await loadSessions();await open(r.data.id)}
  setBusy(false)
 }
 async function count(item:Item){
  if(!detail||detail.inventario.status!=='aberto'||savingId)return
  const raw=(drafts[item.amostra_id]??'').trim().replace(',','.')
  if(raw!==''&&(!Number.isFinite(Number(raw))||Number(raw)<0)){setError('Contagem inválida.');return}
  const quantity=raw===''?null:Number(raw)
  if(quantity===item.quantidade_contada)return
  setSavingId(item.amostra_id);setError('')
  const r=await apiPut<{ok:boolean}>('/api/estoque/inventarios/'+detail.inventario.id+'/contar',
    {amostraId:item.amostra_id,quantidade:quantity})
  if(r.error)setError(r.error.message)
  else setDetail(old=>old?{...old,itens:old.itens.map(x=>x.amostra_id===item.amostra_id?{
    ...x,quantidade_contada:quantity,contado_em:quantity===null?null:new Date().toISOString()}:x)}:old)
  setSavingId(null)
 }
 async function close(){
  if(!detail||busy||savingId||!canApprove)return
  if(!window.confirm('Fechar inventário? As contagens não poderão mais ser editadas.'))return
  setBusy(true);setError('')
  const r=await apiPost<{ok:boolean;divergencias:number}>('/api/estoque/inventarios/'+detail.inventario.id+'/fechar',{})
  if(r.error)setError(r.error.message)
  else{setMessage('Inventário fechado. '+r.data?.divergencias+' divergência(s).')
    await open(detail.inventario.id);await loadSessions()}
  setBusy(false)
 }
 async function apply(){
  if(!detail||busy||savingId||!canApprove||detail.inventario.status!=='fechado')return
  if(!window.confirm('Aplicar os ajustes auditados ao saldo de estoque? A operação altera os saldos e não pode ser desfeita por este botão.'))return
  setBusy(true);setError('')
  const r=await apiPost<{ok:boolean;ajustes:number}>('/api/estoque/inventarios/'+detail.inventario.id+'/aplicar',{})
  if(r.error)setError(r.error.message)
  else{
    setMessage((r.data?.ajustes??0)+' ajuste(s) aplicado(s) ao estoque.')
    await open(detail.inventario.id);await loadSessions();await onRefreshStock()
  }
  setBusy(false)
 }
 const items=detail?.itens||[]
 const done=items.filter(i=>i.quantidade_contada!==null).length
 const differences=items.filter(i=>i.quantidade_contada!==null&&Number(i.quantidade_contada)!==Number(i.saldo_sistema))
 const visible=items.filter(i=>(!onlyDifferences||i.quantidade_contada!==null&&Number(i.quantidade_contada)!==Number(i.saldo_sistema)) &&
   [i.sku,i.descricao,i.endereco].join(' ').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
 return <div className="sgq-inventory">
  {error&&<div className="alert error" role="alert">{error}</div>}
  {message&&<div className="alert success" role="status">{message}</div>}
  {!detail?<section className="sgq-inventory-start">
    <div className="sgq-inventory-head"><h2>Inventários</h2><button type="button" className="secondary small"
      disabled={busy} onClick={()=>void loadSessions()}><RefreshCw size={15}/> Atualizar</button></div>
    {canWrite&&<div className="sgq-inventory-create">
      <select aria-label="Endereço do inventário" value={address} onChange={e=>setAddress(e.target.value)}>
        <option value="">Todos os endereços</option>
        {addresses.map(x=><option key={x} value={x}>{x}</option>)}
      </select>
      <button type="button" className="primary" onClick={()=>void create()} disabled={busy}>
        <ClipboardList size={17}/> {busy?'Preparando…':'Iniciar inventário'}
      </button>
    </div>}
    <div className="sgq-inventory-sessions">
      {sessions.map(session=><button type="button" key={session.id} onClick={()=>void open(session.id)}
        className="sgq-inventory-session" disabled={busy}>
        <b>{session.codigo}</b><span>{session.endereco||'Todos os endereços'}</span>
        <small>{date(session.criado_em)}</small><strong data-status={session.status}>{session.status}</strong>
      </button>)}
      {!sessions.length&&<p>Nenhum inventário registrado.</p>}
    </div>
  </section>:<section className="sgq-inventory-details">
    <div className="sgq-inventory-head">
      <button type="button" className="secondary small" onClick={()=>setDetail(null)} disabled={busy||!!savingId}>
        <ArrowLeft size={15}/> Inventários
      </button>
      <div><h2>{detail.inventario.codigo}</h2><small>{detail.inventario.endereco||'Todos os endereços'} · {detail.inventario.status}</small></div>
    </div>
    <div className="sgq-inventory-kpis">
      <div><span>Itens</span><strong>{items.length}</strong></div>
      <div><span>Contados</span><strong>{done}/{items.length}</strong></div>
      <div><span>Divergências</span><strong>{differences.length}</strong></div>
    </div>
    <div className="sgq-inventory-toolbar">
      <label><Search size={16}/><input aria-label="Buscar inventário" placeholder="Buscar SKU ou endereço"
        value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label className="sgq-inventory-only"><input type="checkbox" checked={onlyDifferences}
        onChange={e=>setOnlyDifferences(e.target.checked)}/> Só divergências</label>
      {canApprove&&detail.inventario.status==='aberto'&&<button type="button" className="primary"
        disabled={busy||!!savingId||done!==items.length} onClick={()=>void close()}>Fechar inventário</button>}
      {canApprove&&detail.inventario.status==='fechado'&&<button type="button" className="primary"
        disabled={busy||!!savingId} onClick={()=>void apply()}><ShieldCheck size={16}/> Aplicar ajustes</button>}
      {detail.inventario.status==='ajustado'&&<span className="sgq-inventory-done"><CheckCircle2 size={15}/> Ajustes aplicados</span>}
    </div>
    <div className="sgq-inventory-table-scroll"><table className="sgq-inventory-table">
      <thead><tr><th>SKU / Produto</th><th>Endereço</th><th>Saldo sistema</th><th>Contagem física</th><th>Diferença</th></tr></thead>
      <tbody>{visible.map(item=>{
        const raw=drafts[item.amostra_id]??''
        const difference=item.quantidade_contada===null?null:Number(item.quantidade_contada)-Number(item.saldo_sistema)
        return <tr key={item.id} data-divergent={difference!==null&&difference!==0}>
          <td><b>{item.sku||'SKU não vinculado'}</b><small>{item.descricao||'—'}</small></td>
          <td>{item.endereco||'—'}</td><td>{fmt(Number(item.saldo_sistema))}</td>
          <td>{detail.inventario.status==='aberto'&&canWrite?<input type="number" min="0" step="any"
            aria-label={'Contagem '+(item.sku||item.amostra_id)}
            value={raw} disabled={!!savingId} onChange={e=>setDrafts(old=>({...old,[item.amostra_id]:e.target.value}))}
            onBlur={()=>void count(item)}/>:
            item.quantidade_contada===null?'—':fmt(Number(item.quantidade_contada))}
            {savingId===item.amostra_id&&<small>Salvando…</small>}
          </td>
          <td className={difference===null?'':difference===0?'sgq-inventory-ok':'sgq-inventory-variance'}>
            {difference===null?'—':(difference>0?'+':'')+fmt(difference)}
          </td>
        </tr>
      })}</tbody>
    </table></div>
    {!visible.length&&<p>Nenhum item para os filtros selecionados.</p>}
  </section>}
 </div>
}
