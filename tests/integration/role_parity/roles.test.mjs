import test, {before} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {createClient} from '@supabase/supabase-js'

// Hosted SGQ credentials/URLs must NEVER enter this executable.
for(const k of ['SGQ_QC_API_URL','SGQ_QC_DB_URL']) {
  const value=process.env[k]
  assert(value, 'missing local setting: '+k)
  assert(['localhost','127.0.0.1'].includes(new URL(value).hostname),
    'remote Supabase forbidden for policy parity test')
}
const url=process.env.SGQ_QC_API_URL
const pgurl=process.env.SGQ_QC_DB_URL
const anonKey=process.env.SGQ_QC_ANON_KEY
const serviceKey=process.env.SGQ_QC_SERVICE_KEY
assert(anonKey && serviceKey)
const opts={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}}
const service=createClient(url,serviceKey,opts)
const unauth=createClient(url,anonKey,opts)
const users={}
const roles=['administrador','gestor','inspetor','consulta','inativo','semPerfil']
const BUCKET='inspecao-fotos'
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9fDgAAAABJRU5ErkJggg==','base64')
const BASE='11111111-1111-4111-8111-111111111111'
const accepted=['administrador','gestor','inspetor']
const readers=['administrador','gestor','inspetor','consulta']
const NO=['inativo','semPerfil']
const storage=(role)=> (role==='anon'?unauth:users[role].client).storage.from(BUCKET)
const client=(role)=>role==='anon'?unauth:users[role].client
const imgPath=(suffix)=>'qa-perfis/'+suffix+'.png'
const samplePath=imgPath('gerente')
function sql(source) {
  const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1',pgurl],{
    input:source,encoding:'utf8',maxBuffer:2*1024*1024,
  })
  if(result.status!==0)throw Error('Postgres LOCAL fixture failed: '+result.stderr.slice(-1200))
  return result.stdout
}
function rejected(r,context) {
  // RLS can return an empty affected-row set rather than an HTTP error.
  assert(r.error || !r.data || r.data.length===0,
    context+': unauthorized mutation unexpectedly persisted')
}
async function exists(path) {
  const r=await storage('administrador').download(path)
  return !r.error && r.data?.size===PNG.length
}
before(async()=>{
  for(const role of roles){
    const email='role-'+role+'-qa-sgq@example.invalid'
    const a=await service.auth.admin.createUser({
      email,password:'LocalQA#2026!!',email_confirm:true
    })
    assert.ifError(a.error)
    const id=a.data.user.id
    const c=createClient(url,anonKey,opts)
    const login=await c.auth.signInWithPassword({email,password:'LocalQA#2026!!'})
    assert.ifError(login.error)
    assert.equal(login.data.user.id,id)
    users[role]={id,client:c}
  }
  let fixture=readFileSync('tests/integration/role_parity/hosted_policy_snapshot.sql','utf8')
  const replacements={
    '__ADMIN__':users.administrador.id,
    '__MANAGER__':users.gestor.id,
    '__INSPECTOR__':users.inspetor.id,
    '__CONSULT__':users.consulta.id,
    '__DISABLED__':users.inativo.id,
  }
  for(const [token,id] of Object.entries(replacements)){
    assert.match(id,/^[a-f0-9-]{36}$/)
    assert(fixture.includes(token))
    fixture=fixture.replaceAll(token,id)
  }
  assert(!fixture.includes('__ADMIN__'))
  sql(fixture)
  console.log('SGQ_PARITY_FIXTURE_PASS: hosted role predicates + synthetic GoTrue users')
})

test('01 Auth local emite JWT e consulta seu próprio perfil',async()=>{
  for(const role of roles){
    const r=await client(role).auth.getUser()
    assert.ifError(r.error)
    assert.equal(r.data.user.id,users[role].id)
  }
})
test('02 RLS de processos é por perfil de equipe, não por proprietário',async()=>{
  for(const role of readers){
    const r=await client(role).from('processos').select('id').order('id')
    assert.ifError(r.error)
    assert.equal(r.data.length,2,'role='+role)
  }
  for(const role of NO){
    const r=await client(role).from('processos').select('id')
    assert.ifError(r.error)
    assert.equal(r.data.length,0,role)
  }
})
test('03 anon sem JWT não recebe processos nem fotos cadastrais',async()=>{
  for(const table of ['processos','inspecao_fotos']){
    const r=await unauth.from(table).select('id')
    assert(r.error || r.data.length===0,table)
  }
})
test('04 perfis próprios vs cadastro completo: admin/gestor veem todos',async()=>{
  for(const role of ['administrador','gestor']){
    const r=await client(role).from('profiles').select('id')
    assert.ifError(r.error)
    assert.equal(r.data.length,5,role)
  }
  for(const role of ['inspetor','consulta','inativo']){
    const r=await client(role).from('profiles').select('id')
    assert.ifError(r.error)
    assert.deepEqual(r.data.map(x=>x.id),[users[role].id],role)
  }
  const r=await client('semPerfil').from('profiles').select('id')
  assert.ifError(r.error)
  assert.equal(r.data.length,0)
})
test('05 somente administrador altera o perfil de outro usuário',async()=>{
  for(const role of ['gestor','inspetor','consulta','inativo']){
    const r=await client(role).from('profiles')
      .update({nome:'ALTERACAO PROIBIDA'})
      .eq('id',users.consulta.id).select('id')
    rejected(r,role)
  }
  const ok=await client('administrador').from('profiles')
    .update({nome:'QA Consulta Verificada'}).eq('id',users.consulta.id).select('nome')
  assert.ifError(ok.error)
  assert.equal(ok.data.length,1)
  assert.equal(ok.data[0].nome,'QA Consulta Verificada')
})
test('06 somente admin/gestor/inspetor cadastram processo',async()=>{
  let i=0
  for(const role of accepted){
    const id='aaaa0000-0000-4000-8000-'+String(++i).padStart(12,'0')
    const r=await client(role).from('processos')
      .insert({id,codigo:'QA-CAD-'+role}).select('id')
    assert.ifError(r.error)
    assert.equal(r.data[0]?.id,id)
  }
  for(const role of ['consulta','inativo','semPerfil']){
    const id='bbbb0000-0000-4000-8000-'+String(++i).padStart(12,'0')
    const r=await client(role).from('processos')
      .insert({id,codigo:'QA-CAD-BLOQUEADO'}).select('id')
    rejected(r,role)
  }
})
test('07 edição operacional permite inspetor, impede consulta',async()=>{
  const ok=await client('inspetor').from('processos').update({
    status:'em_inspecao'
  }).eq('id',BASE).select('status')
  assert.ifError(ok.error)
  assert.equal(ok.data[0]?.status,'em_inspecao')
  const bad=await client('consulta').from('processos').update({
    status:'alteracao_indesejada'
  }).eq('id',BASE).select('status')
  rejected(bad,'consulta')
  const check=await client('gestor').from('processos')
    .select('status').eq('id',BASE).single()
  assert.ifError(check.error)
  assert.equal(check.data.status,'em_inspecao')
})
test('08 exclusão de processo é exclusiva de administrador/gestor',async()=>{
  sql(`
  insert into public.processos(id,codigo) values
   ('cccc0000-0000-4000-8000-000000000001','QA-EXCL-ADMIN'),
   ('cccc0000-0000-4000-8000-000000000002','QA-EXCL-GESTOR');
  `)
  const denied=await client('inspetor').from('processos').delete()
    .eq('id','cccc0000-0000-4000-8000-000000000001').select('id')
  rejected(denied,'inspetor')
  for(const [role,id] of [
    ['administrador','cccc0000-0000-4000-8000-000000000001'],
    ['gestor','cccc0000-0000-4000-8000-000000000002']
  ]){
    const r=await client(role).from('processos').delete().eq('id',id).select('id')
    assert.ifError(r.error)
    assert.equal(r.data.length,1)
  }
})
test('09 Storage aceita upload PNG por admin/gestor/inspetor',async()=>{
  for(const role of accepted){
    const path=imgPath(role)
    const r=await storage(role).upload(path,PNG,{contentType:'image/png',upsert:false})
    assert.ifError(r.error)
    assert.equal(r.data.path,path)
  }
})
test('10 Storage recusa upload de consulta/inativo/semPerfil/anon',async()=>{
  for(const role of ['consulta','inativo','semPerfil','anon']){
    const r=await storage(role).upload(imgPath('blocked-'+role),PNG,
      {contentType:'image/png',upsert:false})
    assert(r.error,'role '+role+' uploaded despite RLS')
  }
})
test('11 bucket privado: quatro perfis leem foto; os demais não',async()=>{
  for(const role of readers){
    const r=await storage(role).download(imgPath('administrador'))
    assert.ifError(r.error)
    assert.equal(r.data.size,PNG.length)
  }
  for(const role of [...NO,'anon']){
    const r=await storage(role).download(imgPath('administrador'))
    assert(r.error,role+' unexpectedly read photo')
  }
})
test('12 Storage de inspeções permite leitura interusuário por perfil',async()=>{
  // This test is a *parity assertion*, not a security recommendation:
  // hosted SGQ allows team access, unlike owner-only synthetic test #88.
  const r=await storage('consulta').download(imgPath('inspetor'))
  assert.ifError(r.error)
  assert.equal(r.data.size,PNG.length)
})
test('13 DELETE de arquivo negado ao inspetor, permitido ao gestor',async()=>{
  const path=imgPath('inspetor')
  const denied=await storage('inspetor').remove([path])
  // Response may be empty rather than 403 due to RLS. Validate actual object.
  assert(await exists(path),'Inspector incorrectly deleted image; '+(denied.error?.message||''))
  const ok=await storage('gestor').remove([path])
  assert.ifError(ok.error)
  assert.equal(await exists(path),false,'Manager did not delete image')
})
test('14 Storage não concede UPDATE para upsert de objeto existente',async()=>{
  const path=imgPath('administrador')
  const r=await storage('administrador').upload(path,PNG,{
    contentType:'image/png',upsert:true
  })
  assert(r.error,'upsert succeeded despite absence of Storage UPDATE policy')
  assert(await exists(path),'failed upsert must preserve original photo')
})
test('15 política hospedada aceita caminho sem prefixo de usuário; avaliar contrato',async()=>{
  // Explicitly document the boundary: role-based INSERT does not bind path
  // to auth.uid or inspection. Do not call this a security approval.
  const path='qa-parity-no-owner-prefix/image.png'
  const r=await storage('inspetor').upload(path,PNG,{contentType:'image/png',upsert:false})
  assert.ifError(r.error)
  assert.equal(r.data.path,path)
  console.log('SGQ_PARITY_WARNING: hosted bucket allows arbitrary object prefix by authorized role')
})
test('16 permissões conferidas sem registros corporativos',async()=>{
  const r=await client('consulta').from('inspecao_fotos')
    .select('storage_path,legenda')
  assert.ifError(r.error)
  assert.deepEqual(r.data,[{storage_path:'qa/roles/comprovante.png',
    legenda:'Foto sintética de inspeção'}])
  const forbidden=await client('consulta').from('inspecao_fotos')
    .update({legenda:'ERRADA'}).eq('id','44444444-4444-4444-8444-444444444444')
    .select('id')
  rejected(forbidden,'consulta')
  console.log('SGQ_ROLE_POLICY_PARITY_PASS: real Auth/PostgREST/Storage against hosted policy predicates')
})
