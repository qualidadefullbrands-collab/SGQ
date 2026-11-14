import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures/isolated.mjs'

async function signIn(isolated) {
  const { page, email, password } = isolated
  await page.goto('/')
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('[data-sgq-screen="painel"]')).toBeVisible()
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

test('revisão da biblioteca IT funciona com cadastro totalmente sintético', async ({ isolated }) => {
  const { page } = isolated
  await signIn(isolated)
  const nav = page.getByRole('complementary', { name: 'Navegação principal do SGQ' })
  await nav.getByRole('button', { name: 'Instruções técnicas' }).click()
  await expect(page.locator('[data-sgq-screen="its"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Instruções técnicas' })).toBeVisible()
  await expect(page.getByText('IT-QA-001').first()).toBeVisible()
  await expect(page.getByText('Produto de teste sintético')).toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Buscar instrução técnica' })
  await search.fill('IT-NÃO-EXISTE')
  await expect(page.getByText('Nenhuma versão corresponde aos filtros.')).toBeVisible()
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(page.getByText('Produto de teste sintético')).toBeVisible()
  await page.getByRole('button', { name: /Obsoletas/ }).click()
  await expect(page.getByText('Nenhuma versão corresponde aos filtros.')).toBeVisible()
})

test('navegação de estoque separa contagem e conciliação física do cadastro Omie', async ({ isolated }) => {
  const { page } = isolated
  await signIn(isolated)
  const main = page.locator('[data-sgq-screen="painel"]')
  await expect(main).toBeVisible()

  const nav = page.getByRole('complementary', { name: 'Navegação principal do SGQ' })
  await nav.getByRole('button', { name: 'Estoque' }).click()
  await expect(page.locator('[data-sgq-screen="estoque"]')).toBeVisible()

  const stockNav = page.getByRole('navigation', { name: 'Áreas de estoque e inventário' })
  await expect(stockNav.getByRole('button', { name: /Contagem FST/ })).toBeVisible()
  await expect(stockNav.getByRole('button', { name: /Acompanhamento/ })).toBeVisible()
  await stockNav.getByRole('button', { name: /Conciliação SGQ/ }).click()
  await expect(stockNav.getByRole('button', { name: /Conciliação SGQ/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('A consulta ao Omie confere apenas código e descrição do produto.')).toBeVisible()
  await expect(page.getByText(/controles físicos do SGQ para a mesma localização/)).toBeVisible()
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
