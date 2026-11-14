import { test, expect } from './fixtures/inventory.mjs'

const PNG_QA = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9fDgAAAABJRU5ErkJggg==',
  'base64',
)

test('contagem física persiste após falha Omie e foto pode ser reenviada sem duplicar SKU', async ({ inventorySandbox }) => {
  const { page, email, password, db } = inventorySandbox

  await page.goto('/')
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.locator('[data-sgq-screen="painel"]')).toBeVisible()

  await page.getByRole('complementary', { name: 'Navegação principal do SGQ' })
    .getByRole('button', { name: 'Estoque' }).click()
  await page.getByRole('navigation', { name: 'Áreas de estoque e inventário' })
    .getByRole('button', { name: /Contagem FST/ }).click()

  await page.getByLabel('Rua ou armário').selectOption('RUA 01')
  await page.getByLabel('Código do processo').fill('FST99999-A')
  await page.getByRole('button', { name: 'Consultar Omie' }).click()
  await expect(page.getByText('Processo localizado no Omie')).toBeVisible()
  await page.getByLabel('NF de entrada').fill('999999')
  await page.getByLabel('Data da NF').fill('2026-11-12')
  await page.getByRole('button', { name: 'Confirmar dados e iniciar contagem' }).click()
  await expect(page.getByText(/Dados confirmados · IC-/)).toBeVisible()

  await page.getByRole('button', { name: /QA0001.*Produto simulado para inventário/ }).click()
  await page.getByLabel('Quantidade física').fill('12.5')
  await page.getByLabel('Escolher foto').setInputFiles({
    name: 'foto-qc.png', mimeType: 'image/png', buffer: PNG_QA,
  })
  await expect(page.getByRole('button', { name: 'Salvar e próximo item' })).toBeEnabled()
  await page.getByRole('button', { name: 'Salvar e próximo item' }).click()

  await expect(page.getByText(/Contagem salva\. A foto está pendente no Omie/)).toBeVisible()
  expect(db.counts).toHaveLength(1)
  expect(db.counts[0].quantidade_contada).toBe(12.5)
  expect(db.counts[0].endereco).toBe('RUA 01')
  expect(db.writes.filter(w => w.table === 'sgq_inventario_cego_itens')).toHaveLength(1)
  expect(db.photoSyncAttempts).toBe(1)

  await page.getByRole('button', { name: /QA0001.*Produto simulado para inventário/ }).click()
  await expect(page.getByText('Falha no Omie')).toBeVisible()
  await page.getByRole('button', { name: 'Reenviar foto' }).click()
  await expect(page.getByText('Enviada ao Omie')).toBeVisible()

  expect(db.counts).toHaveLength(1)
  expect(db.writes.filter(w => w.table === 'sgq_inventario_cego_itens')).toHaveLength(1)
  expect(db.photoSyncAttempts).toBe(2)
})
