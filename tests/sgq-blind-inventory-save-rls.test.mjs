import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const page=source('src/stock/BlindInventoryPage.tsx')
const panel=source('src/stock/BlindInventoryProcessPanel.tsx')
const errors=source('src/stock/blindInventoryErrors.ts')
const main=source('src/main.tsx')
const sw=source('public/sw.js')

test('both blind count flows submit the respective fields required by Supabase RLS',()=>{
 for(const part of [
  'processo_id:linkedProcess?.processoId||null',
  'processo_codigo:linkedProcess?.processoCodigo||null',
  'cliente_nome:linkedProcess?.clienteNome||null',
  'cliente_confirmado:!!linkedProcess',
  'verificacao_cadastro:linkedProcess?.verificacao||{',
  "modo:'codigo_omie'",'inventario_id:active.id','criado_por:user.id']){
   assert.ok(page.includes(part),part)
 }
 assert.ok(page.includes("if(lookupMode==='processo'&&(!processContext"))
 assert.ok(page.includes('locations.includes(address)'))
})

test('invalid JSON-like error objects are readable and RLS reveals update instructions',()=>{
 assert.ok(errors.includes("code==='42501'"))
 assert.ok(errors.includes('Atualize o SGQ'))
 assert.ok(errors.includes('if(message)return'))
 assert.ok(errors.includes('JSON.stringify(error)'))
 assert.ok(page.includes("import {blindInventoryError}"))
 assert.ok(panel.includes("import {blindInventoryError}"))
 assert.ok(page.includes("Atualizar SGQ agora"))
 assert.ok(!page.includes("error instanceof Error?error.message:String(error||"))
})

test('new SGQ frontend tells long-lived tabs to reload after PWA update',()=>{
 assert.ok(sw.includes('sgq-shell-v5-20261113-blind-inventory-save'))
 assert.ok(main.includes("register('/sw.js',{updateViaCache:'none'})"))
 assert.ok(main.includes("addEventListener('controllerchange'"))
 assert.ok(main.includes('showSgqUpdateNotice'))
 assert.ok(main.includes('Uma atualização do SGQ está disponível'))
 assert.ok(main.includes('window.setInterval(check,180000)'))
})
