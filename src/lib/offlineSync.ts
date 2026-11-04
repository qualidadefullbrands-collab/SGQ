import {apiGet,apiPost,apiPut,supabase} from './supabase'
import {clearOfflineOperation,markOfflineConflict,offlineOperations,connectionFailure,type OfflineOperation} from './offline'

let running:Promise<{synced:number;pending:number;conflicts:number}>|null=null
const transient=(message:string)=>connectionFailure(message)||/indisponível|falha de comunicação|HTTP 50[0-9]|502|503|504/i.test(message)
const isAlreadyUploaded=(message:string)=>/already exists|already uploaded|resource already exists|duplicate|409|já existe/i.test(message)
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
    const up=await supabase.storage.from('inspecao-fotos').upload(photo.path,photo.file,{contentType:photo.file?.type||'image/jpeg'})
    if(up.error&&!isAlreadyUploaded(up.error.message))throw new Error(up.error.message)
    const r=await apiPost<any>('/api/inspecoes/'+encodeURIComponent(photo.inspectionId)+'/fotos/registrar',{
      fotos:[{storagePath:photo.path,legenda:photo.legend}]
    })
    if(r.error||!r.data?.salvas)throw new Error(r.error?.message||'A foto não foi confirmada pelo servidor.')
    return
  }
  const body=operation.kind==='audit-answer'?{
    resultado:operation.body.resultado,localRef:operation.body.localRef,
    observacao:operation.body.observacao,confianca:operation.body.confianca,
    progressoTotalEsperado:operation.body.progressoTotalEsperado
  }:operation.body
  const res=operation.kind==='inspection-create'?
    await apiPost(operation.path,body):await apiPut(operation.path,body)
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
        if(transient(message))break
        await markOfflineConflict(operation,message)
      }
    }
    const remaining=await offlineOperations(userId)
    return {synced,pending:remaining.filter(x=>x.state!=='conflict').length,conflicts:remaining.filter(x=>x.state==='conflict').length}
  })()
  try{return await running}finally{running=null}
}
