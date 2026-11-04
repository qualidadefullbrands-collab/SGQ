import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const sync=readFileSync(new URL('../src/lib/offlineSync.ts',import.meta.url),'utf8')
const storage=readFileSync(new URL('../src/lib/offline.ts',import.meta.url),'utf8')
function runtime(initial){
 let queue=[...initial], sent=0, conflicts=0, calls=0,online=true
 const apiGet=async()=>({data:{inspecao:{status:'aberta'},items:[]},error:null})
 const apiPost=async()=>{sent++;return {data:{id:'saved'},error:null}}
 const apiPut=async()=>{calls++;return {data:{ok:true},error:null}}
 const supabase={storage:{from:()=>({upload:async()=>({error:null})})}}
 const offlineOperations=async user=>queue.filter(x=>x.userId===user)
 const clearOfflineOperation=async id=>{queue=queue.filter(x=>x.id!==id)}
 const markOfflineConflict=async(row,message)=>{
   conflicts++
   queue=queue.map(x=>x.id===row.id?{...x,state:'conflict',error:message}:x)
 }
 const connectionFailure=message=>/failed to fetch|network/i.test(message)
 const transpiled=ts.transpileModule(sync.replace(/^import .*\n/gm,''),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText.replace(/^export /gm,'')
 const navigator={get onLine(){return online}}
 const {replayOfflineOperations}=new Function('apiGet','apiPost','apiPut','supabase','clearOfflineOperation','markOfflineConflict','offlineOperations','connectionFailure','navigator',
   transpiled+'\nreturn {replayOfflineOperations}')(
   apiGet,apiPost,apiPut,supabase,clearOfflineOperation,markOfflineConflict,offlineOperations,connectionFailure,navigator)
 return {
  replayOfflineOperations,
  setOnline:value=>{online=value},
  read:()=>({queue,sent,conflicts,calls})
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
 assert.match(storage,/id:userId\+':'+scope/)
 assert.match(storage,/state:'pending'\|'conflict'/)
 assert.doesNotMatch(storage,/access_token|app_secret|password/i)
})
