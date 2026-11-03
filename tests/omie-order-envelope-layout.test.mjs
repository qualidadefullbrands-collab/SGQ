import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const edge=read('supabase/functions/sgq-omie-fst/index.ts')
const app=read('src/App.tsx')
const css=read('src/styles.css')

test('Omie ConsultarPedido official envelope is unwrapped before reading cabecalho or det',()=>{
  const match=edge.match(/function unwrapOmiePedido\(response:any\):any\|null\{([\s\S]*?)\n\}/)
  assert.ok(match,'Edge must implement an explicit response normalizer')
  const unwrap=new Function('response',match[1])
  const pedido={
    cabecalho:{codigo_pedido:2929788435,codigo_cliente:2929787771,numero_pedido:'1038'},
    det:[
      {produto:{codigo:'EMB277247003',descricao:'Embalagem Cushion - Anel Interior',quantidade:1000}},
      {produto:{codigo:'EMB277247002',descricao:'Embalagem Cushion - Recarga Interna',quantidade:1000}}
    ]
  }
  // Real contract documented by Omie: ConsultarPedido returns pedido_venda_produto.
  assert.deepEqual(unwrap({pedido_venda_produto:pedido}),pedido)
  assert.deepEqual(unwrap(pedido),pedido,'keep legacy direct-format compatibility')
  assert.deepEqual(unwrap({pedido_venda_produto:[pedido]}),pedido,'tolerate single-item array')
  assert.equal(unwrap(null),null)
  assert.equal(unwrap({}),null)
  assert.match(edge,/const resolvedOrder=unwrapOmiePedido\(orderDetail\)/)
  assert.match(edge,/Number\(resolvedOrder\?\.cabecalho\?\.codigo_pedido\)===chosen\.codigoPedido/)
  assert.match(edge,/Number\(resolvedOrder\?\.cabecalho\?\.codigo_cliente\)===clientCode/)
  assert.match(edge,/const itens=detailMatches\?extractItems\(resolvedOrder\):\[\]/)
  assert.match(edge,/const order=unwrapOmiePedido\(await omie\(ordersUrl,"ConsultarPedido"/)
})
test('SGQ first-row FST and client inputs align even when lookup status grows',()=>{
 const first=app.indexOf('<div className="sgq-fst-field">')
 const second=app.indexOf('<label>Cliente<input',first)
 assert.ok(first>=0&&second>first)
 const fragment=app.slice(first,second)
 assert.match(fragment,/<label htmlFor="sgq-fst-input">Processo<\/label>/)
 assert.match(fragment,/className="sgq-fst-controls"/)
 assert.match(fragment,/id="sgq-fst-input"/)
 assert.match(fragment,/className="secondary sgq-fst-retry"/)
 assert.match(fragment,/onClick=\{\(\)=>void lookupFstClient\(inspection\.codigo\)\}/)
 assert.match(fragment,/role="status"/)
 assert.match(css,/\.inspection-form \.form-grid > label \{\s*min-width:0;\s*align-content:start;\s*grid-auto-rows:max-content;/)
 assert.match(css,/\.inspection-form \.form-grid > \.sgq-fst-field \{[\s\S]*?align-content:start;/)
 assert.match(css,/\.sgq-fst-controls \{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto;/)
 assert.doesNotMatch(fragment,/<label>Processo/)
})
