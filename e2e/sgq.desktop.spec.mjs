import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures/isolated.mjs'

async function signIn(isolated) {
  const { page, email, password } = isolated
  await page.goto('/')
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('[data-sgq-screen="quadro"]')).toBeVisible()
}

test('login rejeita credenciais inválidas e mantém usuário anônimo', async ({ isolated }) => {
  const { page } = isolated
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'SGQ · Qualidade' })).toBeVisible()
  await page.getByRole('textbox', { name: 'E-mail' }).fill('invalido-qc@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos.')
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'SGQ · Qualidade' })).toBeVisible()
})

test('Central de inspeções apresenta fila de trabalho, busca e filtros por situação', async ({ isolated }) => {
  const { page } = isolated
  await signIn(isolated)
  await expect(page.getByRole('heading', { name: 'Central de inspeções' })).toBeVisible()
  await expect(page.getByLabel('Buscar inspeções por FST, cliente, SKU ou nota fiscal')).toBeVisible()
  const filters = page.getByRole('navigation', { name: 'Filtrar inspeções por situação' })
  await expect(filters.getByRole('button', { name: /Pendentes e em execução/ })).toBeVisible()
  await expect(filters.getByRole('button', { name: /Não iniciadas/ })).toBeVisible()
  await expect(filters.getByRole('button', { name: /Em andamento/ })).toBeVisible()
  await expect(filters.getByRole('button', { name: /Concluídas/ })).toBeVisible()
  await filters.getByRole('button', { name: /Concluídas/ }).click()
  await expect(filters.getByRole('button', { name: /Concluídas/ })).toHaveAttribute('aria-pressed', 'true')
})

test('navegação principal mantém somente áreas relacionadas a inspeções', async ({ isolated }) => {
  const { page } = isolated
  await signIn(isolated)
  const nav = page.getByRole('complementary', { name: 'Navegação de inspeções' })
  await expect(nav.getByRole('button', { name: 'Central de inspeções' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Processos' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Inspeções Armazém' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Estoque' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Insights' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Configurações' })).toHaveCount(0)
  await expect(page.locator('[data-sgq-screen="estoque"]')).toHaveCount(0)
})

test('acessibilidade automatizada do login não tem violações sérias ou críticas', async ({ isolated }) => {
  const { page } = isolated
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'SGQ · Qualidade' })).toBeVisible()
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const severe = scan.violations.filter(item => ['critical', 'serious'].includes(item.impact))
  expect(severe.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(n => n.target) }))).toEqual([])
})
