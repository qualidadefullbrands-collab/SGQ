// Local-only persistence for authenticated SGQ work. No secret or auth token is saved here.
// IndexedDB retains File/Blob values for inspection drafts and evidence, unlike localStorage.
const DATABASE = 'sgq-offline-v1'
const VERSION = 1
const DRAFTS = 'drafts'
const OPERATIONS = 'operations'
export type OfflineOperation = {
  id:string
  userId:string
  kind:'inspection-create'|'inspection-update'|'audit-answer'|'inspection-checklist'|'inspection-note'|'inspection-photo'
  path:string
  body:any
  createdAt:number
  state?:'pending'|'conflict'
  error?:string
  expected?:string|null
}
let openPromise:Promise<IDBDatabase>|null=null

function database():Promise<IDBDatabase>{
  if(!('indexedDB' in window))return Promise.reject(new Error('Este navegador não permite salvamento offline.'))
  if(openPromise)return openPromise
  openPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DATABASE,VERSION)
    req.onupgradeneeded=()=>{
      const db=req.result
      if(!db.objectStoreNames.contains(DRAFTS))db.createObjectStore(DRAFTS,{keyPath:'id'})
      if(!db.objectStoreNames.contains(OPERATIONS))db.createObjectStore(OPERATIONS,{keyPath:'id'})
    }
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error??new Error('Não foi possível abrir o armazenamento local.'))
    req.onblocked=()=>reject(new Error('Feche outra aba do SGQ para atualizar o armazenamento local.'))
  }).catch(error=>{openPromise=null;throw error})
  return openPromise
}
function requestValue<T>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??new Error('Falha ao salvar dados locais.'))
  })
}
async function storeWrite(storeName:string,value:any){
  const db=await database()
  const tx=db.transaction(storeName,'readwrite')
  const done=new Promise<void>((resolve,reject)=>{
    tx.oncomplete=()=>resolve()
    tx.onerror=()=>reject(tx.error??new Error('Falha de armazenamento offline.'))
    tx.onabort=()=>reject(tx.error??new Error('Salvamento offline interrompido.'))
  })
  tx.objectStore(storeName).put(value)
  await done
}
async function storeDelete(storeName:string,id:string){
  const db=await database()
  const tx=db.transaction(storeName,'readwrite')
  const done=new Promise<void>((resolve,reject)=>{
    tx.oncomplete=()=>resolve()
    tx.onerror=()=>reject(tx.error??new Error('Falha ao remover registro local.'))
    tx.onabort=()=>reject(tx.error??new Error('Falha ao remover registro local.'))
  })
  tx.objectStore(storeName).delete(id)
  await done
}
export async function saveOfflineDraft(userId:string,scope:string,payload:any){
  if(!userId)return
  await storeWrite(DRAFTS,{id:userId+':'+scope,userId,scope,payload,updatedAt:Date.now()})
}
export async function readOfflineDraft<T=any>(userId:string,scope:string):Promise<T|null>{
  if(!userId)return null
  const db=await database()
  const row:any=await requestValue(db.transaction(DRAFTS,'readonly').objectStore(DRAFTS).get(userId+':'+scope))
  return row?.userId===userId?row.payload as T:null
}
export async function clearOfflineDraft(userId:string,scope:string){
  if(userId)await storeDelete(DRAFTS,userId+':'+scope)
}
export async function enqueueOfflineOperation(item:OfflineOperation){
  if(!item.userId||!item.id.startsWith(item.userId+':'))throw new Error('Operação offline sem usuário válido.')
  await storeWrite(OPERATIONS,{...item,state:item.state||'pending'})
}
export async function offlineOperations(userId:string):Promise<OfflineOperation[]>{
  if(!userId)return []
  const db=await database()
  const all=await requestValue(db.transaction(OPERATIONS,'readonly').objectStore(OPERATIONS).getAll()) as OfflineOperation[]
  return all.filter(item=>item.userId===userId).sort((a,b)=>a.createdAt-b.createdAt)
}
export async function clearOfflineOperation(id:string){
  await storeDelete(OPERATIONS,id)
}
export async function markOfflineConflict(item:OfflineOperation,message:string){
  await enqueueOfflineOperation({...item,state:'conflict',error:message})
}
export function connectionFailure(message:string){
  return /failed to fetch|fetch failed|network|networkerror|load failed|timeout|offline|aborted|não foi possível.*conexão|falha de comunicação/i.test(message)
}
