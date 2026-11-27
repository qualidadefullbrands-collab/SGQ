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

test('revisão da biblioteca IT funciona com cadastro totalmente sintético', async ({ isolated }) => {
  const { page } = isolated
  await signIn(isolated)
  const nav=page.getByRole('complementary',{name:'Navegação de inspeções'})
  await nav.getByRole('button',{name:'Instruções técnicas',exact:true}).click()
  await expect(page.locator('[data-sgq-screen="its"]')).toBeVisible()
  await expect(nav.getByRole('button',{name:'Instruções técnicas',exact:true})).toHaveAttribute('aria-current','page')
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
  await page.getByRole('button',{name:'Limpar filtros'}).click()
  const refreshed=page.waitForResponse(response=>response.url().includes('/api/app/catalogos')&&response.status()===200)
  await page.getByRole('button',{name:'Atualizar ITs',exact:true}).click()
  await refreshed
  await expect(page.getByText('Produto de teste sintético')).toBeVisible()
  await nav.getByRole('button',{name:'Central de inspeções',exact:true}).click()
  await expect(page.locator('[data-sgq-screen="quadro"]')).toBeVisible()
})

test('navegação de estoque separa contagem e conciliação física do cadastro Omie', async ({ isolated }) => {
  const { page } = isolated
  await signIn(isolated)
  await page.goto('/e2e/fixtures/legacy-harness.html?module=estoque')
  await expect(page.locator('[data-qa-module="estoque"]')).toBeVisible()

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

test('central operacional exibe SKUs, kits, entradas independentes e busca sem reabrir módulos', async ({isolated})=>{
 const {page}=isolated
 await signIn(isolated)
 const nav=page.getByRole('complementary',{name:'Navegação de inspeções'})
 for(const label of ['Estoque','Inspeções Armazém','Configurações','Painel','Insights'])
  await expect(nav.getByRole('button',{name:label,exact:true})).toHaveCount(0)
 const cards=page.locator('.sgq-kanban-card')
 await expect(cards).toHaveCount(1)
 await expect(cards.filter({hasText:'QA-INDEP'})).toContainText('Entrada A')
 await page.getByRole('button',{name:/Histórico/}).click()
 await expect(cards).toHaveCount(1)
 const kit=cards.filter({hasText:'QA-KIT-A'})
 await expect(kit).toContainText('QA-KIT-B')
 await expect(kit).toContainText('Conjunto')
 await expect(kit.getByRole('button',{name:'Iniciar inspeção'})).toHaveCount(0)
 await page.getByRole('button',{name:/Todas/}).click()
 await expect(cards).toHaveCount(2)
 const search=page.getByRole('textbox',{name:'Buscar FST, cliente, SKU ou nota fiscal'})
 await search.fill('QA-INDEP')
 await expect(cards).toHaveCount(1)
 await search.fill('')
 await expect(cards).toHaveCount(2)
 await nav.getByRole('button',{name:'Processos',exact:true}).click()
 await expect(page.locator('.sgq-subprocess-node')).toHaveCount(2)
 await expect(page.locator('.sgq-subprocess-node').filter({hasText:'QA-INDEP'})).toContainText('Entrada A')
 await expect(page.locator('.sgq-subprocess-node').filter({hasText:'QA-KIT-B'})).toContainText('Entrada B')
 await nav.getByRole('button',{name:'Equipamentos',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Equipamentos e instrumentos'})).toBeVisible()
 await nav.getByRole('button',{name:'Central de inspeções',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Central de inspeções'})).toBeVisible()
})

test('reclassificação de kit é acessível na inspeção e exige prévia e confirmação',async({isolated})=>{
 const {page}=isolated
 await signIn(isolated)
 const version='22222222-2222-4222-8222-222222222222'
 const products=[{sku:'QA-KIT-A',nome:'Componente A',quantidade:100,unidades:1},{sku:'QA-KIT-B',nome:'Componente B',quantidade:200,unidades:2}]
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'*','content-type':'application/json'}
 const reply=(route,data)=>route.fulfill({status:200,headers,body:JSON.stringify({data,error:null})})
 await page.route('https://sgq-api.qa.invalid/api/inspecoes/qa-i2/resumo*',route=>reply(route,{inspecao:{id:'qa-i2',numero:'QA-I2',status:'aberta',nivel_inspecao:'II',it_versao_id:version,tamanho_amostra:20,tamanho_lote:100,total_inspecionado:0,total_nao_conforme:0,grupos_inspecao:{id:'qa-g2',tipo:'kit_componentes',processo_id:'qa-p1',subprocesso_codigo:'B',processos:{codigo:'FST99991',cliente:'Cliente QA'}}},items:[]}))
 await page.route('https://sgq-api.qa.invalid/api/inspecoes/qa-i2/reclassificar',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers})
  const body=route.request().postDataJSON()
  if(body.modo==='contexto')return reply(route,{fst:'FST99991',tipo:'kit_componentes',it:version,nivel:'II',entradas:[{id:'qa-i2',entrada:'B',tipo:'kit_componentes',status:'aberta',bloqueio:null,skus:products}]})
  expect(body.modo).toBe('separar')
  expect(body.confirmacao).toBeUndefined()
  return reply(route,{confirmacao:'qa-preview',aviso:'Cadastro reaproveitado',originais:['qa-i2'],destinos:products.map((p,i)=>({entrada:i?'C':'B',sku:p.sku,nome:p.nome,nivel:'II',plano:{lote:p.quantidade,amostra:i?32:20,ac:1,re:2}}))})
 })
 await page.getByRole('button',{name:/Histórico/}).click()
 await page.getByRole('button',{name:'Ver inspeção',exact:true}).click()
 await page.getByRole('button',{name:'Alterar classificação dos SKUs',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Alterar classificação dos SKUs'})
 await expect(dialog).toBeVisible()
 await expect(dialog.getByText('Separar os SKUs em inspeções independentes')).toBeVisible()
 await dialog.getByRole('button',{name:'Conferir nova classificação'}).click()
 await expect(dialog.getByText('Entrada C · QA-KIT-B')).toBeVisible()
 await expect(dialog.getByRole('button',{name:'Aplicar correção'})).toBeDisabled()
 await dialog.getByLabel('Motivo da correção').fill('Classificação anterior incorreta')
 await dialog.getByRole('checkbox',{name:/Confirmo que os SKUs/}).check()
 await expect(dialog.getByRole('button',{name:'Aplicar correção'})).toBeEnabled()
 await dialog.getByRole('button',{name:'Cancelar',exact:true}).click()
 await expect(dialog).toHaveCount(0)
})
