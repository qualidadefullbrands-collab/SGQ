import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithApiWarmup, WARMUP_DELAYS_MS } from '../src/lib/sgqApiWarmup.mjs'

function setup(statuses) {
  const calls = [], pauses = [], cancelled = []
  const fetchImpl = async (url, init) => {
    calls.push({url, method: init.method})
    const status = statuses.shift()
    return { status, body: { cancel: async () => { cancelled.push(status) } } }
  }
  return { calls, pauses, cancelled, fetchImpl, sleep: async (ms) => { pauses.push(ms) } }
}
test('GET 503 temporário recupera mantendo método e URL', async () => {
  const s=setup([503,503,200])
  const result=await fetchWithApiWarmup('/api/app/listas',{method:'GET'},s)
  assert.equal(result.status,200)
  assert.equal(s.calls.length,3)
  assert.deepEqual(s.pauses,[1500,3500])
  assert.deepEqual(s.cancelled,[503,503])
})
test('GET com 503 persistente para após limite, sem loop infinito', async () => {
  const s=setup([503,503,503,503,503,200])
  assert.equal((await fetchWithApiWarmup('/health',{method:'GET'},s)).status,503)
  assert.equal(s.calls.length,5)
  assert.deepEqual(s.pauses,WARMUP_DELAYS_MS)
})
for (const method of ['POST','PUT','DELETE','PATCH']) {
  test(method+' nunca é repetido automaticamente mesmo com 503', async () => {
    const s=setup([503,200])
    assert.equal((await fetchWithApiWarmup('/api/mutacao',{method},s)).status,503)
    assert.equal(s.calls.length,1)
    assert.equal(s.pauses.length,0)
  })
}
test('GET com 401 não é repetido', async () => {
  const s=setup([401,200])
  assert.equal((await fetchWithApiWarmup('/api/protegida',{method:'GET'},s)).status,401)
  assert.equal(s.calls.length,1)
})
test('falha de rede não provoca repetição de operações', async () => {
  let calls=0
  await assert.rejects(fetchWithApiWarmup('/api/app/listas',{method:'GET'},{fetchImpl:async()=>{calls++;throw Error('offline')}}),/offline/)
  assert.equal(calls,1)
})
