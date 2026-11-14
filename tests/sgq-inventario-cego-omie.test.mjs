import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const load=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const app=load('src/App.tsx')
const navigation=load('src/stock/StockWorkspaceNav.tsx')
const blind=load('src/stock/BlindInventoryPage.tsx')
const existing=load('src/stock/InventoryPanel.tsx')
const sql=load('supabase/migrations/20261113080000_sgq_inventario_cego_omie_fotos.sql')
const edge=load('supabase/functions/sgq-inventario-omie/index.ts')

test('stock preserves previous inventory and adds a separate blind Omie mode',()=>{
 assert.match(app,/import BlindInventoryUnified from '\.\/stock\/BlindInventoryUnified'/)
 assert.match(app,/stockMode==='cego'&&<BlindInventoryUnified/)
 assert.match(navigation,/Contagem FST/)
 assert.match(app,/stockMode==='inventario'&&<InventoryPanel/)
 assert.match(existing,/saldo_sistema/)
})

test('operator cannot see or fetch system stock levels in blind screen',()=>{
 assert.match(blind,/sgq_inventarios_cegos/)
 assert.match(blind,/sgq_inventario_cego_itens/)
 assert.doesNotMatch(blind,/saldo_sistema|quantidade_esperada|estoque_disponivel|diferenca_estoque/)
 assert.doesNotMatch(sql,/saldo_sistema|quantidade_esperada/)
 assert.match(sql,/foto_sgq_path/)
 assert.match(blind,/Sem saldo do sistema/)
 assert.match(blind,/Contagem física/)
})

test('product identity is verified against Omie by code before saving count',()=>{
 assert.match(blind,/apiPost<Product>\('\/api\/estoque\/validar-sku'/)
 assert.match(blind,/if\(!active\|\|active\.status!=='aberto'\|\|!canWrite\|\|!product\|\|busy\)return/)
 assert.match(blind,/quantidade_contada:numeric/)
 assert.match(blind,/quantidade_contada:number/)
 assert.match(blind,/\^\\d\+\(\?:\[\.,\]\\d\{1,3\}\)\?\$/)
 assert.match(blind,/Já existe contagem para este código\/endereço/)
})

test('image is private and marking photo never directly updates Omie',()=>{
 assert.match(blind,/const bucket='sgq-inventario-cego'/)
 assert.match(blind,/capture="environment"/)
 assert.match(blind,/foto_para_omie:flagOmie/)
 assert.match(blind,/Aguardando aprovação/)
 assert.match(blind,/apiPost<\{found:boolean;productId:string\}>\('\/api\/produtos\/consultar'/)
 assert.match(blind,/foto_principal_path:photoLocalPath/)
 assert.match(blind,/sgq-inventario-omie/)
 assert.match(blind,/Abra e confira a foto antes de aprovar/)
 assert.match(blind,/active\.status!=='fechado'\|\|!canApprove/)
 assert.doesNotMatch(blind,/AlterarProduto/)
})

test('Omie image sync is manager-only, preserves old photos and confirms readback',()=>{
 assert.match(edge,/\['administrador','gestor'\]/)
 assert.match(edge,/session\?\.status!=='fechado'/)
 assert.match(edge,/item\.foto_para_omie/)
 assert.match(edge,/ConsultarProduto/)
 assert.match(edge,/AlterarProduto/)
 assert.match(edge,/retained\.filter/)
 assert.match(edge,/verified\.imagens/)
 assert.match(edge,/foto_omie_sincronizada_em/)
 assert.match(edge,/sgq_inventario_cego_foto_logs/)
 assert.doesNotMatch(edge,/AjusteEstoque|IncluirAjuste|AlterarSaldo/)
})

test('new tables have RLS and product image cannot be published directly by an inspector',()=>{
 for(const name of ['sgq_inventarios_cegos','sgq_inventario_cego_itens','sgq_inventario_cego_foto_logs'])
  assert.match(sql,new RegExp('alter table public\\.'+name+' enable row level security'))
 assert.match(sql,/private\.current_sgq_role\(\)/)
 assert.match(sql,/sgq-inventario-cego',false/)
 assert.match(sql,/sgq-catalogo-omie',true/)
 assert.match(sql,/foto_status text not null default 'pendente'/)
 assert.doesNotMatch(sql,/grant update\(foto_status/)
 assert.doesNotMatch(sql,/on storage\.objects\s*for insert to authenticated[\s\S]*bucket_id='sgq-catalogo-omie'/)
})
