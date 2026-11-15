// Cold-start recovery is limited to idempotent READS. Never replay POST/PUT/DELETE.
export const WARMUP_DELAYS_MS = Object.freeze([1500, 3500, 6500, 12000])

export async function fetchWithApiWarmup(url, init = {}, options = {}) {
  const method = String(init.method || 'GET').toUpperCase()
  const fetchImpl = options.fetchImpl || fetch
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, init)
    if (method !== 'GET' || response.status !== 503 || attempt >= WARMUP_DELAYS_MS.length) return response
    // Release the previous response before retrying, without leaking its body.
    try { await response.body?.cancel?.() } catch { /* some runtimes auto-close the stream */ }
    await sleep(WARMUP_DELAYS_MS[attempt])
  }
}
