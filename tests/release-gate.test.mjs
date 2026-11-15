import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessRelease, REQUIRED_MAIN_CHECKS, REQUIRED_PR_CHECKS } from './qa/release-gate.mjs'
const SHA='a'.repeat(40), HEAD='b'.repeat(40)
function passedChecks(names) { return names.map(name=>({name,status:'completed',conclusion:'success'})) }
function base() { return {
  candidateSha:SHA, mainSha:SHA,
  mergedPr:{number:92,merged_at:'2026-11-15T01:48:06Z',merge_commit_sha:SHA,base:{ref:'main'},head:{sha:HEAD},user:{login:'sgq-author'}},
  prReviews:[{user:{login:'sgq-reviewer'},state:'APPROVED',commit_id:HEAD,submitted_at:'2026-11-15T09:30:00Z'}],
  mainChecks:passedChecks(REQUIRED_MAIN_CHECKS),prChecks:passedChecks(REQUIRED_PR_CHECKS),
  frontendDeploy:{status:'live',commit:{id:SHA}},apiDeploy:{status:'live',commit:{id:SHA}},
  smokePassed:true,operationalApproved:true,homologationReference:'SGQ-QUAL-2026-11-15',
} }
test('GO somente quando todas as evidências correspondem ao SHA',()=>{
  const result=assessRelease(base())
  assert.equal(result.decision,'GO_TECNICO_COM_ATESTADO')
  assert.deepEqual(result.blockers,[])
})
test('NO-GO com frontend em SHA antigo',()=>{
  const v=base();v.frontendDeploy.commit.id=HEAD
  assert.match(assessRelease(v).blockers.join(' '),/Frontend Render/)
})
test('NO-GO se API está em build',()=>{
  const v=base();v.apiDeploy.status='build_in_progress'
  assert.match(assessRelease(v).blockers.join(' '),/API Render/)
})
test('NO-GO se candidato difere de main',()=>{
  const v=base();v.mainSha=HEAD
  assert.match(assessRelease(v).blockers.join(' '),/HEAD atual/)
})
test('NO-GO sem PR correspondente ao merge',()=>{
  const v=base();v.mergedPr.merge_commit_sha=HEAD
  assert.match(assessRelease(v).blockers.join(' '),/PR revisável/)
})
test('NO-GO se checks de E2E faltam (não tratar SKIP como PASS)',()=>{
  const v=base();v.prChecks=v.prChecks.filter(x=>x.name!=='JWT real → PostgREST/RLS + Storage → API .NET → Word')
  assert.match(assessRelease(v).blockers.join(' '),/JWT real/)
})
test('NO-GO quando CI teve falha',()=>{
  const v=base();v.mainChecks[0].conclusion='failure'
  assert.match(assessRelease(v).blockers.join(' '),/main: frontend/)
})
test('NO-GO quando smoke falhou',()=>{
  const v=base();v.smokePassed=false
  assert.match(assessRelease(v).blockers.join(' '),/Smoke público/)
})
test('NO-GO sem homologação funcional atestada',()=>{
  const v=base();v.operationalApproved=false
  assert.match(assessRelease(v).blockers.join(' '),/Homologação operacional/)
})
test('NO-GO sem referência de homologação',()=>{
  const v=base();v.homologationReference=''
  assert.match(assessRelease(v).blockers.join(' '),/Homologação operacional/)
})
test('NO-GO se check está ignorado',()=>{
  const v=base();const check=v.prChecks.find(x=>x.name==='Chromium desktop e mobile · dados sintéticos');check.conclusion='skipped'
  assert.match(assessRelease(v).blockers.join(' '),/Chromium desktop/)
})

test('NO-GO sem revisão independente',()=>{
  const v=base();v.prReviews=[]
  assert.match(assessRelease(v).blockers.join(' '),/aprovação independente/)
})
test('NO-GO com autoaprovação pelo autor',()=>{
  const v=base();v.prReviews=[{user:{login:'sgq-author'},state:'APPROVED',commit_id:HEAD,submitted_at:'2026-11-15T09:30:00Z'}]
  assert.match(assessRelease(v).blockers.join(' '),/aprovação independente/)
})
test('NO-GO se aprovação pertence a SHA anterior',()=>{
  const v=base();v.prReviews[0].commit_id=SHA
  assert.match(assessRelease(v).blockers.join(' '),/aprovação independente/)
})
test('NO-GO com nova revisão solicitando alterações',()=>{
  const v=base();v.prReviews.push({user:{login:'sgq-reviewer'},state:'CHANGES_REQUESTED',commit_id:HEAD,submitted_at:'2026-11-15T10:00:00Z'})
  assert.match(assessRelease(v).blockers.join(' '),/aprovação independente/)
})
