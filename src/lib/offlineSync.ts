import {apiGet,apiPost,apiPut,supabase,authClient} from './supabase'
import {clearOfflineOperation,markOfflineConflict,offlineOperations,connectionFailure,type OfflineOperation} from './offline'

let running:Promise<{synced:number;pending:number;conflicts:number}>|null=null
const transient=(message:string)=>connectionFailure(message)||/indisponível|falha de comunicação|HTTP 50[0-9]|HTTP 429|502|503|504/i.test(message)
// A generic HTTP 409 is NOT proof of a duplicate: failed registration may
// return 409 for a missing object or a changed/closed inspection.
const isAlreadyUploaded=(message:string)=>/already exists|already uploaded|resource already exists|assetalreadyexists|duplicate|já existe/i.test(message)
const photoNotReady=(message:string)=>/fotos? ainda não estão disponíveis no armazenamento|foto não encontrada no armazenamento|foto ainda não (está|esta) disponível/i.test(message)
const original=(x:any)=>JSON.stringify(x??null)
export function offlineInspectionVersion(data:any){
  return original({inspection:data?.inspecao??null,items:data?.items??[]})
}
async function validateSnapshot(operation:OfflineOperation){
  if(!operation.expected)return true
  if(operation.kind==='inspection-update'){
    const id=operation.path.match(/\/inspecoes\/([^/]+)/)?.[1]
    if(!id)throw new Error('Registro sem identificador.')
    const res=await apiGet<any>('/api/inspecoes/'+encodeURIComponent(id)+'/detalhe')
    if(res.error)throw new Error(res.error.message)
    return offlineInspectionVersion(res.data)===operation.expected
  }
  if(operation.kind==='audit-answer'){
    const id=operation.path.match(/\/auditorias\/([^/]+)/)?.[1]
    if(!id)throw new Error('Auditoria sem identificador.')
    const res=await apiGet<any>('/api/auditorias/'+encodeURIComponent(id)+'/detalhe')
    if(res.error)throw new Error(res.error.message)
    const key=String(operation.body?.itemKey||'')
    const local=String(operation.body?.localRef||'')
    const found=(res.data?.answers||[]).find((a:any)=>a.item_key===key&&String(a.local_ref||'')===local)
    return original(found?{resultado:found.resultado,observacao:found.observacao}:null)===operation.expected
  }
  if(operation.kind==='inspection-checklist'){
    const id=operation.path.match(/\/inspecoes\/([^/]+)/)?.[1]
    const cid=operation.path.match(/\/checklist\/([^/]+)/)?.[1]
    if(!id||!cid)throw new Error('Checklist sem identificador.')
    const res=await apiGet<any>('/api/inspecoes/'+encodeURIComponent(id)+'/detalhe')
    if(res.error)throw new Error(res.error.message)
    const found=(res.data?.checklistResults||[]).find((x:any)=>x.checklist_id===cid)
    return original(found?{resultado:found.resultado,quantidade_nc:Number(found.quantidade_nc||0)}:null)===operation.expected
  }
  if(operation.kind==='inspection-note'){
    const id=operation.path.match(/\/inspecoes\/([^/]+)/)?.[1]
    if(!id)throw new Error('Inspeção sem identificador.')
    const res=await apiGet<any>('/api/inspecoes/'+encodeURIComponent(id)+'/detalhe')
    if(res.error)throw new Error(res.error.message)
    return original(String(res.data?.inspecao?.observacao_interna||''))===operation.expected
  }
  return true
}
async function send(operation:OfflineOperation){
  if(!await validateSnapshot(operation))throw new Error('CONFLITO: o registro foi alterado no servidor enquanto este dispositivo estava offline.')
  if(operation.kind==='inspection-create'){
    const payload={...operation.body.payload,itens:operation.body.payload.itens.map((x:any)=>({...x}))}
    for(const photo of operation.body.photos||[]){
      const file=photo.file as File
      if(!file)continue
      const folder=String(payload.itens[photo.index]?.sku||'temporario').replace(/[^a-zA-Z0-9._-]/g,'_')
      const path=folder+'/'+payload.requestId+'-'+photo.index+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
      const up=await supabase.storage.from('produto-fotos').upload(path,file,{contentType:file.type||'image/jpeg'})
      if(up.error&&!isAlreadyUploaded(up.error.message))throw new Error(up.error.message)
      if(payload.itens[photo.index])payload.itens[photo.index].fotoPrincipalPath=path
    }
    const r=await apiPost<any>('/api/inspecoes/criar',payload)
    if(r.error||!r.data?.id)throw new Error(r.error?.message||'O servidor não confirmou a inspeção.')
    return
  }
  if(operation.kind==='inspection-photo'){
    const photo=operation.body as {file:File;path:string;legend:string;inspectionId:string}
    if(!photo.file?.size || !photo.path?.startsWith(photo.inspectionId+'/gerais/'))
      throw new Error('CONFLITO: foto local inválida ou sem vínculo com a inspeção.')
    const up=await supabase.storage.from('inspecao-fotos').upload(photo.path,photo.file,{contentType:photo.file.type||'image/jpeg'})
    if(up.error&&!isAlreadyUploaded(up.error.message))throw new Error(up.error.message)
    const r=await apiPost<any>('/api/inspecoes/'+encodeURIComponent(photo.inspectionId)+'/fotos/registrar',{
      fotos:[{storagePath:photo.path,legenda:photo.legend}]
    })
    if(r.error||!r.data?.salvas)throw new Error(r.error?.message||'A foto não foi confirmada pelo servidor.')
    return
  }
  if(operation.kind==='inventory-photo'){
    const photo=operation.body as {file:File;path:string;itemId:string;sessionId:string;sku:string}
    const expected=[operation.userId,photo.sessionId,photo.itemId].join('/')+'/'
    if(!photo.file?.size || !['image/jpeg','image/png'].includes(photo.file.type) ||
      photo.file.size>8*1024*1024 || !photo.path?.startsWith(expected))
      throw new Error('CONFLITO: fotografia de inventário sem arquivo ou vínculo válido.')
    const up=await supabase.storage.from('sgq-inventario-cego')
      .upload(photo.path,photo.file,{contentType:photo.file.type,upsert:false})
    if(up.error&&!isAlreadyUploaded(up.error.message))throw new Error(up.error.message)
    const r=await apiPost<{id:string,status:string}>(
      '/api/inventario/cego/itens/'+encodeURIComponent(photo.itemId)+'/foto/registrar',
      {storagePath:photo.path})
    if(r.error||!r.data?.id)throw new Error(r.error?.message||'Foto de inventário ainda não vinculada à contagem.')
    // Once evidence is safely attached to SGQ, attempt the Omie catalogue
    // publication once. Its Edge Function owns idempotency and logs errors.
    // A failure in external Omie must NOT leave the immutable SGQ photo stuck
    // in the offline queue: status 'erro' remains visible for manual retry.
    try {
      await authClient.functions.invoke('sgq-inventario-foto-direta',{
        body:{foto_id:r.data.id}
      })
    } catch { /* Preserve the registered photo and let the UI display retry. */ }
    return
  }
  const body=operation.kind==='audit-answer'?{
    resultado:operation.body.resultado,localRef:operation.body.localRef,
    observacao:operation.body.observacao,confianca:operation.body.confianca,
    progressoTotalEsperado:operation.body.progressoTotalEsperado
  }:operation.body
  const res=await apiPut(operation.path,body)
  if(res.error)throw new Error(res.error.message)
}
export async function replayOfflineOperations(userId:string,afterEach?:()=>void){
  if(running)return running
  running=(async()=>{
    let synced=0
    if(!userId)return {synced:0,pending:0,conflicts:0}
    const queued=await offlineOperations(userId)
    for(const operation of queued){
      if(operation.state==='conflict')continue
      if(!navigator.onLine)break
      try{
        await send(operation)
        await clearOfflineOperation(operation.id)
        synced++
        afterEach?.()
      }catch(error:any){
        const message=String(error?.message||'Falha ao sincronizar.')
        // HEAD/Storage can briefly lag an upload. Keep the same file+path
        // queued for retry instead of marking its immutable registration as
        // a permanent conflict. Permission, ownership and closed-session
        // errors still become explicit conflicts requiring review.
        if(transient(message)||(
          ['inspection-photo','inventory-photo'].includes(operation.kind) && photoNotReady(message)
        ))break
        await markOfflineConflict(operation,message)
      }
    }
    const remaining=await offlineOperations(userId)
    return {synced,pending:remaining.filter(x=>x.state!=='conflict').length,conflicts:remaining.filter(x=>x.state==='conflict').length}
  })()
  try{return await running}finally{running=null}
}
