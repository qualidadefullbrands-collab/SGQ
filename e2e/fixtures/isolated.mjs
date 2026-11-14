import { test as base, expect } from '@playwright/test'

const AUTH_ORIGIN = 'https://sgq-auth.qa.invalid'
const API_ORIGIN = 'https://sgq-api.qa.invalid'
const LOCAL_ORIGIN = 'http://127.0.0.1:4178'
const QA_USER_ID = '11111111-1111-4111-8111-111111111111'
const QA_EMAIL = 'operador-qc@example.invalid'

function jwt() {
  const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    aud: 'authenticated', sub: QA_USER_ID, role: 'authenticated', exp: 4102444800,
    iss: AUTH_ORIGIN + '/auth/v1',
  })).toString('base64url')
  return head + '.' + body + '.qa-synthetic'
}

const user = {
  id: QA_USER_ID,
  email: QA_EMAIL,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { name: 'Operador QA' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  confirmed_at: '2026-01-01T00:00:00Z',
}

const responseHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
  'content-type': 'application/json',
}

const fixtureData = {
  bootstrap: {
    data: {
      profile: { id: QA_USER_ID, nome: 'Operador Sintético QA', perfil: 'gestor' },
      processes: [],
      inspections: [],
      itemLinks: [],
    }, error: null,
  },
  catalogs: {
    data: {
      itVersions: [{
        id: '22222222-2222-4222-8222-222222222222',
        status: 'publicada',
        versao: '1',
        vigencia: '2026-01-01',
        leitura_ia_status: 'publicada',
        arquivo_nome: 'IT-QA-001.docx',
        instrucoes_trabalho: { codigo: 'IT-QA-001', titulo: 'Produto de teste sintético' },
      }],
      groups: [],
    }, error: null,
  },
  stock: { data: { samples: [] }, error: null },
}

async function reply(route, status, body) {
  await route.fulfill({
    status,
    headers: responseHeaders,
    body: JSON.stringify(body),
  })
}

/**
 * E2E usa componentes reais do SGQ com backend fictício.
 * Todo host não local é barrado: nenhuma chamada chega à produção,
 * mesmo em caso de alteração acidental no endereço da API.
 */
export const test = base.extend({
  isolated: async ({ page }, use) => {
    const unexpected = []
    const writes = []

    await page.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin === LOCAL_ORIGIN) return route.continue()
      unexpected.push(request.method() + ' ' + url.origin + url.pathname)
      await route.abort('blockedbyclient')
    })

    await page.route(API_ORIGIN + '/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() !== 'GET') {
        writes.push(request.method() + ' ' + path)
        return reply(route, 405, { error: { message: 'Escrita proibida no E2E isolado' } })
      }
      if (path === '/api/app/bootstrap') return reply(route, 200, fixtureData.bootstrap)
      if (path === '/api/app/catalogos') return reply(route, 200, fixtureData.catalogs)
      if (path === '/api/app/estoque') return reply(route, 200, fixtureData.stock)
      if (/^\/api\/equipamentos/.test(path)) return reply(route, 200, { data: [], error: null })
      // Nenhuma consulta é delegada à API real; simula conjunto vazio.
      return reply(route, 200, { data: [], error: null })
    })

    await page.route(AUTH_ORIGIN + '/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: responseHeaders })
      if (path.startsWith('/rest/v1/')) {
        if (request.method() !== 'GET') {
          writes.push(request.method() + ' ' + path)
          return reply(route, 405, { message: 'Escrita fora do escopo QA' })
        }
        return reply(route, 200, [])
      }
      if (path === '/auth/v1/token' && request.method() === 'POST') {
        const input = request.postDataJSON()
        if (input.email === QA_EMAIL && input.password === 'Somente-QA-123') {
          return reply(route, 200, {
            access_token: jwt(), refresh_token: 'qa-refresh-synthetic',
            expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user,
          })
        }
        return reply(route, 400, {
          error: 'invalid_grant', error_description: 'Invalid login credentials',
        })
      }
      if (path === '/auth/v1/user' && request.method() === 'GET') return reply(route, 200, user)
      if (path === '/auth/v1/logout' && request.method() === 'POST') {
        return route.fulfill({ status: 204, headers: responseHeaders })
      }
      writes.push(request.method() + ' ' + path)
      return reply(route, 405, { message: 'Operação Auth não simulada' })
    })

    await use({ page, email: QA_EMAIL, password: 'Somente-QA-123' })
    expect(writes, 'Nenhuma gravação operacional é permitida no E2E').toEqual([])
    expect(unexpected, 'Nenhuma conexão externa pode escapar dos mocks').toEqual([])
  },
})

export { expect }
