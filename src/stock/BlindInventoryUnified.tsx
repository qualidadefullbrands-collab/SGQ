import {useEffect,useMemo,useState} from 'react'
import {Camera,CheckCircle2,ImagePlus,MapPin,Plus,RefreshCw,Search,ShieldAlert,Upload} from 'lucide-react'
import {authClient,apiPost} from '../lib/supabase'
import {blindInventoryError as explain} from './blindInventoryErrors'
import './BlindInventoryUnified.css'

type ProcessRow={id:string;codigo:string;cliente:string|null;nota_fiscal:string|null}
type Order={codigoPedido:number;numeroPedido:string}
type OmieInfo={found?:boolean;cliente?:string|null;matchedCode?:string;itens?:Array<{sku:string;descricao:string}>;itensDisponiveis?:boolean;pedidos?:Order[];reason?:string;source?:string}
type NfInfo={found?:boolean;status?:string;numeroNota?:string;data?:string|null;tipoData?:string;dataRegistro?:string|null;dataEmissao?:string|null;serie?:string}
type Product={sku:string;descricao:string}
type Session={id:string;codigo:string;endereco:string;status:string;processo_codigo:string|null;nf_entrada:string|null;data_nf:string|null;cliente_nome:string|null}
type CountRow={id:string;inventario_id:string;codigo_omie:string;endereco:string;processo_codigo:string|null;quantidade_contada:number;criado_em:string;criado_por:string}
type PhotoRow={id:string;item_id:string;codigo_omie:string;status:string;erro:string|null;omie_url:string|null;criado_por:string}
type DocRow={id:string;arquivo_nome:string;storage_path:string;criado_em:string}
const validProcess=/^FST\d{1,8}(?:-[A-Z0-9]+)?$/
const validLocation=/^(?:RUA|ARM(?:ÁRIO|ARIO)?)\b/i
const normalized=(value:string)=>value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const normalizedProcess=(value:string)=>normalized(value).replace(/^FST/,'')
const skuOf=(value:string)=>value.trim().toUpperCase()
const toIso=(value:unknown)=>{
 const text=String(value||'').trim()
 const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
 const result=m?m[3]+'-'+m[2]+'-'+m[1]:/^\d{4}-\d{2}-\d{2}$/.test(text)?text:''
 if(!result)return ''
 const date=new Date(result+'T12:00:00Z')
 return Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==result?'':result
}
const uniqueLocations=(values:string[])=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}))
const dateTime=(value:string)=>new Date(value).toLocaleString('pt-BR')

export default function BlindInventoryUnified({canWrite}:{canWrite:boolean;canApprove:boolean}){
 const [locations,setLocations]=useState<string[]>([])
 const [location,setLocation]=useState('')
 const [creatingLocation,setCreatingLocation]=useState(false)
 const [newLocation,setNewLocation]=useState('')
 const [query,setQuery]=useState('')
 const [processCode,setProcessCode]=useState('')
 const [sgqProcess,setSgqProcess]=useState<ProcessRow|null>(null)
 const [omie,setOmie]=useState<OmieInfo|null>(null)
 const [nfe,setNfe]=useState<NfInfo|null>(null)
 const [client,setClient]=useState('')
 const [nfNumber,setNfNumber]=useState('')
 const [nfDate,setNfDate]=useState('')
 const [nfDateSource,setNfDateSource]=useState('informada')
 const [order,setOrder]=useState('')
 const [products,setProducts]=useState<Product[]>([])
 const [confirmed,setConfirmed]=useState(false)
 const [session,setSession]=useState<Session|null>(null)
 const [counts,setCounts]=useState<CountRow[]>([])
 const [photoRows,setPhotoRows]=useState<PhotoRow[]>([])
 const [selectedSku,setSelectedSku]=useState('')
 const [quantity,setQuantity]=useState('')
 const [photo,setPhoto]=useState<File|null>(null)
 const [preview,setPreview]=useState('')
 const [inspection,setInspection]=useState<File|null>(null)
 const [inspections,setInspections]=useState<DocRow[]>([])
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(false)
 const [syncing,setSyncing]=useState('')
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [warnings,setWarnings]=useState<string[]>([])
 const selected=useMemo(()=>products.find(p=>p.sku===selectedSku),[products,selectedSku])
 const countedBySku=useMemo(()=>{
  const map=new Map<string,CountRow[]>()
  for(const row of counts){
   const key=skuOf(row.codigo_omie)
   map.set(key,[...(map.get(key)||[]),row])
  }
  return map
 },[counts])
 const selectedCounts=countedBySku.get(selectedSku)||[]
 const photosForSelected=photoRows.filter(p=>selectedCounts.some(c=>c.id===p.item_id))
 const alreadyPhotographed=!!counts.find(c=>c.inventario_id===session?.id&&skuOf(c.codigo_omie)===selectedSku&&photoRows.some(p=>p.item_id===c.id))

 useEffect(()=>{
  if(!photo){setPreview('');return}
  const objectUrl=URL.createObjectURL(photo)
  setPreview(objectUrl)
  return()=>URL.revokeObjectURL(objectUrl)
 },[photo])

 async function loadLocations(){
  const [registered,samples]=await Promise.all([
   authClient.from('localizacoes_estoque').select('codigo,armario').eq('ativo',true).limit(500),
   authClient.from('amostras').select('endereco').limit(1000)
  ])
  if(registered.error&&samples.error)throw registered.error
  const candidates=[
   ...(registered.data||[]).flatMap(x=>[x.codigo,x.armario||'']),
   ...(samples.data||[]).map(x=>x.endereco||'')
  ]
  setLocations(uniqueLocations(candidates.map(v=>String(v).trim().toUpperCase()).filter(v=>validLocation.test(v))))
 }
 useEffect(()=>{void loadLocations().catch(e=>setError(explain(e)))},[])

 function clearProcess(){
  setProcessCode('');setSgqProcess(null);setOmie(null);setNfe(null);setClient('');setNfNumber('')
  setNfDate('');setNfDateSource('informada');setOrder('');setProducts([]);setConfirmed(false)
  setSession(null);setCounts([]);setPhotoRows([]);setSelectedSku('');setQuantity('');setPhoto(null)
  setInspections([]);setInspection(null);setError('');setMessage('');setWarnings([])
 }
 function resetItem(){setSelectedSku('');setQuantity('');setPhoto(null);setError('')}
 function selectLocation(next:string){
  setLocation(next)
  // Preserve process results, but a new location needs its own session confirmation.
  setConfirmed(false);setSession(null);resetItem();setMessage('')
 }
 async function addLocation(){
  if(!canWrite||busy)return
  const code=newLocation.trim().replace(/\s+/g,' ').toUpperCase().replace(/^ARM(?:ÁRIO|ARIO)\b/,'ARM')
  if(!validLocation.test(code)||code.length<3||code.length>80){
   setError('Informe um endereço iniciado por RUA ou ARM, com até 80 caracteres.');return
  }
  setBusy(true);setError('')
  try{
   const {data,error:insertError}=await authClient.from('localizacoes_estoque')
    .insert({codigo:code,descricao:'Localização do inventário',ativo:true}).select('codigo').single()
   if(insertError&&insertError.code!=='23505')throw insertError
   if(!data&&insertError?.code!=='23505')throw new Error('Não foi possível cadastrar a localização.')
   await loadLocations()
   selectLocation(code);setNewLocation('');setCreatingLocation(false)
   setMessage('Localização '+code+' cadastrada.')
  }catch(e){setError('Localização não cadastrada: '+explain(e))}
  finally{setBusy(false)}
 }

 async function loadCounts(code:string){
  const {data,error:dbError}=await authClient.from('sgq_inventario_cego_itens')
   .select('id,inventario_id,codigo_omie,endereco,processo_codigo,quantidade_contada,criado_em,criado_por')
   .ilike('processo_codigo',code).order('criado_em',{ascending:false}).limit(2000)
  if(dbError)throw dbError
  const records=(data||[]) as CountRow[]
  setCounts(records)
  if(records.length){
   const {data:images,error:imagesError}=await authClient.from('sgq_inventario_cego_imagens')
    .select('id,item_id,codigo_omie,status,erro,omie_url,criado_por')
    .in('item_id',records.map(r=>r.id)).limit(2000)
   if(imagesError)throw imagesError
   setPhotoRows((images||[]) as PhotoRow[])
  }else setPhotoRows([])
 }
 async function loadInspections(id:string){
  const {data,error:readError}=await authClient.from('sgq_inventario_cego_documentos')
   .select('id,arquivo_nome,storage_path,criado_em')
   .eq('inventario_id',id).order('criado_em',{ascending:false}).limit(40)
  if(readError)throw readError
  setInspections((data||[]) as DocRow[])
 }
 async function loadProcess(code:string,orderId?:number){
  const [remote,receipt,local,existingSession]=await Promise.all([
   authClient.functions.invoke('sgq-omie-fst',{body:{codigo:code,...(orderId?{codigoPedido:orderId}:{})}}),
   authClient.functions.invoke('sgq-omie-fst',{body:{codigo:code,modo:'nfe'}}),
   authClient.from('processos').select('id,codigo,cliente,nota_fiscal')
    .in('codigo',[code,code.replace(/^FST/,'')]).is('excluido_em',null).limit(1).maybeSingle(),
   authClient.from('sgq_inventarios_cegos')
    .select('id,codigo,endereco,status,processo_codigo,nf_entrada,data_nf,cliente_nome')
    .eq('endereco',location).eq('processo_codigo',code).eq('status','aberto').limit(1).maybeSingle()
  ])
  if(remote.error)throw new Error('Não foi possível consultar o processo no Omie: '+explain(remote.error))
  const data=remote.data as OmieInfo|null
  if(!data?.found||normalizedProcess(data.matchedCode||'')!==normalizedProcess(code))
   throw new Error('O processo '+code+' não foi confirmado no Omie. Confira o código completo.')
  const sgq=local.data as ProcessRow|null
  const fiscal=receipt.error?null:receipt.data as NfInfo|null
  const previous=existingSession.data as Session|null
  setProcessCode(code);setSgqProcess(sgq);setOmie(data);setNfe(fiscal)
  setClient(data.cliente||previous?.cliente_nome||sgq?.cliente||'')
  setNfNumber(fiscal?.status==='matched'?fiscal.numeroNota||'':previous?.nf_entrada||sgq?.nota_fiscal||'')
  const actualDate=toIso(fiscal?.dataRegistro||fiscal?.dataEmissao||fiscal?.data)
  setNfDate(actualDate||toIso(previous?.data_nf))
  setNfDateSource(actualDate?(fiscal?.dataRegistro?'registro_omie':'emissao_omie'):'informada')
  const list=new Map<string,Product>()
  if(data.itensDisponiveis&&Array.isArray(data.itens)){
   for(const row of data.itens){
    const sku=skuOf(row.sku)
    if(sku)list.set(sku,{sku,descricao:row.descricao||sku})
   }
  }
  setProducts([...list.values()].sort((a,b)=>a.sku.localeCompare(b.sku,'pt-BR')))
  const issues:string[]=[]
  if(!data.cliente)issues.push('Cliente não identificado no Omie: confira o cadastro/cliente SGQ.')
  if(fiscal?.status!=='matched')issues.push('NF de entrada não confirmada de forma única no Omie. Confira os dados informados antes de prosseguir.')
  if(!actualDate)issues.push('Data fiscal não localizada no retorno do Omie. Informe a data da NF manualmente.')
  if(!data.itensDisponiveis||!list.size)issues.push('Os itens do pedido não foram confirmados no Omie. Selecione um pedido vinculado ou revise o processo.')
  if(sgq?.cliente&&data.cliente&&normalized(sgq.cliente)!==normalized(data.cliente))
   issues.push('Divergência de cliente: SGQ '+sgq.cliente+' · Omie '+data.cliente)
  if(sgq?.nota_fiscal&&fiscal?.numeroNota&&sgq.nota_fiscal!==fiscal.numeroNota)
   issues.push('Divergência de NF: SGQ '+sgq.nota_fiscal+' · Omie '+fiscal.numeroNota)
  setWarnings(issues)
  setConfirmed(false);setSession(null);resetItem()
  await loadCounts(code)
 }
 async function searchProcess(){
  if(!location){setError('Selecione a rua ou armário antes de consultar o processo.');return}
  const raw=query.replace(/\s+/g,'').toUpperCase()
  const code=raw.startsWith('FST')?raw:'FST'+raw
  if(!validProcess.test(code)){setError('Informe o processo FST completo (ex.: FST26125-A).');return}
  setError('');setMessage('');setLoading(true);clearProcess()
  try{await loadProcess(code)}
  catch(e){setError(explain(e))}
  finally{setLoading(false)}
 }
 async function selectOrder(value:string){
  if(!processCode||!value)return
  setLoading(true);setError('');setOrder(value)
  try{await loadProcess(processCode,Number(value))}
  catch(e){setError('Pedido não confirmado: '+explain(e))}
  finally{setLoading(false)}
 }

 async function confirmProcess(){
  if(!canWrite||busy||!location||!processCode||!omie)return
  if(!omie.cliente&&(!client||!client.trim())){setError('Informe e valide o cliente.');return}
  if(!client.trim()||client.length>180){setError('Confirme o cliente, com até 180 caracteres.');return}
  if(!nfNumber.trim()||nfNumber.length>30||!nfDate){setError('Informe NF de entrada e data fiscal para validar o processo.');return}
  if(!products.length){setError('Não há itens confirmados no Omie para este processo. Escolha o pedido correto.');return}
  setBusy(true);setError('')
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sessão expirada.')
   const {data:existing,error:existingError}=await authClient.from('sgq_inventarios_cegos')
    .select('id,codigo,endereco,status,processo_codigo,nf_entrada,data_nf,cliente_nome')
    .eq('endereco',location).eq('processo_codigo',processCode).eq('status','aberto')
    .order('criado_em',{ascending:false}).limit(1).maybeSingle()
   if(existingError)throw existingError
   let target=existing as Session|null
   if(!target){
    const codigo='IC-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase()
    const {data,error:insertError}=await authClient.from('sgq_inventarios_cegos').insert({
     codigo,endereco:location,processo_codigo:processCode,nf_entrada:nfNumber.trim(),data_nf:nfDate,
     cliente_nome:client.trim(),nf_data_tipo:nfDateSource,dados_confirmados_em:new Date().toISOString(),
     criado_por:user.id,status:'aberto'
    }).select('id,codigo,endereco,status,processo_codigo,nf_entrada,data_nf,cliente_nome').single()
    if(insertError)throw insertError
    target=data as Session
   }
   if(!target)throw new Error('Não foi possível iniciar a contagem.')
   if((target.cliente_nome||'')!==client.trim()||(target.nf_entrada||'')!==nfNumber.trim()||
      (target.data_nf||'')!==nfDate)
    throw new Error('Este processo/local já possui uma contagem aberta com dados fiscais diferentes. Confira os dados registrados antes de continuar.')
   setSession(target);setConfirmed(true)
   setMessage('Dados confirmados. Selecione um produto para registrar a contagem.')
   await loadInspections(target.id)
   await loadCounts(processCode)
  }catch(e){setError('Não foi possível confirmar o processo: '+explain(e))}
  finally{setBusy(false)}
 }

 function chooseSku(code:string){
  setSelectedSku(code);setQuantity('');setPhoto(null);setError('');setMessage('')
 }
 async function syncPhoto(photoId:string){
  setSyncing(photoId)
  try{
   const reply=await authClient.functions.invoke('sgq-inventario-foto-direta',{body:{foto_id:photoId}})
   const body=reply.data as {ok?:boolean;error?:string;sku?:string}|null
   if(reply.error||!body?.ok)throw new Error(body?.error||explain(reply.error))
   setMessage('Foto associada ao SKU '+(body.sku||selectedSku)+' no Omie.')
   return true
  }catch(e){setError('Contagem salva, mas o envio da foto ao Omie não foi concluído: '+explain(e));return false}
  finally{setSyncing('')}
 }
 async function save(){
  if(!canWrite||busy||!confirmed||!session||!selected)return
  const qty=quantity.trim()
  if(!/^\d+(?:[.,]\d{1,3})?$/.test(qty)){setError('Informe uma quantidade válida (zero permitido).');return}
  if(!location||session.endereco!==location){setError('Confirme novamente a localização.');return}
  if(!photo){setError('Anexe uma foto do produto antes de salvar.');return}
  if(!['image/jpeg','image/png'].includes(photo.type)||photo.size<=0||photo.size>8*1024*1024){
   setError('A foto deve ser JPG ou PNG, com até 8 MB.');return
  }
  const current=counts.find(r=>r.inventario_id===session.id&&skuOf(r.codigo_omie)===selected.sku)
  const existingPhoto=current&&photoRows.find(p=>p.item_id===current.id)
  if(existingPhoto){setError('Esse item já possui uma foto. Abra o histórico para conferir o envio ao Omie.');return}
  if(current&&!window.confirm('Este SKU já foi contado nesta localização. Deseja corrigir a quantidade e incluir a foto?'))return
  setBusy(true);setError('');setMessage('')
  let saved=false
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sessão expirada.')
   const product=await apiPost<{found:boolean;descricao:string}>('/api/estoque/validar-sku',{codigo:selected.sku})
   if(product.error||!product.data?.found)throw new Error('O SKU não foi confirmado no cadastro Omie: '+(product.error?.message||selected.sku))
   const itemId=current?.id||crypto.randomUUID()
   const payload={
    codigo_omie:selected.sku,descricao_omie:selected.descricao,endereco:location,endereco_armario:location,
    processo_id:null,processo_codigo:processCode,cliente_nome:client.trim(),cliente_confirmado:true,
    verificacao_cadastro:{modo:'processo_omie',processo:processCode,sku:selected.sku,
     cliente_omie:omie?.cliente||null,nf_entrada:nfNumber,data_nf:nfDate,fonte:'omie_projeto_pedido',
     consultadoEm:new Date().toISOString(),pedido_id:order?Number(order):null},
    quantidade_contada:Number(qty.replace(',','.')),observacao:'',atualizado_em:new Date().toISOString()
   }
   if(current){
    const {error:writeError}=await authClient.from('sgq_inventario_cego_itens')
     .update(payload).eq('id',itemId)
    if(writeError)throw writeError
   }else{
    const {error:writeError}=await authClient.from('sgq_inventario_cego_itens')
     .insert({...payload,id:itemId,inventario_id:session.id,criado_por:user.id})
    if(writeError)throw writeError
   }
   saved=true
   const ext=photo.type==='image/png'?'png':'jpg'
   const path=[user.id,session.id,itemId,crypto.randomUUID()+'.'+ext].join('/')
   const {error:uploadError}=await authClient.storage.from('sgq-inventario-cego')
    .upload(path,photo,{upsert:false,contentType:photo.type})
   if(uploadError)throw new Error('Contagem salva, mas o upload da foto falhou: '+explain(uploadError))
   const {data:photoRecord,error:recordError}=await authClient.from('sgq_inventario_cego_imagens')
    .insert({item_id:itemId,codigo_omie:selected.sku,storage_path:path,criado_por:user.id})
    .select('id').single()
   if(recordError||!photoRecord)throw new Error('Contagem salva, mas falhou o registro de foto: '+explain(recordError))
   // Send now, not when the inventory is closed. Keep record if API fails.
   const delivered=await syncPhoto(photoRecord.id)
   await loadCounts(processCode)
   if(delivered)setMessage('Contagem salva e foto enviada ao Omie: '+selected.sku)
   if(window.confirm('Contagem registrada. Deseja ir para o próximo item deste processo?')){
    resetItem()
   }else{
    setPhoto(null)
   }
  }catch(e){setError((saved?'Contagem registrada parcialmente. ':'')+explain(e));await loadCounts(processCode)}
  finally{setBusy(false)}
 }

 async function sendInspection(){
  if(!inspection||!session||busy)return
  if(!['application/pdf','image/jpeg','image/png','application/msword',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(inspection.type)||
   inspection.size<=0||inspection.size>15*1024*1024){
   setError('Arquivo de inspeção inválido: PDF, DOC, DOCX, JPG ou PNG até 15 MB.');return
  }
  setBusy(true);setError('')
  try{
   const {data:{user}}=await authClient.auth.getUser()
   if(!user)throw new Error('Sessão expirada.')
   const ext=inspection.name.split('.').pop()?.toLowerCase()
   if(!ext||!['pdf','doc','docx','jpg','jpeg','png'].includes(ext))throw new Error('Formato não permitido.')
   const path=[user.id,session.id,processCode,crypto.randomUUID()+'.'+ext].join('/')
   const {error:upError}=await authClient.storage.from('sgq-inventario-documentos')
    .upload(path,inspection,{contentType:inspection.type,upsert:false})
   if(upError)throw upError
   const {error:insertError}=await authClient.from('sgq_inventario_cego_documentos').insert({
    inventario_id:session.id,processo_codigo:processCode,arquivo_nome:inspection.name.slice(0,200),
    mime_type:inspection.type,storage_path:path,criado_por:user.id
   })
   if(insertError)throw insertError
   setInspection(null);await loadInspections(session.id)
   setMessage('Inspeção vinculada ao processo '+processCode)
  }catch(e){setError('Não foi possível anexar a inspeção: '+explain(e))}
  finally{setBusy(false)}
 }
 async function openDocument(path:string){
  const {data,error:signError}=await authClient.storage.from('sgq-inventario-documentos').createSignedUrl(path,600)
  if(signError||!data?.signedUrl){setError('Erro ao abrir documento: '+explain(signError));return}
  window.open(data.signedUrl,'_blank','noopener,noreferrer')
 }

 return <div className="sgq-single-inventory">
  <header className="sgq-single-header">
   <div><h2>Inventário às cegas · Omie</h2><p>Localização → processo → NF e cliente → produto → quantidade e foto</p></div>
   <button type="button" className="secondary small" disabled={busy||loading} onClick={()=>{clearProcess();void loadLocations()}}><RefreshCw size={15}/> Nova consulta</button>
  </header>

  {error&&<div role="alert" className="sgq-single-alert">{error}</div>}
  {message&&<div role="status" className="sgq-single-success">{message}</div>}

  <section className="sgq-single-section">
   <div className="sgq-single-section-title"><MapPin size={19}/><h3>1. Localização</h3></div>
   <div className="sgq-single-row">
    <label>Rua ou armário
     <select value={location} onChange={e=>selectLocation(e.target.value)} disabled={!canWrite||busy}>
      <option value="">Selecione a localização</option>
      {locations.map(code=><option key={code} value={code}>{code}</option>)}
     </select>
    </label>
    {canWrite&&<button type="button" className="secondary" onClick={()=>setCreatingLocation(v=>!v)}><Plus size={15}/> Nova localização</button>}
   </div>
   {creatingLocation&&<div className="sgq-single-row">
    <label>Nova rua ou armário<input value={newLocation} placeholder="Ex.: RUA 08 ou ARM 07" maxLength={80} onChange={e=>setNewLocation(e.target.value)}/></label>
    <button type="button" className="primary" disabled={!newLocation.trim()||busy} onClick={()=>void addLocation()}>Cadastrar e selecionar</button>
   </div>}
  </section>

  <section className="sgq-single-section">
   <div className="sgq-single-section-title"><Search size={19}/><h3>2. Processo FST</h3></div>
   <div className="sgq-single-row">
    <label>Código do processo<input value={query} placeholder="Ex.: FST26125-A" onChange={e=>setQuery(e.target.value)} maxLength={40}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void searchProcess()}}}/></label>
    <button type="button" className="primary" disabled={!location||!query.trim()||loading||busy} onClick={()=>void searchProcess()}><Search size={15}/>{loading?'Consultando…':'Consultar Omie'}</button>
   </div>
   {omie&&processCode&&<>
    <div className="sgq-single-subheading"><strong>{processCode}</strong><span>Processo localizado no Omie</span></div>
    {!!omie.pedidos?.length&&<label>Pedido de venda vinculado
     <select value={order} onChange={e=>void selectOrder(e.target.value)} disabled={loading||confirmed}>
      <option value="">Selecione o pedido (quando houver mais de um)</option>
      {omie.pedidos.map(p=><option key={p.codigoPedido} value={String(p.codigoPedido)}>{p.numeroPedido||p.codigoPedido}</option>)}
     </select>
    </label>}
    <div className="sgq-single-grid">
     <label>Cliente <input value={client} maxLength={180} disabled={confirmed} onChange={e=>setClient(e.target.value)} placeholder="Cliente do processo"/></label>
     <label>NF de entrada <input value={nfNumber} maxLength={30} disabled={confirmed} onChange={e=>setNfNumber(e.target.value)} placeholder="Número da NF"/></label>
     <label>Data da NF <input type="date" value={nfDate} disabled={confirmed} onChange={e=>{setNfDate(e.target.value);setNfDateSource('informada')}}/></label>
    </div>
    <p className="sgq-single-metadata">NF: {nfe?.status==='matched'?'localizada no recebimento Omie':'não confirmada de forma única no Omie'}.
     Data: {nfDateSource==='registro_omie'?'registro no Omie':nfDateSource==='emissao_omie'?'emissão no Omie':'informada manualmente'}.
     {sgqProcess?.cliente?' Cliente cadastrado no SGQ: '+sgqProcess.cliente+'.':''}</p>
    {warnings.length>0&&<div className="sgq-single-warnings">{warnings.map((x,i)=><p key={i}><ShieldAlert size={15}/>{x}</p>)}</div>}
    {!confirmed?<button type="button" className="primary" onClick={()=>void confirmProcess()} disabled={!canWrite||busy||loading||!client.trim()||!nfNumber.trim()||!nfDate||!products.length}>
      <CheckCircle2 size={17}/>{busy?'Validando…':'Confirmar dados e iniciar contagem'}
     </button>:<div className="sgq-single-success"><CheckCircle2 size={16}/> Dados confirmados · {session?.codigo} · {location}</div>}
   </>}
  </section>

  {confirmed&&session&&<>
   <section className="sgq-single-section">
    <div className="sgq-single-section-title"><CheckCircle2 size={19}/><h3>3. Selecione o produto</h3></div>
    <div className="sgq-single-items">
     {products.map(p=>{
      const previous=countedBySku.get(p.sku)||[]
      const atLocation=previous.find(r=>r.endereco===location)
      return <button type="button" key={p.sku} className={selectedSku===p.sku?'sgq-single-item selected':'sgq-single-item'}
       onClick={()=>chooseSku(p.sku)} disabled={busy}>
       <strong>{p.sku}</strong><span>{p.descricao}</span>
       {atLocation?<small className="sgq-single-counted">Já contado nesta localização</small>:
        previous.length?<small className="sgq-single-counted">Já contado em outra localização</small>:
        <small>A contar</small>}
      </button>
     })}
    </div>
   </section>
   {selected&&<section className="sgq-single-section">
    <div className="sgq-single-section-title"><Camera size={19}/><h3>4. Quantidade e foto</h3></div>
    <div className="sgq-single-selected"><strong>{selected.sku}</strong><span>{selected.descricao}</span></div>
    {selectedCounts.length>0&&<p className="sgq-single-note">Produto já contado: {selectedCounts.map(c=>c.endereco+' em '+dateTime(c.criado_em)).join(' · ')}.</p>}
    <div className="sgq-single-row">
     <label>Quantidade física<input type="number" min="0" step="0.001" inputMode="decimal" value={quantity}
      onChange={e=>setQuantity(e.target.value)} placeholder="0" disabled={busy}/></label>
     <div className="sgq-single-photo-actions">
      <label className="sgq-single-photo-button"><Camera size={16}/> Tirar foto<input type="file" accept="image/jpeg,image/png" capture="environment"
       onChange={e=>setPhoto(e.target.files?.[0]||null)} disabled={busy}/></label>
      <label className="sgq-single-photo-button"><ImagePlus size={16}/> Escolher foto<input type="file" accept="image/jpeg,image/png"
       onChange={e=>setPhoto(e.target.files?.[0]||null)} disabled={busy}/></label>
     </div>
    </div>
    {photo&&<div className="sgq-single-preview">{preview&&<img src={preview} alt={'Foto do SKU '+selected.sku}/>}<span>{photo.name}</span><button type="button" className="secondary small" onClick={()=>setPhoto(null)}>Trocar</button></div>}
    {alreadyPhotographed&&<p className="sgq-single-note">Este produto já possui foto nesta contagem. Você pode selecioná-lo para consultar o registro; evite duplicar a foto.</p>}
    {photosForSelected.length>0&&<div className="sgq-single-status">
     {photosForSelected.map(p=><p key={p.id}>
      Foto: <strong>{p.status==='sincronizada'?'Enviada ao Omie':p.status==='erro'?'Falha no Omie':p.status==='enviando'?'Enviando':'Pendente'}</strong>
      {p.erro&&<small> — {p.erro}</small>}
      {(p.status==='erro'||p.status==='pendente')&&canWrite&&<button type="button" className="secondary small" disabled={!!syncing||busy}
       onClick={()=>void syncPhoto(p.id).then(()=>loadCounts(processCode))}>Reenviar foto</button>}
     </p>)}
    </div>}
    <button type="button" className="primary" disabled={!canWrite||busy||!!syncing||alreadyPhotographed||!quantity.trim()||!photo}
     onClick={()=>void save()}><Upload size={16}/>{busy?'Salvando…':'Salvar contagem e enviar foto ao Omie'}</button>
   </section>}
   <section className="sgq-single-section">
    <div className="sgq-single-section-title"><Upload size={19}/><h3>Inspeção do processo (opcional)</h3></div>
    <div className="sgq-single-row">
     <label>Documento ou laudo<input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={e=>setInspection(e.target.files?.[0]||null)}/></label>
     <button type="button" className="secondary" disabled={!inspection||busy} onClick={()=>void sendInspection()}>Anexar inspeção</button>
    </div>
    <div className="sgq-single-docs">{inspections.map(d=><button key={d.id} type="button" className="secondary small"
     onClick={()=>void openDocument(d.storage_path)}>{d.arquivo_nome}</button>)}</div>
   </section>
  </>}
 </div>
}
