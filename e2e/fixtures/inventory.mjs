import { test as isolatedTest, expect } from './isolated.mjs'

const AUTH = 'https://sgq-auth.qa.invalid'
const API = 'https://sgq-api.qa.invalid'
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'content-type': 'application/json',
}

async function respond(route, status, data) {
  await route.fulfill({ status, headers, body: JSON.stringify(data) })
}

export const test = isolatedTest.extend({
  inventorySandbox: async ({ isolated }, use) => {
    const { page } = isolated
    const db = {
      sessions: [],
      counts: [],
      photos: [],
      writes: [],
      photoSyncAttempts: 0,
      requestsOutsideFixture: [],
    }

    // Intercepted before the real React components are mounted.
    // Supabase REST calls below never reach a database or Omie.
    await page.route(AUTH + '/rest/v1/**', async route => {
      const req = route.request()
      const url = new URL(req.url())
      const table = url.pathname.split('/').at(-1)
      const method = req.method()
      if (method === 'GET') {
        const tableRows = {
          localizacoes_estoque: [{ codigo: 'RUA 01', armario: null }],
          amostras: [],
          processos: [],
          sgq_inventarios_cegos: db.sessions,
          sgq_inventario_cego_itens: db.counts,
          sgq_inventario_cego_imagens: db.photos,
          sgq_inventario_cego_documentos: [],
        }
        const rows = tableRows[table] || []
        // PostgREST maybeSingle() expects a null object for an empty match.
        const accept = req.headers()['accept'] || ''
        const single = accept.includes('vnd.pgrst.object+json')
        if (single && rows.length === 0) return respond(route, 406, {
          code: 'PGRST116', message: 'The result contains 0 rows',
          details: 'Results contain 0 rows', hint: null,
        })
        if (single) return respond(route, 200, rows.at(-1))
        return respond(route, 200, rows)
      }
      if (method === 'POST' && table === 'sgq_inventarios_cegos') {
        const body = req.postDataJSON()
        db.writes.push({ table, body })
        const session = { ...body, id: '33333333-3333-4333-8333-333333333333' }
        db.sessions.push(session)
        return respond(route, 201, session)
      }
      if (method === 'POST' && table === 'sgq_inventario_cego_itens') {
        const body = req.postDataJSON()
        db.writes.push({ table, body })
        db.counts.push({ ...body, criado_em: new Date().toISOString() })
        return respond(route, 201, [])
      }
      if (method === 'POST' && table === 'sgq_inventario_cego_imagens') {
        const body = req.postDataJSON()
        db.writes.push({ table, body })
        const row = { ...body, id: '44444444-4444-4444-8444-444444444444',
          status: 'erro', erro: 'Indisponibilidade sintética do serviço Omie' }
        db.photos.push(row)
        return respond(route, 201, { id: row.id })
      }
      db.requestsOutsideFixture.push(method + ' /rest/v1/' + table)
      return respond(route, 405, { message: 'Operação não simulada no inventário QC' })
    })

    await page.route(AUTH + '/functions/v1/**', async route => {
      const req = route.request()
      const name = new URL(req.url()).pathname.split('/').at(-1)
      const body = req.postDataJSON()
      if (req.method() !== 'POST') {
        db.requestsOutsideFixture.push(req.method() + ' function ' + name)
        return respond(route, 405, { message: 'Método não autorizado em fixture' })
      }
      if (name === 'sgq-omie-fst') {
        if (body.modo === 'inventario') return respond(route, 200, {
          found: true, matchedCode: 'FST99999-A', cliente: 'Cliente Sintético QA',
          itensDisponiveis: true, itens: [
            { sku: 'QA0001', descricao: 'Produto simulado para inventário' },
          ],
        })
        if (body.modo === 'nfe') return respond(route, 200, {
          status: 'matched', numeroNota: '999999', dataRegistro: '2026-11-12',
        })
      }
      if (name === 'sgq-inventario-foto-direta') {
        db.photoSyncAttempts++
        if (db.photoSyncAttempts === 1) {
          return respond(route, 503, { error: 'Simulação controlada: Omie indisponível' })
        }
        const photo = db.photos.find(p => p.id === body.foto_id)
        if (photo) { photo.status = 'sincronizada'; photo.erro = '' }
        return respond(route, 200, { ok: true, sku: 'QA0001' })
      }
      db.requestsOutsideFixture.push('function ' + name)
      return respond(route, 405, { error: 'Função fora do cenário sintético' })
    })

    await page.route(API + '/api/estoque/validar-sku', async route => {
      const req = route.request()
      if (req.method() !== 'POST') {
        db.requestsOutsideFixture.push(req.method() + ' /api/estoque/validar-sku')
        return respond(route, 405, { error: 'Método não simulado' })
      }
      const body = req.postDataJSON()
      expect(body.codigo).toBe('QA0001')
      return respond(route, 200, { data: { found: true, descricao: 'Produto simulado' }, error: null })
    })

    await page.route(API + '/api/storage/**', async route => {
      const req = route.request()
      if (req.method() !== 'POST') {
        db.requestsOutsideFixture.push(req.method() + ' /api/storage/')
        return respond(route, 405, { error: 'Método não simulado' })
      }
      db.writes.push({ table: 'photo_storage', body: 'arquivo sintético' })
      return respond(route, 200, { data: { path: 'qc/sintetico.png' }, error: null })
    })

    await use({ ...isolated, db })
    expect(db.requestsOutsideFixture, 'Somente operações do cenário sintético são permitidas').toEqual([])
  },
})

export { expect }
