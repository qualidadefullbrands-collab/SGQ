import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')

test('subprocess keeps inherited values as separate reference, never copied implicitly',()=>{
  const reuse=app.split('function reuseProcess(p: ProcessRow)')[1]?.split('async function editInspectionFull')[0]||''
  assert.match(reuse,/setInheritedReference\(reference\)/)
  assert.match(reuse,/notaFiscal:'',/)
  assert.match(reuse,/origem:'',/)
  assert.match(reuse,/transporte:'',/)
  assert.match(reuse,/chegadaCd:'',/)
  assert.match(reuse,/source\?\.nota_fiscal/)
  assert.match(reuse,/source\?\.subprocesso_codigo/)
  assert.match(reuse,/const quantity=items\.reduce/)
  assert.match(reuse,/const boxes=items\.reduce/)
})

test('first subprocess is a clear read-only reference with optional explicit use of logistics',()=>{
  assert.match(app,/Herdado de referência · Subprocesso/)
  assert.match(app,/Valores informativos da primeira inspeção/)
  assert.match(app,/Nada é copiado ou salvo automaticamente/)
  assert.match(app,/NF, datas, quantidade e caixas pertencem exclusivamente/)
  assert.match(app,/Usar referência de origem, transporte e chegada/)
  assert.match(app,/origem:current\.origem\|\|inheritedReference\.origin/)
  assert.match(app,/transporte:current\.transporte\|\|inheritedReference\.transport/)
  assert.match(app,/chegadaCd:current\.chegadaCd\|\|inheritedReference\.arrival/)
})

test('manual invoice and editable child quantities never inherit sibling data by default',()=>{
  const create=app.split('function reuseProcess(p: ProcessRow)')[1]?.split('async function editInspectionFull')[0]||''
  assert.doesNotMatch(create,/notaFiscal:\s*source\?\./)
  assert.match(create,/setSkuRows\(\[emptySku\(\)\]\)/)
  assert.match(app,/NF do subprocesso \{inspection\.subprocessoCodigo\}/)
  assert.match(app,/onChange=\{\(e\)=>\{autoNfeRef\.current=null;setInspection/)
})
