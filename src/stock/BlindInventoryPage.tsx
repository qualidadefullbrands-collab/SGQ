import {useEffect,useMemo,useRef,useState} from 'react'
import {ArrowLeft,Camera,CheckCircle2,ClipboardCheck,Eye,ImagePlus,Plus,RefreshCw,Search,ShieldCheck,Trash2,Upload} from 'lucide-react'
import {authClient} from '../lib/supabase'
import {apiPost} from '../lib/supabase'
import './BlindInventoryPage.css'

type Session={
 id:string;codigo:string;endereco:string;observacao:string;status:'aberto'|'fechado'|'cancelado'
 criado_em:string;criado_por:string;fechado_em?:string|null
}
type Item={
 id:string;inventario_id:string;codigo_omie:string;descricao_omie:string;endereco:string
 quantidade_contada:number;observacao:string;foto_storage_path:string|null;foto_para_omie:boolean
 foto_status:'pendente'|'enviando'|'sincronizada'|'erro';foto_omie_url?:string|null
 foto_omie_erro?:string|null;foto_sgq_path?:string|null;criado_em:string
}
type Product={sku:string;descricao:string;found:boolean}
const bucket='sgq-inventario-cego'
const fmt=(n:number)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:3})
const when=(s:string)=>new Date(s).toLocaleString('pt-BR')
const detail=(error:unknown)=>error instanceof Error?error.message:String(error||'Operação não concluída')
const normalSku=(value:string)=>value.trim().toUpperCase()

export default function BlindInventoryPage({canWrite,canApprove}:{canWrite:boolean;canApprove:boolean}){
 const [sessions,setSessions]=useState<Session[]>([])
 const [showDeleted,setShowDeleted]=useState(false)
 const [active,setActive]=useState<Session|null>(null)
 const [items,setItems]=useState<Item[]>([])
 const [address,setAddress]=useState('')
 const [sku,setSku]=useState('')
 const [count,setCount]=useState('')
 const [product,setProduct]=useState<Product|null>(null)
 const [note,setNote]=useState('')
 const [selectedFile,setSelectedFile]=useState<File|null>(null)
 const [preview,setPreview]=useState('')
 const [flagOmie,setFlagOmie]=useState(false)
 const [search,setSearch]=useState('')
 const [photos,setPhotos]=useState<Record<string,string>>({})
 const [busy,setBusy]=useState(false)
 const [checking,setChecking]=useState(false)
 const [savingPhotoId,setSavingPhotoId]=useState<string|null>(null)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const inputRef=useRef<HTMLInputElement>(null)
 useEffect(()=>{
  if(!selectedFile){setPreview('');return}
  const url=URL.createObjectURL(selectedFile)
  setPreview(url)
  return()=>URL.revokeObjectURL(url)
 },[selectedFile])
 const resetSearch=()=>{setSku('');setProduct(null);setCount('');setNote('');setSelectedFile(null);setFlagOmie(false);inputRef.current?.focus()}
 const sorted=useMemo(()=>items.filter(item=>[item.codigo_omie,item.descricao_omie,item.endereco].join(' ').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))),[items,search])
 const flagged=items.filter(item=>item.foto_para_omie&&item.foto_status!=='sincronizada').length
 const shownSessions=sessions.filter(session=>showDeleted||session.status!=='cancelado')

 async function fetchSessions(){
  const {data,error:queryError}=await authClient.from('sgq_inventarios_cegos')
   .select('id,codigo,endereco,observacao,status,criado_em,criado_por,fechado_em')
   .order('criado_em',{ascending:false}).limit(100)
  if(queryError){setError(detail(queryError));return}
  setSessions((data||[]) as Session[])
 }
 async function fetchItems(sessionId:string){
  const {data,error:queryError}=await authClient.from('sgq_inventario_cego_itens')
   .select('id,inventario_id,codigo_omie,descricao_omie,endereco,quantidade_contada,observacao,foto_storage_path,foto_sgq_path,foto_para_omie,foto_status,foto_omie_url,foto_omie_erro,criado_em')
   .eq('inventario_id',sessionId).order('criado_em',{ascending:false}).limit(2000)
  if(queryError){setError(detail(queryError));return}
  setItems((data||[]) as Item[])
 }
 useEffect(()=>{void fetchSessions()},[])
 async function open(session:Session){
  setError('');setMessage('');setActive(session);setAddress(session.endereco||'')
  setItems([]);setPhotos({});resetSearch();await fetchItems(session.id)
 }
 async function create(){
  if(!canWrite||busy)return
  setBusy(true);setError('');setMessage('')
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sua sessão expirou. Entre novamente.')
   const code='IC-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,6).toUpperCase()
   const {data,error:dbError}=await authClient.from('sgq_inventarios_cegos')
    .insert({codigo:code,endereco:address.trim(),criado_por:user.id,status:'aberto'})
    .select('id,codigo,endereco,observacao,status,criado_em,criado_por,fechado_em').single()
   if(dbError||!data)throw dbError||new Error('Não foi possível criar o inventário.')
   await fetchSessions();await open(data as Session)
   setMessage('Inventário iniciado. O saldo do sistema não será exibido durante a contagem.')
  }catch(e){setError('Falha ao abrir inventário: '+detail(e))}
  finally{setBusy(false)}
 }
 async function verify(){
  const code=normalSku(sku)
  if(!code){setError('Informe o código do produto no Omie.');return}
  setChecking(true);setError('');setProduct(null);setMessage('')
  try{
   const result=await apiPost<Product>('/api/estoque/validar-sku',{codigo:code})
   if(result.error||!result.data?.found||!result.data.descricao)
    throw new Error(result.error?.message||'Código não localizado no Omie.')
   setSku(code);setProduct({sku:code,descricao:result.data.descricao,found:true})
   setMessage('Produto identificado no Omie. Informe a contagem física.')
  }catch(e){setError(detail(e))}
  finally{setChecking(false)}
 }
 async function saveCount(){
  if(!active||active.status!=='aberto'||!canWrite||!product||busy)return
  const rawCount=count.trim()
  const numeric=Number(rawCount.replace(',','.'))
  if(!/^\d+(?:[.,]\d{1,3})?$/.test(rawCount)||!Number.isFinite(numeric)||numeric<0){
   setError('Informe uma quantidade válida, com até três casas decimais. Zero é permitido.');return
  }
  if(selectedFile&&(!['image/jpeg','image/png'].includes(selectedFile.type)||selectedFile.size>8*1024*1024)){
   setError('A foto deve ser JPG ou PNG, com até 8 MB.');return
  }
  if(flagOmie&&!selectedFile){setError('Selecione uma foto para marcá-la como principal no Omie.');return}
  const code=normalSku(product.sku)
  const location=address.trim()
  const prior=items.find(row=>normalSku(row.codigo_omie)===code&&row.endereco===location)
  if(prior&&!window.confirm('Já existe contagem para este código/endereço. Substituir a quantidade registrada?'))return
  setBusy(true);setError('');setMessage('')
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sua sessão expirou. Entre novamente.')
   let itemId=prior?.id||crypto.randomUUID()
   const payload={
    codigo_omie:code,descricao_omie:product.descricao,endereco:location,
    quantidade_contada:numeric,observacao:note.trim(),atualizado_em:new Date().toISOString()
   }
   if(prior){
    const {data:saved,error:dbError}=await authClient.from('sgq_inventario_cego_itens').update(payload).eq('id',itemId).select('id').single()
    if(dbError||!saved)throw dbError||new Error('Não foi possível atualizar a contagem existente.')
   }else{
    const {error:dbError}=await authClient.from('sgq_inventario_cego_itens').insert({
     ...payload,id:itemId,inventario_id:active.id,criado_por:user.id
    })
    if(dbError)throw dbError
   }
   if(selectedFile){
    const extension=selectedFile.type==='image/png'?'png':'jpg'
    const storagePath=[user.id,active.id,itemId,crypto.randomUUID()+'.'+extension].join('/')
    const {error:uploadError}=await authClient.storage.from(bucket).upload(storagePath,selectedFile,{
      upsert:false,contentType:selectedFile.type
    })
    if(uploadError)throw new Error('Contagem salva, mas a foto não foi enviada: '+detail(uploadError))
    const {data:photoSaved,error:photoError}=await authClient.from('sgq_inventario_cego_itens').update({
      foto_storage_path:storagePath,foto_para_omie:flagOmie,atualizado_em:new Date().toISOString()
    }).eq('id',itemId).select('id').single()
    if(photoError||!photoSaved)throw new Error('Contagem salva, mas o vínculo da foto falhou: '+detail(photoError))

    // Reuse the existing SGQ product lookup: it creates the local product if the
    // Omie code is valid and not yet present. Do not merge by similar descriptions.
    const local=await apiPost<{found:boolean;productId:string}>('/api/produtos/consultar',{codigo:code})
    if(local.error||!local.data?.found||!local.data.productId)
     throw new Error('Contagem e evidência salvas, mas o produto local não pôde ser identificado: '+(local.error?.message||'falha na consulta'))
    const photoLocalPath=[local.data.productId,crypto.randomUUID()+'.'+extension].join('/')
    const {error:catalogError}=await authClient.storage.from('produto-fotos').upload(photoLocalPath,selectedFile,{
     upsert:false,contentType:selectedFile.type
    })
    if(catalogError)throw new Error('Contagem e evidência salvas, mas a foto principal do SGQ não foi atualizada: '+detail(catalogError))
    const {data:updatedProduct,error:productPhotoError}=await authClient.from('produtos').update({
     foto_principal_path:photoLocalPath,atualizado_em:new Date().toISOString()
    }).eq('id',local.data.productId).select('id,foto_principal_path').single()
    if(productPhotoError||updatedProduct?.foto_principal_path!==photoLocalPath)
     throw new Error('Contagem e evidência salvas, mas não foi possível confirmar a foto do produto no SGQ: '+detail(productPhotoError))
    const {data:linked,error:linkError}=await authClient.from('sgq_inventario_cego_itens').update({
     foto_sgq_path:photoLocalPath
    }).eq('id',itemId).select('id').single()
    if(linkError||!linked)throw new Error('Foto atualizada no SGQ, mas falhou ao registrar o vínculo de auditoria: '+detail(linkError))
   }
   await fetchItems(active.id);resetSearch()
   setMessage(selectedFile
    ?flagOmie?'Contagem salva e foto do SGQ atualizada. Envio ao Omie aguardando aprovação.':'Contagem salva e foto principal do produto atualizada no SGQ.'
    :'Contagem salva sem alterar o saldo do Omie.')
  }catch(e){setError(detail(e));await fetchItems(active.id)}
  finally{setBusy(false)}
 }
 async function openPhoto(item:Item){
  if(!item.foto_storage_path)return
  if(photos[item.id]){setPhotos(old=>{const copy={...old};delete copy[item.id];return copy});return}
  setSavingPhotoId(item.id);setError('')
  const {data,error:photoError}=await authClient.storage.from(bucket).createSignedUrl(item.foto_storage_path,900)
  if(photoError||!data?.signedUrl)setError('Não foi possível abrir a foto: '+detail(photoError))
  else setPhotos(old=>({...old,[item.id]:data.signedUrl}))
  setSavingPhotoId(null)
 }
 async function close(){
  if(!active||!canApprove||active.status!=='aberto'||busy)return
  if(!items.length){setError('Registre ao menos um produto antes de concluir a contagem.');return}
  if(!window.confirm('Concluir inventário cego? As quantidades ficarão bloqueadas para edição. Nenhum estoque será ajustado.'))return
  setBusy(true);setError('')
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sessão expirada.')
   const {data,error:dbError}=await authClient.from('sgq_inventarios_cegos')
    .update({status:'fechado',fechado_por:user.id,fechado_em:new Date().toISOString()})
    .eq('id',active.id).eq('status','aberto')
    .select('id,codigo,endereco,observacao,status,criado_em,criado_por,fechado_em').single()
   if(dbError||!data)throw dbError||new Error('Inventário não alterado.')
   setActive(data as Session);await fetchSessions()
   setMessage('Contagem encerrada. As fotos marcadas estão disponíveis para revisão.')
  }catch(e){setError(detail(e))}
  finally{setBusy(false)}
 }
 async function excludeSession(session:Session){
  if(!canApprove||session.status!=='aberto'||busy||savingPhotoId)return
  if(!window.confirm('Excluir o inventário '+session.codigo+'? Ele sairá da lista principal e não poderá mais ser editado. As contagens e fotos ficarão preservadas somente no histórico de auditoria.'))return
  setBusy(true);setError('');setMessage('')
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sua sessão expirou. Entre novamente.')
   const {data,error:dbError}=await authClient.from('sgq_inventarios_cegos')
    .update({status:'cancelado',fechado_por:user.id,fechado_em:new Date().toISOString()})
    .eq('id',session.id).eq('status','aberto')
    .select('id').single()
   if(dbError||!data)throw dbError||new Error('O inventário não está mais aberto.')
   if(active?.id===session.id){setActive(null);setItems([]);resetSearch()}
   await fetchSessions()
   setMessage('Inventário '+session.codigo+' excluído da lista ativa. Registro preservado para auditoria.')
  }catch(e){setError('Não foi possível excluir o inventário: '+detail(e))}
  finally{setBusy(false)}
 }
 async function syncOmie(item:Item){
  if(!active||active.status!=='fechado'||!canApprove||!item.foto_para_omie||!item.foto_storage_path||busy)return
  if(!photos[item.id]){setError('Abra e confira a foto antes de aprovar a publicação no Omie.');return}
  if(!window.confirm('Confirmar esta foto como principal no Omie? A imagem será publicada no catálogo e poderá substituir a capa atual do produto.'))return
  setSavingPhotoId(item.id);setError('');setMessage('')
  try{
   const {data,error:fnError}=await authClient.functions.invoke('sgq-inventario-omie',{body:{item_id:item.id}})
   if(fnError||data?.error||data?.ok!==true)throw new Error(data?.error||detail(fnError))
   await fetchItems(active.id)
   setMessage('Foto sincronizada e confirmada no cadastro do produto no Omie.')
  }catch(e){setError('Não foi possível atualizar a foto no Omie: '+detail(e));await fetchItems(active.id)}
  finally{setSavingPhotoId(null)}
 }
 return <div className="sgq-blind-inventory">
  <header className="sgq-blind-hero">
   <div><span className="eyebrow">CONTAGEM FÍSICA · OMIE</span>
    <h2>Inventário às cegas</h2>
    <p>Localize o produto pelo código Omie, registre a quantidade física e, se necessário, fotografe o item. Nenhum saldo esperado ou diferença será exibido durante a contagem.</p></div>
   <span className="sgq-blind-seal"><Eye size={19}/> Sem saldo do sistema</span>
  </header>
  {error&&<div role="alert" className="alert error">{error}</div>}
  {message&&<div role="status" className="alert success">{message}</div>}
  {!active?<section className="sgq-blind-panel">
    <div className="sgq-blind-heading"><h3>Inventários</h3><div className="sgq-blind-actions">
     {canApprove&&<label className="sgq-blind-show-deleted"><input type="checkbox" checked={showDeleted} onChange={e=>setShowDeleted(e.target.checked)}/> Ver excluídos</label>}
     <button type="button" className="secondary small" disabled={busy} onClick={()=>void fetchSessions()}><RefreshCw size={16}/> Atualizar</button>
    </div></div>
    {canWrite&&<div className="sgq-blind-create">
      <label>Endereço / setor (opcional)<input placeholder="Ex.: Rua A · Prateleira 03" value={address} maxLength={120} onChange={e=>setAddress(e.target.value)}/></label>
      <button className="primary" type="button" onClick={()=>void create()} disabled={busy}><Plus size={17}/> {busy?'Criando…':'Iniciar contagem cega'}</button>
    </div>}
    <div className="sgq-blind-session-list">
      {shownSessions.map(s=><div key={s.id} className="sgq-blind-session-card">
        <button type="button" className="sgq-blind-session" disabled={busy} onClick={()=>void open(s)}>
         <b>{s.codigo}</b><span>{s.endereco||'Setor geral'}</span><small>{when(s.criado_em)}</small>
         <strong data-status={s.status}>{s.status==='aberto'?'Em contagem':s.status==='fechado'?'Concluído':'Excluído'}</strong>
        </button>
        {canApprove&&s.status==='aberto'&&<button type="button" className="sgq-blind-delete" disabled={busy} onClick={()=>void excludeSession(s)}
         title={'Excluir inventário '+s.codigo} aria-label={'Excluir inventário '+s.codigo}><Trash2 size={15}/> Excluir</button>}
      </div>)}
      {!shownSessions.length&&<p>{showDeleted?'Nenhum inventário encontrado.':'Nenhum inventário ativo. Os excluídos permanecem disponíveis no histórico.'}</p>}
    </div>
   </section>:<>
    <section className="sgq-blind-panel">
     <div className="sgq-blind-heading">
      <button className="secondary small" type="button" onClick={()=>{setActive(null);setItems([]);resetSearch();void fetchSessions()}}><ArrowLeft size={16}/> Inventários</button>
      <div><h3>{active.codigo}</h3><small>{active.endereco||'Setor geral'} · {active.status==='aberto'?'Em contagem':active.status==='fechado'?'Concluído':'Excluído'}</small></div>
      {canApprove&&active.status==='aberto'&&<button type="button" className="sgq-blind-delete" disabled={busy||!!savingPhotoId} onClick={()=>void excludeSession(active)}><Trash2 size={15}/> Excluir inventário</button>}
     </div>
     <div className="sgq-blind-metrics"><div><span>Itens contados</span><strong>{items.length}</strong></div><div><span>Fotos para revisão</span><strong>{flagged}</strong></div><div><span>Sincronizadas no Omie</span><strong>{items.filter(x=>x.foto_status==='sincronizada').length}</strong></div></div>
     {active.status==='aberto'&&canWrite&&<div className="sgq-blind-capture">
      <div className="sgq-blind-section-head"><ClipboardCheck size={20}/><h3>Registrar produto</h3></div>
      <div className="sgq-blind-find">
       <label>Código do produto Omie<input ref={inputRef} value={sku} onChange={e=>{setSku(e.target.value);setProduct(null)}}
         placeholder="Digite ou leia o SKU" maxLength={60} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void verify()}}}/></label>
       <button type="button" className="secondary" disabled={checking||!sku.trim()} onClick={()=>void verify()}><Search size={17}/>{checking?'Consultando…':'Consultar Omie'}</button>
      </div>
      {product&&<div className="sgq-blind-product" role="status"><CheckCircle2 size={19}/><div><strong>{product.sku}</strong><span>{product.descricao}</span></div><small>Confirmado no Omie</small></div>}
      <div className="sgq-blind-form-grid">
       <label>Quantidade contada<input type="number" inputMode="decimal" min="0" step=".001" value={count} onChange={e=>setCount(e.target.value)} placeholder="0"/></label>
       <label>Endereço físico<input value={address} maxLength={120} onChange={e=>setAddress(e.target.value)} placeholder="Setor / prateleira"/></label>
       <label className="sgq-blind-full">Observação (opcional)<textarea value={note} rows={2} maxLength={1000} onChange={e=>setNote(e.target.value)} placeholder="Embalagem, avaria, lote, observações…"/></label>
      </div>
      <div className="sgq-blind-photo-upload">
       <label className="sgq-blind-photo-picker"><Camera size={18}/> {selectedFile?'Trocar foto':'Fotografar produto'}
        <input type="file" accept="image/jpeg,image/png" capture="environment" onChange={e=>setSelectedFile(e.target.files?.[0]||null)} aria-label="Foto do produto"/>
       </label>
       {preview&&<img src={preview} alt="Prévia da foto a registrar"/>}
       <p className="sgq-blind-photo-note">A foto enviada será definida como foto principal do produto no SGQ.</p>
       <label className="sgq-blind-photo-flag"><input type="checkbox" checked={flagOmie} onChange={e=>setFlagOmie(e.target.checked)} disabled={!selectedFile}/>
        <span><strong>Marcar para atualizar a foto principal no Omie</strong><small>A foto será enviada ao catálogo somente após validação do gestor e encerramento da contagem.</small></span>
       </label>
      </div>
      <div className="sgq-blind-footer"><span>O saldo do ERP não será alterado.</span>
       <button className="primary" type="button" disabled={busy||!canWrite||!product||!count.trim()} onClick={()=>void saveCount()}><Upload size={17}/>{busy?'Salvando…':'Salvar contagem'}</button>
      </div>
     </div>}
     {active.status==='aberto'&&canApprove&&items.length>0&&<div className="sgq-blind-close"><p>Ao concluir, as contagens ficam bloqueadas. A sincronização de fotos não altera estoque.</p><button className="secondary" disabled={busy} onClick={()=>void close()}><ShieldCheck size={16}/> Concluir contagem</button></div>}
    </section>
    <section className="sgq-blind-panel">
     <div className="sgq-blind-heading"><div><h3>Registros físicos</h3><p>Somente quantidades informadas pelos conferentes.</p></div><label className="sgq-blind-list-search"><Search size={15}/><input placeholder="Buscar SKU ou local" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
     <div className="sgq-blind-records">
      {sorted.map(item=><article key={item.id} className="sgq-blind-record">
       <div className="sgq-blind-record-main"><div><strong>{item.codigo_omie}</strong><span>{item.descricao_omie}</span><small>{item.endereco||'Sem endereço'} · {when(item.criado_em)}</small></div>
        <div className="sgq-blind-quantity"><small>Contagem física</small><b>{fmt(item.quantidade_contada)}</b></div>
       </div>
       {item.observacao&&<p>{item.observacao}</p>}
       {item.foto_storage_path&&<div className="sgq-blind-record-photo">
        <button type="button" className="secondary small" onClick={()=>void openPhoto(item)} disabled={savingPhotoId===item.id}><ImagePlus size={15}/>{photos[item.id]?'Ocultar foto':'Ver foto'}</button>
        {item.foto_para_omie&&<span data-sync={item.foto_status}>{item.foto_status==='sincronizada'?'Sincronizada no Omie':item.foto_status==='erro'?'Erro na sincronização':item.foto_status==='enviando'?'Enviando ao Omie':'Aguardando aprovação'}</span>}
        {photos[item.id]&&<img src={photos[item.id]} alt={'Foto física do produto '+item.codigo_omie}/>}
       </div>}
       {canApprove&&active.status==='fechado'&&item.foto_para_omie&&item.foto_storage_path&&item.foto_status!=='sincronizada'&&<div className="sgq-blind-sync">
         <button type="button" className="secondary small" disabled={savingPhotoId===item.id||item.foto_status==='enviando'} onClick={()=>void syncOmie(item)}>
          <ShieldCheck size={16}/>{savingPhotoId===item.id?'Sincronizando…':'Aprovar foto e atualizar Omie'}
         </button>
         {item.foto_omie_erro&&<small role="status">{item.foto_omie_erro}</small>}
       </div>}
      </article>)}
      {!sorted.length&&<div className="sgq-blind-empty"><ClipboardCheck size={24}/><strong>Nenhuma contagem encontrada</strong><p>Consulte um código Omie e registre a quantidade física.</p></div>}
     </div>
    </section>
   </>}
 </div>
}
