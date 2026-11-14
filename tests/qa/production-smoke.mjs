import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'

// QC remoto e SOMENTE LEITURA: URLs públicos, GET, nenhuma credencial.
function endpoint(name) {
  const raw = (process.env[name] || '').trim()
  assert.ok(raw, name + ' obrigatório; um teste não configurado é FAIL, não SKIP')
  const url = new URL(raw)
  assert.ok(['https:', 'http:'].includes(url.protocol), name + ': esquema inválido')
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(name + ': usar HTTPS fora de localhost')
  }
  return url.origin
}

const frontend = endpoint('SGQ_QC_FRONTEND_URL')
const api = endpoint('SGQ_QC_API_URL')

async function probe(origin, path, label) {
  const started = performance.now()
  let response
  try {
    response = await fetch(new URL(path, origin), {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(45000),
      headers: {accept: 'text/html, application/json, */*'},
    })
  } catch (err) {
    throw new Error(label + ': erro de rede ou timeout (' + (err?.message || err) + ')')
  }
  const body = await response.text()
  const elapsedMs = Math.round(performance.now() - started)
  console.log('QC', label, 'HTTP', response.status, elapsedMs + 'ms')
  return {response, body, elapsedMs}
}

function requireStatus(result, status, label) {
  assert.equal(result.response.status, status,
    label + ': esperado HTTP ' + status + ', recebido ' + result.response.status)
}

test('QC/PROD: frontend carrega HTML React e não exibe erro HTTP', async () => {
  const r = await probe(frontend, '/', 'frontend /')
  requireStatus(r, 200, 'frontend /')
  assert.match(r.response.headers.get('content-type') || '', /text\/html/i)
  assert.match(r.body, /<div\s+id=["']root["']/i)
  assert.match(r.body, /<title>SGQ Qualidade<\/title>/i)
  assert.match(r.body, /\/assets\/[^"'\s]+\.js/i,
    'o frontend publicado deve apontar para JavaScript compilado em /assets/')
})

test('QC/PROD: JavaScript inicial do frontend está publicado', async () => {
  const root = await probe(frontend, '/', 'frontend assets index')
  requireStatus(root, 200, 'frontend assets index')
  const path = root.body.match(/(?:src|href)=["'](\/assets\/[^"']+\.js(?:\?[^"']*)?)["']/i)?.[1]
  assert.ok(path, 'não foi encontrado o bundle Vite compilado no HTML')
  const asset = await probe(frontend, path, 'frontend JS compilado')
  requireStatus(asset, 200, 'frontend JS compilado')
  assert.ok(asset.body.length > 100, 'bundle JavaScript retornou conteúdo insuficiente')
  assert.doesNotMatch(asset.response.headers.get('content-type') || '', /text\/html/i,
    'bundle respondeu com HTML (possível fallback ou erro de deploy)')
})

test('QC/PROD: API health responde com status ok', async () => {
  const r = await probe(api, '/health', 'API /health')
  requireStatus(r, 200, 'API /health')
  let data
  try { data = JSON.parse(r.body) } catch { assert.fail('API /health retornou JSON inválido') }
  assert.equal(data?.status, 'ok', 'API /health não informou status ok')
})

test('QC/SEGURANÇA: rota protegida rejeita acesso anônimo', async () => {
  const r = await probe(api, '/api/app/listas', 'API sem token /api/app/listas')
  requireStatus(r, 401, 'API /api/app/listas sem token')
})

test('QC/PROD: amostragem pública calcula amostra válida', async () => {
  const r = await probe(api, '/api/amostragem/plano?lote=100&nivel=I',
    'API plano público de amostragem')
  requireStatus(r, 200, 'API /api/amostragem/plano')
  let data
  try { data = JSON.parse(r.body) } catch { assert.fail('amostragem retornou JSON inválido') }
  const n = Number(data?.data?.amostra)
  assert.ok(Number.isFinite(n) && n > 0 && n <= 100,
    'plano de amostragem inválido para lote de 100 (sem usar dados reais)')
})
