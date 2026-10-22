import test from 'node:test'
import assert from 'node:assert/strict'
import {sequentialProductInfo} from '../src/sequence.mjs'
const make=(batch,order,status='aberta',total=3)=>({status,parametros_amostragem:{lote_sequencial:batch,ordem_produto:order,total_produtos:total}})
test('inspeção histórica sem sequência permanece independente',()=>{
  const normal={status:'aberta',parametros_amostragem:null}
  assert.equal(sequentialProductInfo(normal,[]).blocked,false)
})
test('primeiro produto fica liberado',()=>{
  assert.equal(sequentialProductInfo(make('a',1),[]).blocked,false)
})
test('segundo produto aguarda conclusão do primeiro',()=>{
  const a=make('a',1,'em_andamento'),b=make('a',2)
  assert.equal(sequentialProductInfo(b,[a,b]).blocked,true)
})
test('segundo produto pode começar após a conclusão do primeiro',()=>{
  const a=make('a',1,'concluida'),b=make('a',2)
  assert.equal(sequentialProductInfo(b,[a,b]).blocked,false)
})
test('terceiro aguarda dois predecessores concluídos',()=>{
  const a=make('a',1,'concluida'),b=make('a',2,'em_andamento'),c=make('a',3)
  assert.equal(sequentialProductInfo(c,[a,b,c]).blocked,true)
})
test('etapa anterior ausente não é tratada como concluída',()=>{
  const c=make('a',3),a=make('a',1,'concluida')
  assert.equal(sequentialProductInfo(c,[a,c]).blocked,true)
})
test('lotes não se bloqueiam entre si',()=>{
  const a=make('a',1,'em_andamento'),b=make('b',1,'concluida'),c=make('b',2)
  assert.equal(sequentialProductInfo(c,[a,b,c]).blocked,false)
})
