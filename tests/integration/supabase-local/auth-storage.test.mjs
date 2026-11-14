import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SGQ_QC_API_URL
const anonKey = process.env.SGQ_QC_ANON_KEY
const serviceKey = process.env.SGQ_QC_SERVICE_KEY
const pgurl = process.env.SGQ_QC_DB_URL
assert(url && anonKey && serviceKey && pgurl, 'Local Supabase status is required')
for (const value of [url, pgurl]) {
  assert(['localhost','127.0.0.1'].includes(new URL(value).hostname),
    'Do not execute these tests against production or external services')
}

const secret = 'QaLocal#2026!'
const openSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const closedSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const itemId = '33333333-3333-4333-8333-333333333333'
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9fDgAAAABJRU5ErkJggg==',
  'base64',
)
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, serviceKey, opts)
const unauth = createClient(url, anonKey, opts)
const clients = {}
const identities = {}

function runSql(statement) {
  const x = spawnSync('psql', ['-X', '-v','ON_ERROR_STOP=1',pgurl], {
    input: statement, encoding: 'utf8',
  })
  if (x.status !== 0) throw Error('Local SQL fixture failed: ' + x.stderr)
}
function uuid(value) {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  return value
}
function name(user, session=openSession, file='foto.png') {
  return [uuid(identities[user]),session,itemId,file].join('/')
}
function assertStorageError(response, context) {
  assert(response.error, context + ': operation was unexpectedly authorized')
  const status=Number(response.error.statusCode ?? response.error.status)
  assert(status>=400 && status !== 404 && status < 500,
    context + ': expected Storage auth/validation rejection, got ' +
      status + ' (' + response.error.message + ')')
}
before(async () => {
  // Admin API and login API are REAL local GoTrue, not mocked responses.
  for (const role of ['gestor','inspetor','consulta']) {
    const email = 'sgq-' + role + '-qc@example.invalid'
    const created = await admin.auth.admin.createUser({email,password:secret,email_confirm:true})
    assert.ifError(created.error)
    assert(created.data.user?.id, 'Admin Auth should create local test user')
    identities[role] = created.data.user.id
    const client = createClient(url, anonKey, opts)
    const session = await client.auth.signInWithPassword({email,password:secret})
    assert.ifError(session.error)
    assert.equal(session.data.user.id, identities[role])
    assert(session.data.session.access_token)
    clients[role] = client
  }

  const accounts = Object.entries(identities)
    .map(([role,id]) => "('" + uuid(id) + "','" + role + "')").join(',')
  runSql(`
    insert into public.sgq_qc_roles(user_id,perfil) values ${accounts};
    insert into public.sgq_inventarios_cegos(id,status) values
      ('${openSession}','aberto'),('${closedSession}','fechado');
  `)
})

test('Auth real: gestor autenticado e identidade do JWT conferida no servidor', async () => {
  const response = await clients.gestor.auth.getUser()
  assert.ifError(response.error)
  assert.equal(response.data.user.id, identities.gestor)
})

test('Auth real: credenciais incorretas são recusadas', async () => {
  const response = await unauth.auth.signInWithPassword({
    email: 'sgq-gestor-qc@example.invalid', password: 'senha-incorreta',
  })
  assert(response.error)
  assert.equal(response.data.session, null)
})

test('Storage real: gestor envia foto válida ao inventário aberto', async () => {
  const result = await clients.gestor.storage.from('sgq-inventario-cego')
    .upload(name('gestor'), image, {contentType:'image/png',upsert:false})
  assert.ifError(result.error)
  assert.equal(result.data.path, name('gestor'))
})

test('Storage real: arquivo autorizado pode ser lido por gestor', async () => {
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .download(name('gestor'))
  assert.ifError(r.error)
  assert.equal(r.data.size, image.length)
})

test('Storage real: reenvio com upsert=false não cria objeto duplicado', async () => {
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .upload(name('gestor'), image, {contentType:'image/png',upsert:false})
  assertStorageError(r, 'duplicate upload must fail')
})

test('Storage real: impede gravação no prefixo UUID de outro usuário', async () => {
  const bad = [identities.inspetor,openSession,itemId,'outro-user.png'].join('/')
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .upload(bad, image, {contentType:'image/png',upsert:false})
  assertStorageError(r, 'wrong user path')
})

test('Storage real: impede gravação com inventário fechado', async () => {
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .upload(name('gestor',closedSession,'fechado.png'), image,
      {contentType:'image/png',upsert:false})
  assertStorageError(r, 'closed inventory')
})

test('Storage real: inspetor autorizado também pode armazenar foto', async () => {
  const r = await clients.inspetor.storage.from('sgq-inventario-cego')
    .upload(name('inspetor'), image, {contentType:'image/png',upsert:false})
  assert.ifError(r.error)
  assert.equal(r.data.path, name('inspetor'))
})

test('Storage real: consulta não pode fazer upload', async () => {
  const r = await clients.consulta.storage.from('sgq-inventario-cego')
    .upload(name('consulta'), image, {contentType:'image/png',upsert:false})
  assertStorageError(r, 'read-only consultation role')
})

test('Storage real: chamada anônima não pode fazer upload', async () => {
  const r = await unauth.storage.from('sgq-inventario-cego')
    .upload(name('gestor',openSession,'anon.png'),image,
      {contentType:'image/png',upsert:false})
  assertStorageError(r, 'anonymous upload')
})

test('Storage real: bucket privado não permite leitura anônima', async () => {
  const r = await unauth.storage.from('sgq-inventario-cego')
    .download(name('gestor'))
  assertStorageError(r, 'anonymous read')
})

test('Storage real: consulta pode ler evidência, conforme política do SGQ', async () => {
  const r = await clients.consulta.storage.from('sgq-inventario-cego')
    .download(name('gestor'))
  assert.ifError(r.error)
  assert.equal(r.data.size,image.length)
})

test('Storage real: MIME não autorizado é recusado', async () => {
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .upload(name('gestor',openSession,'formato.webp'), image,
      {contentType:'image/webp',upsert:false})
  assertStorageError(r, 'unsupported MIME')
})

test('Storage real: foto superior a 8 MiB é recusada', async () => {
  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61)
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .upload(name('gestor',openSession,'grande.png'),oversized,
      {contentType:'image/png',upsert:false})
  assertStorageError(r, 'bucket file size limit')
})

test('Storage real: status final, metadados e inexistência de gravações proibidas', async () => {
  const r = await clients.gestor.storage.from('sgq-inventario-cego')
    .list(name('gestor').split('/').slice(0,3).join('/'))
  assert.ifError(r.error)
  assert.equal(r.data.filter(f => f.name === 'foto.png').length,1)
  assert(!r.data.some(f=>['fechado.png','formato.webp','grande.png','anon.png'].includes(f.name)))
  console.log('SGQ_LOCAL_AUTH_STORAGE_PASS: GoTrue/Auth, original Storage RLS and real uploads')
})
