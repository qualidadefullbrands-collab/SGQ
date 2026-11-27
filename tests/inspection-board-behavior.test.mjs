import test from 'node:test'
import assert from 'node:assert/strict'
import {indexActiveInspections,workspaceQuery,canTransitionInspection} from '../src/lib/inspection-board.mjs'

test('process index keeps separate inspections in a shared FST, excludes cancelled or unlinked entries, and never mutates inputs',()=>{
  const items=Object.freeze([
    Object.freeze({id:'i1',status:'aberta',grupos_inspecao:{processo_id:'fst1'}}),
    Object.freeze({id:'i2',status:'concluida',grupos_inspecao:{processo_id:'fst1'}}),
    Object.freeze({id:'i3',status:'em_andamento',grupos_inspecao:{processo_id:'fst2'}}),
    Object.freeze({id:'cancelled',status:'cancelada',grupos_inspecao:{processo_id:'fst1'}}),
    Object.freeze({id:'unlinked',status:'aberta',grupos_inspecao:null}),
  ])
  const indexed=indexActiveInspections(items)
  assert.deepEqual([...indexed.keys()],['fst1','fst2'])
  assert.deepEqual(indexed.get('fst1').map(x=>x.id),['i1','i2'])
  assert.equal(indexed.get('fst2')[0],items[2])
  assert.equal(items.length,5)
})

test('process index traverses input once even with thousands of distinct processes',()=>{
  let accesses=0
  const items=Array.from({length:4000},(_,i)=>({
    id:String(i),status:'aberta',get grupos_inspecao(){accesses++;return {processo_id:'fst'+i}}
  }))
  const indexed=indexActiveInspections(items)
  assert.equal(indexed.size,4000)
  assert.equal(accesses,4000)
})

test('workspace search clears independently and embedded panel follows changes from dashboard',()=>{
  assert.equal(workspaceQuery('page','NF 123','previous'), 'NF 123')
  assert.equal(workspaceQuery('page','','previous'), '')
  assert.equal(workspaceQuery('panel','old','SKU-A'), 'SKU-A')
  assert.equal(workspaceQuery('panel','old',''), '')
  assert.equal(workspaceQuery('panel','old',undefined), '')
})

test('status transition guard rejects terminal and unknown statuses, unauthorized users and concurrent moves',()=>{
  for(const status of ['aberta','em_andamento']) {
    assert.equal(canTransitionInspection(status,true,false),true)
    assert.equal(canTransitionInspection(status,false,false),false)
    assert.equal(canTransitionInspection(status,true,true),false)
  }
  for(const status of ['concluida','cancelada','unknown']) assert.equal(canTransitionInspection(status,true,false),false)
})
