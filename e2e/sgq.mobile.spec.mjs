import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures/isolated.mjs'

test('login em tela móvel permanece utilizável e sem rolagem lateral', async ({ isolated }) => {
  const { page } = isolated
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'SGQ · Qualidade' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'E-mail' })).toBeVisible()
  await expect(page.getByLabel('Senha', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(width.document, 'a página não deve exceder a largura do dispositivo').toBeLessThanOrEqual(width.viewport + 2)
})

test('link expirado permite retornar ao formulário de recuperação sem enviar email', async ({ isolated }) => {
  const { page } = isolated
  await page.goto('/?auth=recovery&error_code=otp_expired')
  await expect(page.getByRole('heading', { name: 'Definir nova senha' })).toBeVisible()
  await expect(page.getByText('Este link de recuperação já foi usado ou expirou.')).toBeVisible()
  await page.getByRole('button', { name: 'Solicitar novo link' }).click()
  await expect(page.getByRole('heading', { name: 'Recuperar senha' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar link de recuperação' })).toBeVisible()
  await expect(page).not.toHaveURL(/auth=recovery/)
})

test('recuperação de senha em dispositivo móvel respeita requisitos básicos de acessibilidade', async ({ isolated }) => {
  const { page } = isolated
  await page.goto('/')
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const severe = report.violations.filter(item => ['critical', 'serious'].includes(item.impact))
  expect(severe.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(n => n.target) }))).toEqual([])
})
