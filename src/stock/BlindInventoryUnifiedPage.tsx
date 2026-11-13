import {useEffect,useMemo,useState} from 'react'
import {Camera,CheckCircle2,ClipboardList,ImagePlus,MapPin,Plus,RefreshCw,Search,Upload} from 'lucide-react'
import {authClient,apiPost} from '../lib/supabase'
import {blindInventoryError} from './blindInventoryErrors'
import './BlindInventoryUnifiedPage.css'

type Session={
 id:string;codigo:string;endereco:string;status:string;processo_codigo:string|null;
 nf_entrada:string|null;data_nf:string|null;cliente_nome:string|null;nf_data_tipo:string|null
}
type CountRow={id:string;inventario_id:string;codigo_omie:string;quantidade_contada:number;endereco:string;foto_storage_path:string|null}
type PhotoRow={id:string;item_id:string;codigo_omie:string;status:string;erro:string|null;omie_url:string|null}
type Product={sku:string;descricao:string}
type OmieProject={
 found?:boolean;matchedCode?:string;cliente?:string|null;source?:string;reason?:string;
 projectId?:number;itens?:Product[];itensDisponiveis?:boolean;
 pedidos?:Array<{codigoPedido:number;numeroPedido:string}>;
}
type OmieNf={found?:boolean;matchedCode?:string;numeroNota?:string|null;data?:string|null;tipoData?:string|null;status?:string;serie?:string}
type Snapshot={codigo:string;cliente:string;nf:string;data:string;nfTipo:string;items:Product[];evidence:string}
type OmieImageResult={ok?:boolean;error?:string;already_synced?:boolean;url?:string}
const upper=(v:string)=>v.trim().toUpperCase()
const readable=blindInventoryError
const nfDate=(value?:string|null)=>{
 const raw=String(value||'').trim()
 if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10)
 const br=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw)
 return br?br[3]+'-'+br[2]+'-'+br[1]:''
}
const normFst=(value:string)=>{
 const raw=upper(value).replace(/\s+/g,'')
 return /^\d{1,8}(-[A-Z0-9]+)?$/.test(raw)?'FST'+raw:raw
}
const same=(a:string,b:string)=>upper(a).replace(/[^A-Z0-9]/g,'')===upper(b).replace(/[^A-Z0-9]/g,'')
const bucket='sgq-inventario-cego'

export default function BlindInventoryUnifiedPage({canWrite}:{canWrite:boolean;canApprove:boolean}){
 const [locations,setLocations]=useState<string[]>([])
 const [location,setLocation]=useState('')
 const [newLocation,setNewLocation]=useState('')
 const [creatingLocation,setCreatingLocation]=useState(false)
 const [sessions,setSessions]=useState<Session[]>([])
 const [session,setSession]=useState<Session|null>(null)
 const [counts,setCounts]=useState<CountRow[]>([])
 const [photos,setPhotos]=useState<PhotoRow[]>([])
 const [processQuery,setProcessQuery]=useState('')
 const [process,setProcess]=useState<Snapshot|null>(null)
 const [client,setClient]=useState('')
 const [nf,setNf]=useState('')
 const [date,setDate]=useState('')
 const [nfType,setNfType]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [orders,setOrders]=useState<NonNullable<OmieProject['pedidos']>>([])
 const [orderId,setOrderId]=useState(0)
 const [selectedSku,setSelectedSku]=useState('')
 const [quantity,setQuantity]=useState('')
 const [photo,setPhoto]=useState<File|null>(null)
 const [preview,setPreview]=useState('')
 const [busy,setBusy]=useState(false)
 const [lookupBusy,setLookupBusy]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [nextPrompt,setNextPrompt]=useState(false)
 const [doneSku,setDoneSku]=useState('')
 const selectedProduct=process?.items.find(p=>p.sku===selectedSku)
 const filteredCounts=useMemo(()=>counts.filter(c=>c.endereco===location&&
  (!process||sessions.some(s=>s.id===c.inventario_id&&s.processo_codigo===process.codigo))),[counts,location,process,sessions])
 const done=new Set(filteredCounts.map(c=>upper(c.codigo_omie)))
 const waiting=photos.filter(p=>p.status==='erro'||p.status==='pendente'||p.status==='enviando')
 const photoOf=(sku:string)=>photos.find(p=>upper(p.codigo_omie)===upper(sku)&&
  counts.some(c=>c.id===p.item_id&&c.endereco===location&&session?.id===c.inventario_id))
 useEffect(()=>{
  if(!photo){setPreview('');return}
  const url=URL.createObjectURL(photo);setPreview(url)
  return()=>URL.revokeObjectURL(url)
 },[photo])
 const clearSelected=()=>{setSelectedSku('');setQuantity('');setPhoto(null)}
 const loadLocations=async()=>{
  const [r,a]=await Promise.all([
   authClient.from('localizacoes_estoque').select('codigo').eq('ativo',true).limit(500),
   authClient.from('amostras').select('endereco').limit(1000)
  ])
  const values=[...(r.data||[]).map(v=>v.codigo),...(a.data||[]).map(v=>v.endereco)]
  const all=[...new Set(values.map(x=>upper(String(x||''))).filter(x=>/^(RUA|ARM(?:ÁRIO|ARIO)?)\s+\S/.test(x)))]
   .sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}))
  setLocations(all)
 }
 const loadSessions=async()=>{
  const {data,error:e}=await authClient.from('sgq_inventarios_cegos').select(
   'id,codigo,endereco,status,processo_codigo,nf_entrada,data_nf,cliente_nome,nf_data_tipo'
  ).eq('status','aberto').order('criado_em',{ascending:false}).limit(200)
  if(e)throw e
  setSessions((data||[]) as Session[])
  return (data||[]) as Session[]
 }
 const loadCounts=async(id:string)=>{
  const {data,error:e}=await authClient.from('sgq_inventario_cego_itens').select(
   'id,inventario_id,codigo_omie,quantidade_contada,endereco,foto_storage_path'
  ).eq('inventario_id',id).limit(1000)
  if(e)throw e
  const rows=(data||[]) as CountRow[]
  setCounts(rows)
  if(rows.length){
   const {data:imgs,error:pe}=await authClient.from('sgq_inventario_cego_imagens')
    .select('id,item_id,codigo_omie,status,erro,omie_url').in('item_id',rows.map(v=>v.id))
   if(pe)throw pe
   setPhotos((imgs||[]) as PhotoRow[])
  }else setPhotos([])
 }
 useEffect(()=>{void Promise.all([loadLocations(),loadSessions()]).catch(e=>setError(readable(e)))},[])
 const resetProcess=()=>{setProcess(null);setOrders([]);setOrderId(0);setConfirmed(false);setSession(null);setCounts([]);setPhotos([]);clearSelected();setNextPrompt(false)}
 async function addLocation(){
  const value=upper(newLocation)
  if(!/^(RUA|ARM)\s+[A-Z0-9][A-Z0-9 /.-]{0,70}$/.test(value)){
   setError('A localização deve começar com RUA ou ARM, seguida de um identificador.');return
  }
  setBusy(true);setError('')
  try{
   const {error:e}=await authClient.from('localizacoes_estoque').insert({
    codigo:value,armario:value.startsWith('ARM ')?value:null,
    descricao:value,ativo:true
   })
   if(e)throw e
   await loadLocations()
   setLocations(current=>[...new Set([...current,value])].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true})))
   setLocation(value);setNewLocation('');setCreatingLocation(false)
  }catch(e){setError('Não foi possível criar localização: '+readable(e))}
  finally{setBusy(false)}
 }
 async function queryProcess(chosenOrder=0){
  const fst=normFst(processQuery)
  if(!location){setError('Selecione ou crie uma localização primeiro.');return}
  if(!/^FST\d{1,8}(-[A-Z0-9]+)?$/.test(fst)){setError('Informe um processo FST válido.');return}
  setLookupBusy(true);setError('');setMessage('');setConfirmed(false);setProcess(null);clearSelected()
  try{
   const [primary,receipt]=await Promise.all([
    authClient.functions.invoke('sgq-omie-fst',{body:{codigo:fst,...(chosenOrder?{codigoPedido:chosenOrder}:{})}}),
    authClient.functions.invoke('sgq-omie-fst',{body:{codigo:fst,modo:'nfe'}})
   ])
   if(primary.error)throw new Error('Consulta Omie indisponível: '+readable(primary.error))
   const result=primary.data as OmieProject|null
   const nfResult=!receipt.error?receipt.data as OmieNf|null:null
   if(!result?.found||!same(result.matchedCode||'',fst))
    throw new Error('Processo não localizado com o código exato no Omie.')
   const choices=result.pedidos||[]
   setOrders(choices)
   if(choices.length>1&&!chosenOrder){
    setOrderId(0)
    setMessage('Este processo tem mais de um pedido. Selecione o pedido correto para consultar seus itens e cliente.')
    return
   }
   const goods=(result.itens||[]).map(p=>({sku:upper(p.sku),descricao:p.descricao||p.sku}))
    .filter(p=>p.sku)
   const products=[...new Map(goods.map(p=>[p.sku,p])).values()]
   if(!result.itensDisponiveis||!products.length)
    throw new Error('O Omie não retornou os itens deste processo. Se houver vários pedidos, escolha o pedido para continuar.')
   const nfMatched=nfResult?.found&&same(nfResult.matchedCode||'',fst)&&nfResult.status==='matched'
   const receiptNf=nfMatched?String(nfResult?.numeroNota||''):''
   const receiptDate=nfMatched?nfDate(nfResult?.data):''
   const customer=String(result.cliente||'').trim()
   const saved=(await loadSessions()).find(s=>s.endereco===location&&s.processo_codigo===fst)
   if(saved){
    await loadCounts(saved.id)
    setSession(saved)
   }else{setSession(null);setCounts([]);setPhotos([])}
   setClient(saved?.cliente_nome||customer)
   setNf(saved?.nf_entrada||receiptNf)
   setDate(saved?.data_nf||receiptDate)
   setNfType(saved?.nf_data_tipo||(receiptDate?nfResult?.tipoData||'registro_omie':'informada'))
   setConfirmed(false)
   setProcess({codigo:fst,cliente:customer,nf:receiptNf,data:receiptDate,
    nfTipo:nfMatched?nfResult?.tipoData||'registro_omie':'nao_confirmada',
    items:products,evidence:nfMatched?'NF identificada no recebimento do Omie':'NF não confirmada automaticamente no Omie'})
   setMessage(saved?'Contagens anteriores carregadas. Os produtos já contados estão identificados.':'Confirme cliente, NF de entrada e data antes de iniciar.')
  }catch(e){setError(readable(e))}
  finally{setLookupBusy(false)}
 }
 async function confirmProcess(){
  if(!process||!location||!canWrite)return
  if(!client.trim()||!nf.trim()||!date){setError('Informe e confira cliente, NF de entrada e data.');return}
  setBusy(true);setError('');setMessage('')
  try{
   if(session){
    if(session.processo_codigo!==process.codigo||session.endereco!==location)
     throw new Error('A sessão aberta pertence a outro processo ou endereço.')
    if(session.cliente_nome!==client.trim()||session.nf_entrada!==nf.trim()||session.data_nf!==date)
     throw new Error('Os dados deste inventário já foram confirmados anteriormente. Consulte a sessão correta antes de alterar NF ou cliente.')
    setConfirmed(true);return
   }
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sua sessão expirou. Entre novamente.')
   const code='IC-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,6).toUpperCase()
   const {data,error:e}=await authClient.from('sgq_inventarios_cegos').insert({
    codigo:code,endereco:location,criado_por:user.id,status:'aberto',
    processo_codigo:process.codigo,cliente_nome:client.trim(),
    nf_entrada:nf.trim(),data_nf:date,
    nf_data_tipo:process.data===date&&process.nf===nf?nfType:'informada',
    dados_confirmados_em:new Date().toISOString()
   }).select('id,codigo,endereco,status,processo_codigo,nf_entrada,data_nf,cliente_nome,nf_data_tipo').single()
   if(e||!data)throw e||new Error('Não foi possível iniciar a contagem.')
   setSession(data as Session);setConfirmed(true);setCounts([]);setPhotos([])
   await loadSessions()
   setMessage('Processo validado. Selecione o primeiro item.')
  }catch(e){setError('Falha ao confirmar processo: '+readable(e))}
  finally{setBusy(false)}
 }
 async function uploadToOmie(photoId:string){
  const response=await authClient.functions.invoke('sgq-inventario-foto-direta',{body:{foto_id:photoId}})
  if(response.error||!response.data?.ok){
   const data=response.data as OmieImageResult|null
   let reason=data?.error||readable(response.error||new Error('Sem confirmação do Omie.'))
   if(response.error&&'context' in response.error){
    try{const body=await (response.error as {context:Response}).context.json() as OmieImageResult;reason=body?.error||reason}catch{/**/}
   }
   throw new Error(reason)
  }
 }
 async function retryPhoto(image:PhotoRow){
  setBusy(true);setError('')
  try{
   await uploadToOmie(image.id)
   if(session)await loadCounts(session.id)
   setMessage('Foto do SKU '+image.codigo_omie+' confirmada no Omie.')
  }catch(e){setError('Foto do SKU '+image.codigo_omie+' não confirmada no Omie: '+readable(e))}
  finally{setBusy(false)}
 }
 async function saveItem(){
  if(!canWrite||!session||!process||!confirmed||busy||!selectedProduct)return
  if(!location||session.endereco!==location){setError('Confira a localização do processo.');return}
  const raw=quantity.trim(),qty=Number(raw.replace(',','.'))
  if(!/^\d+([.,]\d{1,3})?$/.test(raw)||!Number.isFinite(qty)){setError('Informe a quantidade, até três casas decimais.');return}
  if(photo&&(!['image/jpeg','image/png'].includes(photo.type)||photo.size>8*1024*1024)){
   setError('A foto deve ser JPG ou PNG, até 8 MB.');return
  }
  const previous=counts.find(c=>upper(c.codigo_omie)===selectedProduct.sku&&c.endereco===location)
  const existingPhoto=previous&&photos.find(p=>p.item_id===previous.id)
  if(!photo&&!existingPhoto){setError('Tire ou selecione uma foto do produto.');return}
  if(previous&&!window.confirm('Produto já contado. Deseja atualizar a quantidade registrada?'))return
  if(existingPhoto&&photo){setError('Este item já possui uma foto registrada. A contagem usa somente uma foto por produto.');return}
  setBusy(true);setError('');setMessage('');setNextPrompt(false)
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sessão expirada. Entre novamente.')
   const id=previous?.id||crypto.randomUUID()
   const payload={
    codigo_omie:selectedProduct.sku,descricao_omie:selectedProduct.descricao,
    endereco:location,endereco_armario:location,endereco_prateleira:'',endereco_caixa:'',
    processo_id:null,processo_codigo:process.codigo,cliente_nome:client.trim(),
    cliente_confirmado:true,
    verificacao_cadastro:{modo:'processo_omie',processo:process.codigo,
     sku:selectedProduct.sku,fonte:'sgq_omie_fst',nfEntrada:nf,cliente:client,
     dataNf:date,consultadoEm:new Date().toISOString()},
    quantidade_contada:qty,observacao:'',atualizado_em:new Date().toISOString()
   }
   if(previous){
    const {data,error:e}=await authClient.from('sgq_inventario_cego_itens').update({
     quantidade_contada:qty,atualizado_em:new Date().toISOString()
    }).eq('id',id).select('id').maybeSingle()
    if(e||!data)throw e||new Error('Recontagem não salva.')
   }else{
    const {error:e}=await authClient.from('sgq_inventario_cego_itens').insert({
     ...payload,id,inventario_id:session.id,criado_por:user.id
    })
    if(e)throw e
   }
   if(photo&&!existingPhoto){
    const ext=photo.type==='image/png'?'png':'jpg'
    const path=[user.id,session.id,id,crypto.randomUUID()+'.'+ext].join('/')
    const {error:uploadError}=await authClient.storage.from(bucket).upload(path,photo,{
     contentType:photo.type,upsert:false
    })
    if(uploadError)throw new Error('Contagem registrada, mas a foto não foi enviada ao SGQ: '+readable(uploadError))
    const {error:linkError}=await authClient.from('sgq_inventario_cego_itens').update({
     foto_storage_path:path,atualizado_em:new Date().toISOString()
    }).eq('id',id)
    if(linkError)throw new Error('Contagem registrada, mas não foi possível vincular a foto: '+readable(linkError))
    const {data:record,error:photoError}=await authClient.from('sgq_inventario_cego_imagens').insert({
     item_id:id,codigo_omie:selectedProduct.sku,storage_path:path,criado_por:user.id
    }).select('id').single()
    if(photoError||!record)throw photoError||new Error('Não foi possível registrar o envio da foto.')
    try{
     await uploadToOmie(record.id)
     setMessage('Contagem salva e foto do produto '+selectedProduct.sku+' confirmada no Omie.')
    }catch(e){
     setError('Contagem e foto salvas no SGQ. O Omie ainda não confirmou a imagem do SKU '+selectedProduct.sku+': '+readable(e)+'. Use Reenviar foto para concluir.')
    }
   }else if(existingPhoto?.status!=='sincronizada'){
    try{
     await uploadToOmie(existingPhoto.id)
     setMessage('Contagem atualizada. Foto confirmada no Omie.')
    }catch(e){setError('Contagem atualizada, mas a foto segue pendente no Omie: '+readable(e))}
   }else setMessage('Contagem atualizada. Foto já vinculada e confirmada no Omie.')
   await loadCounts(session.id)
   setDoneSku(selectedProduct.sku);setNextPrompt(true)
  }catch(e){setError('Falha na contagem: '+readable(e));await loadCounts(session.id)}
  finally{setBusy(false)}
 }
 function nextItem(){
  setNextPrompt(false);clearSelected()
  setMessage('Selecione o próximo item do processo '+process?.codigo+'.')
 }
 const chooseSku=(code:string)=>{
  const name=upper(code)
  setSelectedSku(name);setPhoto(null);setNextPrompt(false);setError('')
  const old=counts.find(c=>upper(c.codigo_omie)===name&&c.endereco===location)
  setQuantity(old?String(old.quantidade_contada):'')
 }
 return <div className="sgq-unified sgq-blind-inventory">
  <header className="sgq-unified-heading"><div><h2>Inventário às cegas</h2>
   <p>Localização, processo, produto e contagem no mesmo fluxo.</p></div>
   <span><ClipboardList size={16}/> Sem exibir saldo do Omie</span></header>
  {error&&<div role="alert" className="sgq-unified-alert error">{error}</div>}
  {message&&<div role="status" className="sgq-unified-alert ok">{message}</div>}
  <section className="sgq-unified-card">
   <div className="sgq-unified-title"><MapPin size={19}/><h3>1. Localização</h3></div>
   <div className="sgq-unified-controls">
    <label>Rua ou armário
     <select value={location} disabled={busy||confirmed} onChange={e=>{
      setLocation(e.target.value);resetProcess();setError('');setMessage('')
     }}><option value="">Selecione a localização</option>
      {locations.map(x=><option value={x} key={x}>{x}</option>)}</select>
    </label>
    {canWrite&&!confirmed&&<button type="button" className="secondary" onClick={()=>setCreatingLocation(v=>!v)}>
     <Plus size={17}/> Nova localização</button>}
   </div>
   {creatingLocation&&<div className="sgq-unified-controls">
    <label>Nome da rua ou armário<input value={newLocation} onChange={e=>setNewLocation(e.target.value)} placeholder="ARM 07 ou RUA B" maxLength={80}/></label>
    <button type="button" className="primary" disabled={busy||!newLocation.trim()} onClick={()=>void addLocation()}>Criar e selecionar</button>
   </div>}
  </section>
  <section className="sgq-unified-card">
   <div className="sgq-unified-title"><Search size={19}/><h3>2. Processo e validação</h3></div>
   <div className="sgq-unified-controls">
    <label>Processo FST<input value={processQuery} disabled={busy||confirmed} onChange={e=>{setProcessQuery(e.target.value);resetProcess()}}
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void queryProcess()}}}
     placeholder="FST26125-A ou 26125"/></label>
    <button type="button" className="secondary" disabled={lookupBusy||busy||!location||!processQuery.trim()}
     onClick={()=>void queryProcess()}><Search size={17}/>{lookupBusy?'Consultando…':'Consultar Omie'}</button>
   </div>
   {orders.length>1&&!process&&<div className="sgq-unified-controls">
    <label>Pedido vinculado ao processo<select value={orderId} onChange={e=>setOrderId(Number(e.target.value))}>
     <option value={0}>Selecione o pedido</option>
     {orders.map(o=><option key={o.codigoPedido} value={o.codigoPedido}>{o.numeroPedido||o.codigoPedido}</option>)}
    </select></label>
    <button type="button" className="secondary" disabled={!orderId||lookupBusy} onClick={()=>void queryProcess(orderId)}>Carregar itens</button>
   </div>}
   {process&&<div className="sgq-unified-validation">
    <div className="sgq-unified-controls">
     <label>Cliente<input value={client} disabled={confirmed} onChange={e=>setClient(e.target.value)} maxLength={180}/></label>
     <label>NF de entrada<input value={nf} disabled={confirmed} onChange={e=>setNf(e.target.value)} maxLength={30} placeholder="Número da nota"/></label>
     <label>Data da NF<input type="date" value={date} disabled={confirmed} onChange={e=>{setDate(e.target.value);setNfType('informada')}}/></label>
    </div>
    <p>{process.evidence}. {process.cliente?'Cliente informado pelo Omie: '+process.cliente+'.':'Cliente não retornado pelo Omie; confirme manualmente.'}
     {process.data?' Data retornada pelo Omie: '+new Date(process.data+'T12:00:00').toLocaleDateString('pt-BR')+'.':''}</p>
    {!confirmed&&<button type="button" className="primary" disabled={!canWrite||busy||!client.trim()||!nf.trim()||!date}
     onClick={()=>void confirmProcess()}><CheckCircle2 size={17}/> Confirmar e iniciar contagem</button>}
    {confirmed&&<div className="sgq-unified-confirm"><CheckCircle2 size={17}/> Dados confirmados · {session?.codigo}</div>}
   </div>}
  </section>
  {process&&confirmed&&session&&<section className="sgq-unified-card">
   <div className="sgq-unified-title"><ClipboardList size={19}/><h3>3. Selecionar item e contar</h3>
    <span>{done.size} de {process.items.length} já contados nesta localização</span></div>
   <div className="sgq-unified-products">
    {process.items.map(p=><button type="button" key={p.sku} onClick={()=>chooseSku(p.sku)}
     className={'sgq-unified-product '+(selectedSku===p.sku?'active':'')} disabled={busy}>
     <strong>{p.sku}</strong><span>{p.descricao}</span>
     <small>{done.has(p.sku)?'✓ Já contado':'Pendente'}</small>
    </button>)}
   </div>
   {selectedProduct&&<div className="sgq-unified-count">
    <div className="sgq-unified-selected"><strong>{selectedProduct.sku}</strong><span>{selectedProduct.descricao}</span>
     {done.has(selectedProduct.sku)&&<b>Já contado — a quantidade pode ser revisada</b>}</div>
    <div className="sgq-unified-controls">
     <label>Quantidade contada<input type="number" min={0} inputMode="decimal" step=".001"
      value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)}/></label>
     <div className="sgq-unified-single-photo">
      <label className="sgq-unified-photo-button"><Camera size={17}/> Tirar foto
       <input type="file" accept="image/jpeg,image/png" capture="environment" disabled={busy||!!photoOf(selectedSku)}
        onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label>
      <label className="sgq-unified-photo-button"><ImagePlus size={17}/> Selecionar foto
       <input type="file" accept="image/jpeg,image/png" disabled={busy||!!photoOf(selectedSku)}
        onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label>
      {preview&&<img src={preview} alt="Única foto do produto" />}
      {photoOf(selectedSku)&&<span>Foto já registrada · {photoOf(selectedSku)?.status==='sincronizada'?'Confirmada no Omie':'Pendente no Omie'}</span>}
      {!photoOf(selectedSku)&&<small>Uma foto por produto.</small>}
     </div>
    </div>
    <button type="button" className="primary" disabled={busy||!quantity.trim()||(!photo&&!photoOf(selectedSku))}
     onClick={()=>void saveItem()}><Upload size={17}/>{busy?'Salvando…':'Salvar quantidade e foto no Omie'}</button>
   </div>}
   {nextPrompt&&<div className="sgq-unified-next" role="dialog" aria-label="Continuar contagem">
    <strong>Item {doneSku} registrado. Deseja contar o próximo item?</strong>
    <button type="button" className="primary" onClick={nextItem}>Sim, próximo item</button>
    <button type="button" className="secondary" onClick={()=>{setNextPrompt(false);clearSelected();setMessage('Contagem preservada. Você pode consultar este processo novamente depois.')}}>Não, encerrar por enquanto</button>
   </div>}
   {waiting.length>0&&<div className="sgq-unified-pending"><b>Fotos ainda não confirmadas no Omie</b>
    {waiting.map(p=><div key={p.id}><span>{p.codigo_omie}: {p.status==='erro'?p.erro||'Erro no envio':p.status==='enviando'?'Enviando…':'Pendente'}</span>
     {p.status!=='enviando'&&<button type="button" className="secondary" disabled={busy} onClick={()=>void retryPhoto(p)}>
      <RefreshCw size={14}/> Reenviar foto</button>}</div>)}</div>}
  </section>}
  <footer className="sgq-unified-footer">Contagens anteriores do mesmo processo e localização são recuperadas quando o processo é consultado novamente.</footer>
 </div>
