import {useEffect,useMemo,useRef,useState} from 'react'
import {ArrowLeft,Camera,CheckCircle2,ImagePlus,RefreshCw,ShieldCheck,Trash2,Upload,X} from 'lucide-react'
import {apiGet,apiPost,supabase} from '../lib/supabase'
import {readOfflineDraft,saveOfflineDraft,clearOfflineDraft,enqueueOfflineOperation,connectionFailure} from '../lib/offline'
import './MobileFotos.css'

type Process={id:string;codigo:string;cliente:string|null}
type Inspection={id:string;numero:string;status:string;grupos_inspecao?:{processo_id:string;nome:string;subprocesso_codigo?:string|null;nota_fiscal?:string|null}|null}
type Photo={id:string;legenda:string;storage_path:string;signed_url?:string|null}
type PhotoContext={inspecao:{id:string;status:string};photos:Photo[]}
type Pending={id:string;file:File;preview:string;legenda:string;error?:string}

function fst(v:string){const raw=String(v||'').trim();return !raw?'Sem FST':/^[0-9]+$/.test(raw)?'FST'+raw:raw}
async function compressed(file:File):Promise<File>{
 if(file.size<1500000||!file.type.startsWith('image/')||file.type==='image/gif')return file
 try{
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})
  try{
   const ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height))
   const canvas=document.createElement('canvas')
   canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio)
   const ctx=canvas.getContext('2d')
   if(!ctx)return file
   ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
   const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/jpeg',0.82))
   return blob&&blob.size<file.size?new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}):file
  }finally{bitmap.close()}
 }catch{return file}
}
export default function MobileFotos({processes,inspections,canWrite,userId,onRefresh,onExit}:{
 processes:Process[];inspections:Inspection[];canWrite:boolean;userId:string;onRefresh:()=>Promise<void>;onExit:()=>void
}){
 const [processId,setProcessId]=useState<string|null>(null)
 const [inspectionId,setInspectionId]=useState<string|null>(null)
 const [context,setContext]=useState<PhotoContext|null>(null)
 const [pending,setPending]=useState<Pending[]>([])
 const [loading,setLoading]=useState(false)
 const [busy,setBusy]=useState(false)
 const [refreshing,setRefreshing]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const busyRef=useRef(false),sequence=useRef(0),pendingRef=useRef<Pending[]>([])
 const [photoDraftLoaded,setPhotoDraftLoaded]=useState(false)
 useEffect(()=>{pendingRef.current=pending},[pending])
 useEffect(()=>()=>{sequence.current++;pendingRef.current.forEach(p=>URL.revokeObjectURL(p.preview))},[])
 useEffect(()=>{
  if(!userId||!inspectionId){setPhotoDraftLoaded(false);return}
  let active=true
  setPhotoDraftLoaded(false)
  void readOfflineDraft<Array<{id:string;file:File;legenda:string}>>(userId,'mobile:photos:'+inspectionId)
    .then(rows=>{
      if(!active)return
      if(rows?.length)setPending(rows.map(x=>({...x,preview:URL.createObjectURL(x.file)})))
    }).finally(()=>{if(active)setPhotoDraftLoaded(true)})
    .catch(e=>{if(active)setError('Falha ao recuperar fotos locais: '+String(e?.message||''))})
  return()=>{active=false}
 },[userId,inspectionId])
 useEffect(()=>{
  if(!userId||!inspectionId||!photoDraftLoaded)return
  const timer=window.setTimeout(()=>{
    const work=pending.length?saveOfflineDraft(userId,'mobile:photos:'+inspectionId,
      pending.map(p=>({id:p.id,file:p.file,legenda:p.legenda}))):clearOfflineDraft(userId,'mobile:photos:'+inspectionId)
    void work.catch(e=>setError('Armazenamento offline indisponível: '+String(e?.message||'')))
  },350)
  return()=>window.clearTimeout(timer)
 },[userId,inspectionId,pending,photoDraftLoaded])
 async function queuePhotoOffline(photo:Pending,selectedInspectionId:string){
  if(!userId)throw new Error('Usuário não identificado para fotos offline.')
  const file=await compressed(photo.file)
  const path=selectedInspectionId+'/gerais/'+photo.id+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
  await enqueueOfflineOperation({
    id:userId+':inspection-photo:'+selectedInspectionId+':'+photo.id,userId,
    kind:'inspection-photo',path:'/api/inspecoes/'+selectedInspectionId+'/fotos/registrar',
    body:{inspectionId:selectedInspectionId,path,file,legend:photo.legenda.trim()},
    createdAt:Date.now()
  })
 }

 const {active,linked}=useMemo(()=>{
  const valid=new Set(processes.map(p=>p.id))
  const map=new Map<string,Inspection[]>()
  for(const i of inspections){
   const id=i.grupos_inspecao?.processo_id
   if(i.status==='cancelada'||!id||!valid.has(id))continue
   const list=map.get(id)||[];list.push(i);map.set(id,list)
  }
  return {active:processes.filter(p=>map.has(p.id)),linked:map}
 },[processes,inspections])
 const selected=active.find(p=>p.id===processId)
 const childInspections=linked.get(processId||'')||[]
 function clearDraft(){
  if(busyRef.current)return false
  if(pending.length&&!window.confirm('Descartar fotos ainda não enviadas?'))return false
  pending.forEach(p=>URL.revokeObjectURL(p.preview));setPending([])
  if(userId&&inspectionId)void clearOfflineDraft(userId,'mobile:photos:'+inspectionId).catch(()=>undefined)
  return true
 }
 function back(){
  if(!clearDraft())return
  sequence.current++;setError('');setMessage('')
  if(inspectionId){setInspectionId(null);setContext(null)}
  else if(processId)setProcessId(null)
  else onExit()
 }
 async function refreshList(){
  if(busyRef.current)return
  setRefreshing(true);setError('')
  try{await onRefresh()}catch{setError('Não foi possível atualizar os processos.')}
  finally{setRefreshing(false)}
 }
 async function load(id:string){
  const request=++sequence.current
  setLoading(true);setError('')
  try{
   const [details,urls]=await Promise.all([
    apiGet<PhotoContext>('/api/mobile/fotos/inspecoes/'+encodeURIComponent(id)),
    apiGet<{photoUrls:Record<string,string|null>}>('/api/inspecoes/'+encodeURIComponent(id)+'/fotos/links'),
   ])
   if(request!==sequence.current)return
   if(details.error||!details.data){
     const cached=await readOfflineDraft<PhotoContext>(userId,'mobile:context:'+id).catch(()=>null)
     if(!cached){setContext(null);setError(details.error?.message||'Falha ao carregar fotos.');return}
     if(request===sequence.current)setContext(cached)
     return
   }
   void saveOfflineDraft(userId,'mobile:context:'+id,details.data).catch(()=>undefined)
   if(details.data.inspecao.status==='cancelada'){setContext(null);setError('Inspeção cancelada não permite fotos.');void onRefresh();return}
   setContext({...details.data,photos:(details.data.photos||[]).map(p=>({...p,signed_url:urls.data?.photoUrls?.[p.storage_path]||null}))})
  }catch{if(request===sequence.current)setError('Falha de conexão ao carregar fotos.')}
  finally{if(request===sequence.current)setLoading(false)}
 }
 function selectProcess(id:string){
  if(!clearDraft())return
  setProcessId(id);setInspectionId(null);setContext(null);setError('');setMessage('')
  // Always show the inspection cards so the started/unstarted color is visible.
 }
 function selectInspection(id:string){
  if(!clearDraft())return
  setInspectionId(id);setContext(null);setMessage('');void load(id)
 }
 function addFiles(files:FileList|null){
  if(!files?.length)return
  const arr=Array.from(files)
  if(arr.some(f=>!f.type.startsWith('image/'))){setError('Selecione apenas imagens.');return}
  if(arr.some(f=>f.size>25*1024*1024)){setError('Cada imagem deve ter no máximo 25 MB.');return}
  if(pending.length+arr.length>60){setError('Selecione até 60 fotos por lote.');return}
  setPending(current=>[...current,...arr.map(file=>({id:crypto.randomUUID(),file,preview:URL.createObjectURL(file),legenda:''}))])
  setError('');setMessage('')
 }
 function remove(id:string){const p=pending.find(x=>x.id===id);if(p)URL.revokeObjectURL(p.preview);setPending(current=>current.filter(x=>x.id!==id))}
 async function save(){
  if(!canWrite||!inspectionId||!context||busyRef.current||!pending.length)return
  if(!navigator.onLine){
    busyRef.current=true;setBusy(true);setError('')
    try{
      for(const photo of pending)await queuePhotoOffline(photo,inspectionId)
      pending.forEach(p=>URL.revokeObjectURL(p.preview))
      setPending([])
      await clearOfflineDraft(userId,'mobile:photos:'+inspectionId)
      setMessage('Fotos salvas neste dispositivo. Serão sincronizadas automaticamente.')
    }catch(e:any){setError('Não foi possível salvar fotos offline: '+String(e?.message||''))}
    finally{busyRef.current=false;setBusy(false)}
    return
  }
  busyRef.current=true;setBusy(true);setError('');setMessage('')
  const batch=[...pending]
  const outcomes:Array<{id:string;ok:boolean;offline:boolean;error?:string}>=new Array(batch.length)
  let index=0
  const uploaded:Array<{id:string;path:string;legenda:string;index:number}|undefined>=new Array(batch.length)
  const worker=async()=>{
   while(index<batch.length){
    const position=index++,photo=batch[position]
    try{
     const file=await compressed(photo.file)
     const path=inspectionId+'/gerais/'+photo.id+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
     const up=await supabase.storage.from('inspecao-fotos').upload(path,file,{contentType:file.type||'image/jpeg'})
     if(up.error&&!/already exists|duplicate|resource already exists|409/i.test(up.error.message))
       throw new Error(up.error.message)
     uploaded[position]={id:photo.id,index:position,path,legenda:photo.legenda.trim()}
    }catch(e:any){
     const reason=String(e?.message||'Erro ao salvar foto')
     if(!navigator.onLine||connectionFailure(reason)){
      try{await queuePhotoOffline(photo,inspectionId);outcomes[position]={id:photo.id,ok:true,offline:true};continue}
      catch(queueError:any){outcomes[position]={id:photo.id,ok:false,offline:false,error:String(queueError?.message||reason)};continue}
     }
     outcomes[position]={id:photo.id,ok:false,offline:false,error:reason}
    }
   }
  }
  await Promise.all(Array.from({length:Math.min(4,batch.length)},()=>worker()))
  // Register all uploaded photos in ONE request. Captions stay empty until edited
  // on desktop; no mandatory caption or per-image metadata dialog.
  const ready=uploaded.filter((x):x is NonNullable<typeof x>=>!!x)
  if(ready.length){
   const saved=await apiPost<{salvas:number}>('/api/inspecoes/'+encodeURIComponent(inspectionId)+'/fotos/registrar',{
    fotos:ready.map(p=>({storagePath:p.path,legenda:p.legenda}))
   })
   if(!saved.error&&saved.data?.salvas===ready.length){
    for(const p of ready)outcomes[p.index]={id:p.id,ok:true,offline:false}
   }else{
    const reason=saved.error?.message||'Falha ao registrar lote de fotos.'
    for(const p of ready){
     const photo=batch[p.index]
     if(!navigator.onLine||connectionFailure(reason)){
      try{await queuePhotoOffline(photo,inspectionId);outcomes[p.index]={id:p.id,ok:true,offline:true};continue}
      catch{}
     }
     outcomes[p.index]={id:p.id,ok:false,offline:false,error:reason}
    }
   }
  }
  const successful=new Set(outcomes.filter(x=>x?.ok).map(x=>x.id))
  const failures=outcomes.filter(x=>!x?.ok).length
  const queued=outcomes.filter(x=>x?.ok&&x.offline).length
  batch.filter(p=>successful.has(p.id)).forEach(p=>URL.revokeObjectURL(p.preview))
  setPending(list=>list.filter(p=>!successful.has(p.id)).map(p=>{
   const outcome=outcomes.find(x=>x?.id===p.id)
   return outcome?.error?{...p,error:outcome.error}:p
  }))
  busyRef.current=false;setBusy(false)
  if(successful.size)setMessage(successful.size+' foto(s) '+(queued?'salva(s); '+queued+' aguardando sincronização.':'enviada(s).')+' Legendas no computador.')
  if(failures)setError(failures+' foto(s) não foram salvas. Tente novamente.')
  if(successful.size&&successful.size>queued)void load(inspectionId)
 }
 async function removeStored(photo:Photo){
  if(!canWrite||!inspectionId||busyRef.current)return
  if(!navigator.onLine)return setError('Conecte-se para remover fotos já salvas.')
  if(!window.confirm('Remover esta foto do subprocesso? O original ficará preservado em auditoria.'))return
  busyRef.current=true;setBusy(true);setError('')
  try{
   const response=await apiPost<any>('/api/inspecoes/'+encodeURIComponent(inspectionId)+
     '/fotos/'+encodeURIComponent(photo.id)+'/remover',{})
   if(response.error){setError(response.error.message);return}
   await load(inspectionId)
   setMessage('Foto removida do subprocesso. Histórico preservado.')
  }catch(e:any){setError(String(e?.message||'Não foi possível remover.'))}
  finally{busyRef.current=false;setBusy(false)}
 }
 async function replaceStored(photo:Photo,file:File|null){
  if(!file||!canWrite||!inspectionId||busyRef.current)return
  if(!navigator.onLine)return setError('Conecte-se para substituir fotos já salvas.')
  if(!file.type.startsWith('image/'))return setError('Selecione uma imagem.')
  if(file.size>25*1024*1024)return setError('Imagem acima de 25 MB.')
  if(context?.inspecao.status==='concluida'&&!window.confirm('Trocar foto de inspeção concluída? A original será preservada na auditoria.'))return
  busyRef.current=true;setBusy(true);setError('')
  const id=inspectionId
  const path=id+'/gerais/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
  try{
   const data=await compressed(file)
   const uploaded=await supabase.storage.from('inspecao-fotos').upload(path,data,{contentType:data.type||'image/jpeg'})
   if(uploaded.error){setError(uploaded.error.message);return}
   const response=await apiPost<any>('/api/inspecoes/'+encodeURIComponent(id)+
     '/fotos/'+encodeURIComponent(photo.id)+'/substituir',
     {storagePath:path,legenda:photo.legenda??''})
   if(response.error){void supabase.storage.from('inspecao-fotos').remove([path]);setError(response.error.message);return}
   await load(id)
   setMessage('Foto substituída, original preservada no histórico.')
  }catch(e:any){setError(String(e?.message||'Não foi possível substituir.'))}
  finally{busyRef.current=false;setBusy(false)}
 }
 return <main className="sgq-mobile-photo">
  <header className="sgq-mobile-photo-header"><div className="sgq-mobile-logo"><ShieldCheck size={24}/><div><strong>SGQ</strong><small>Modo Fotos</small></div></div><button type="button" onClick={()=>{if(clearDraft())onExit()}} disabled={busy}>SGQ completo</button></header>
  <div className="sgq-mobile-body">
   <div className="sgq-mobile-title">
    {(processId||inspectionId)&&<button className="sgq-mobile-back" type="button" disabled={busy} onClick={back} aria-label="Voltar"><ArrowLeft size={21}/></button>}
    <div><h1>{inspectionId?'Fotos da inspeção':processId?'Inspeções do processo':'Processos com inspeções'}</h1></div>
    {!processId&&<button className="sgq-mobile-refresh" type="button" disabled={refreshing} onClick={()=>void refreshList()} aria-label="Atualizar processos"><RefreshCw size={19}/></button>}
   </div>
   {error&&<div role="alert" className="sgq-mobile-notice error">{error}</div>}
   {message&&<div role="status" className="sgq-mobile-notice success"><CheckCircle2 size={18}/>{message}</div>}
   {!processId&&<><p className="sgq-mobile-description">Escolha um processo para registrar as fotos.</p>
    {active.map(p=><button type="button" className="sgq-mobile-process" key={p.id} onClick={()=>selectProcess(p.id)}>
     <span className="sgq-mobile-process-header"><strong>{fst(p.codigo)}</strong><small>{(linked.get(p.id)||[]).length} inspeção(ões)</small></span>
     <span>{p.cliente||'Cliente não informado'}</span><b><Camera size={17}/> Adicionar fotos</b>
    </button>)}
    {!active.length&&<div className="sgq-mobile-empty"><Camera size={27}/><strong>Nenhuma inspeção disponível</strong><span>Crie uma inspeção para registrar fotos.</span></div>}
   </>}
   {processId&&!inspectionId&&<><p className="sgq-mobile-description">{fst(selected?.codigo||'')} · {selected?.cliente||'Cliente não informado'}</p>
    {childInspections.map(i=><button type="button" className={'sgq-mobile-process '+(i.status==='em_andamento'?'sgq-photo-started':'sgq-photo-not-started')} key={i.id} onClick={()=>selectInspection(i.id)}>
     <strong>{i.grupos_inspecao?.subprocesso_codigo?'Subprocesso '+i.grupos_inspecao.subprocesso_codigo+' · ':''}{i.grupos_inspecao?.nome||'Inspeção'}</strong>
     <span>{i.numero||'Inspeção'} · {i.status==='concluida'?'Concluída':i.status==='em_andamento'?'Iniciada':'Não iniciada'} · NF {i.grupos_inspecao?.nota_fiscal||'não informada'}</span>
     <b><Camera size={17}/> Ver fotos</b>
    </button>)}
   </>}
   {inspectionId&&<><p className="sgq-mobile-description">{fst(selected?.codigo||'')} · {selected?.cliente||'Cliente não informado'}</p>
    {loading&&!context&&<div className="sgq-mobile-empty">Carregando fotos…</div>}
    {context&&<section className="sgq-mobile-panel">
     <div className="sgq-mobile-section-head"><strong>Adicionar evidências</strong><small>{context.photos.length} salva(s)</small></div>
     {canWrite?<div className="sgq-mobile-capture">
      <label><Camera size={23}/><strong>Tirar foto</strong><input type="file" accept="image/*" capture="environment" onChange={e=>{addFiles(e.target.files);e.target.value=''}}/></label>
      <label><ImagePlus size={23}/><strong>Selecionar várias</strong><input type="file" accept="image/*" multiple onChange={e=>{addFiles(e.target.files);e.target.value=''}}/></label>
     </div>:<div className="sgq-mobile-notice">Seu perfil permite apenas visualizar.</div>}
     {!!pending.length&&<div className="sgq-mobile-batch">
      <div className="sgq-mobile-batch-title"><strong>{pending.length} foto(s) selecionada(s)</strong><small>Legendas no computador</small></div>
      <div className="sgq-mobile-batch-grid">{pending.map((p,index)=><div className="sgq-mobile-batch-photo" key={p.id}>
       <img src={p.preview} alt={'Foto pendente '+(index+1)}/>
       <button type="button" aria-label={'Remover foto '+(index+1)} disabled={busy} onClick={()=>remove(p.id)}><X size={16}/></button>
       {p.error&&<small role="alert" className="sgq-mobile-error">{p.error}</small>}
      </div>)}</div>
      <button className="sgq-mobile-save" type="button" onClick={()=>void save()} disabled={busy||!canWrite}><Upload size={19}/>{busy?'Enviando fotos…':'Enviar '+pending.length+' foto(s) sem legenda'}</button>
     </div>}
     <div className="sgq-mobile-saved"><div className="sgq-mobile-section-head"><strong>Fotos salvas</strong><button type="button" disabled={busy||loading} onClick={()=>void load(inspectionId)}><RefreshCw size={16}/> Atualizar</button></div>
      {context.photos.length?<div className="sgq-mobile-saved-grid">{context.photos.map(p=><figure key={p.id}>
       {p.signed_url?<img src={p.signed_url} alt={p.legenda}/>:<div className="sgq-mobile-placeholder"><Camera size={20}/></div>}
       {p.legenda&&<figcaption>{p.legenda}</figcaption>}
       {canWrite&&<div className="sgq-mobile-photo-actions">
        <button type="button" disabled={busy} onClick={()=>document.getElementById('mobile-replace-'+p.id)?.click()}>
         <RefreshCw size={15}/> Trocar
        </button>
        <input id={'mobile-replace-'+p.id} type="file" accept="image/*" hidden
         onChange={e=>{const file=e.target.files?.[0]??null;e.target.value='';void replaceStored(p,file)}}/>
        <button type="button" disabled={busy} onClick={()=>void removeStored(p)}>
         <Trash2 size={15}/> Remover
        </button>
       </div>}
      </figure>)}</div>:<p>Nenhuma foto enviada ainda.</p>}
     </div>
    </section>}
    <p className="sgq-mobile-description">As evidências ficam na inspeção original. A conclusão será feita no computador.</p>
   </>}
  </div>
 </main>
}
