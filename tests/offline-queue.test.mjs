import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const sync=readFileSync(new URL('../src/lib/offlineSync.ts',import.meta.url),'utf8')
const storage=readFileSync(new URL('../src/lib/offline.ts',import.meta.url),'utf8')

function runtime(initial,options={}){
 let queue=[...initial],sent=0,conflicts=0,calls=0,online=true
 let uploaded=[],omieCalls=0,uploadError=options.uploadError||'',registerError=options.registerError||''
 const apiGet=async()=>({data:{inspecao:{status:'aberta'},items:[]},error:null})
 const apiPost=async(path)=> {
  sent++
  if(path.includes('/foto/registrar')&&registerError)
   return {data:null,error:{message:registerError}}
  return {data:{id:'photo-registered',status:'pendente',salvas:1},error:null}
 }
 const apiPut=async()=>{calls++;return {data:{ok:true},error:null}}
 const supabase={storage:{from:bucket=>({
  upload:async(path,file)=>{uploaded.push({bucket,path,file});return uploadError?{error:{message:uploadError}}:{error:null}}
 })}}
 const authClient={functions:{invoke:async()=>{omieCalls++;return {data:{ok:true},error:null}}}}
 const offlineOperations=async user=>queue.filter(x=>x.userId===user)
 const clearOfflineOperation=async id=>{queue=queue.filter(x=>x.id!==id)}
 const markOfflineConflict=async(row,message)=>{
  conflicts++
  queue=queue.map(x=>x.id===row.id?{...x,state:'conflict',error:message}:x)
 }
 const connectionFailure=message=>/failed to fetch|network/i.test(message)
 const transpiled=ts.transpileModule(sync.replace(/^import .*\n/gm,''),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
 }).outputText.replace(/^export /gm,'')
 const navigator={get onLine(){return online}}
 const {replayOfflineOperations}=new Function(
  'apiGet','apiPost','apiPut','supabase','authClient','clearOfflineOperation',
  'markOfflineConflict','offlineOperations','connectionFailure','navigator',
  transpiled+'\nreturn {replayOfflineOperations}'
 )(apiGet,apiPost,apiPut,supabase,authClient,clearOfflineOperation,
   markOfflineConflict,offlineOperations,connectionFailure,navigator)
 return {
  replayOfflineOperations,
  setOnline:value=>{online=value},
  setUploadError:value=>{uploadError=value},
  setRegisterError:value=>{registerError=value},
  read:()=>({queue,sent,conflicts,calls,uploaded,omieCalls})
 }
}
const created={
 id:'u:inspection-create:request-1',userId:'u',kind:'inspection-create',
 path:'/api/inspecoes/criar',createdAt:1,
 body:{payload:{requestId:'request-1',codigo:'26169-A',itens:[]},photos:[]}
}
test('offline creation never sends network request and is synchronized on reconnect',async()=>{
 const env=runtime([created])
 env.setOnline(false)
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:0,pending:1,conflicts:0})
 assert.equal(env.read().sent,0)
 env.setOnline(true)
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:1,pending:0,conflicts:0})
 assert.equal(env.read().sent,1)
 assert.equal(env.read().queue.length,0)
})
test('conflicting edits remain saved for review instead of overwriting server',async()=>{
 const edit={
  id:'u:inspection-update:abc',userId:'u',kind:'inspection-update',
  path:'/api/inspecoes/abc/dados',createdAt:1,
  expected:'different-original-version',body:{cliente:'new'}
 }
 const env=runtime([edit])
 const result=await env.replayOfflineOperations('u')
 assert.deepEqual(result,{synced:0,pending:0,conflicts:1})
 assert.equal(env.read().calls,0)
 assert.equal(env.read().queue[0].state,'conflict')
})
test('offline records are user-scoped and do not store tokens',async()=>{
 const env=runtime([created])
 assert.deepEqual(await env.replayOfflineOperations('other'),{synced:0,pending:0,conflicts:0})
 assert.equal(env.read().sent,0)
 assert.ok(storage.includes("id:userId+':'+scope"))
 assert.ok(storage.includes("state?:'pending'|'conflict'"))
 assert.doesNotMatch(storage,/access_token|app_secret|password/i)
})
const photo={
 id:'u:inventory-photo:item',userId:'u',kind:'inventory-photo',createdAt:2,
 path:'/api/inventario/cego/itens/item/foto/registrar',
 body:{itemId:'item',sessionId:'session',sku:'SKU-QA',
  path:'u/session/item/00000000-0000-4000-8000-000000000001.jpg',
  file:{name:'qa.jpg',type:'image/jpeg',size:1024}}
}
test('inventory photo is retained offline, uploaded and linked once on reconnect',async()=>{
 const env=runtime([photo])
 env.setOnline(false)
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:0,pending:1,conflicts:0})
 env.setOnline(true)
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:1,pending:0,conflicts:0})
 assert.equal(env.read().uploaded.length,1)
 assert.equal(env.read().uploaded[0].bucket,'sgq-inventario-cego')
 assert.equal(env.read().uploaded[0].path,photo.body.path)
 assert.equal(env.read().omieCalls,1)
 assert.deepEqual(env.read().queue,[])
})
test('duplicate upload after lost response reuses same path and does not recount',async()=>{
 const env=runtime([photo],{uploadError:'The resource already exists'})
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:1,pending:0,conflicts:0})
 assert.equal(env.read().uploaded[0].path,photo.body.path)
 assert.equal(env.read().omieCalls,1)
 assert.equal(env.read().calls,0)
})
test('pending HEAD after upload is retried without marking a permanent conflict',async()=>{
 const env=runtime([photo],{registerError:'Foto ainda não está disponível no armazenamento. A contagem foi preservada.'})
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:0,pending:1,conflicts:0})
 assert.equal(env.read().queue[0].body.path,photo.body.path)
 env.setRegisterError('')
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:1,pending:0,conflicts:0})
 assert.equal(env.read().omieCalls,1)
})
test('HTTP 409 alone is not considered a duplicate successful upload',async()=>{
 const env=runtime([photo],{uploadError:'HTTP 409: validation conflict'})
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:0,pending:0,conflicts:1})
 assert.equal(env.read().omieCalls,0)
})
test('inspection photo missing temporarily stays in queue, then registers',async()=>{
 const item={...photo,id:'u:inspection-photo:123',kind:'inspection-photo',
  body:{path:'123/gerais/qa.jpg',inspectionId:'123',file:photo.body.file,legend:'QA'}}
 const env=runtime([item],{registerError:'Uma ou mais fotos ainda não estão disponíveis no armazenamento.'})
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:0,pending:1,conflicts:0})
 env.setRegisterError('')
 assert.deepEqual(await env.replayOfflineOperations('u'),{synced:1,pending:0,conflicts:0})
})
test('queue can be resumed manually without deleting local evidence',()=>{
 assert.match(storage,/export async function retryOfflinePhotoOperation/)
 assert.match(storage,/\['inspection-photo','inventory-photo'\]/)
 assert.match(storage,/sgq-offline-queue-changed/)
})
