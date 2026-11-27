import { test, expect } from './fixtures/isolated.mjs'

test('módulos que não são inspeções ficam fora da navegação ativa', async ({ isolated }) => {
  const { page, email, password } = isolated
  await page.goto('/')
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('[data-sgq-screen="quadro"]')).toBeVisible()

  const nav = page.getByRole('complementary', { name: 'Navegação de inspeções' })
  await expect(nav.getByRole('button', { name: 'Estoque' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Painel' })).toHaveCount(0)
  await expect(page.locator('[data-sgq-screen="estoque"]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Central de inspeções' })).toBeVisible()
})
