import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=src('src/App.tsx')
const audits=src('src/auditorias/AuditoriasPage.tsx')
const styles=src('src/auditorias/auditorias.css')
const catalog=src('src/auditorias/catalog.ts')
const api=src('backend/Sgq.Api/Program.cs')

test('one authenticated SGQ shell, without environment selection screen',()=>{
  assert.doesNotMatch(app,/if \(!environment\)|environment-picker|environment==='contlog'|Trocar ambiente/)
  assert.match(app,/if \(!profile\) return/)
  assert.match(app,/sgq-operational-shell/)
})

test('Inspeções Armazém is directly below Estoque in main side navigation',()=>{
  const stock=app.indexOf("> Estoque</button>")
  const warehouse=app.indexOf("> Inspeções Armazém</button>")
  const quality=app.indexOf('QUALIDADE</div>',stock)
  assert.ok(stock>0&&warehouse>stock&&quality>warehouse,'warehouse nav must be below stock and above quality grouping')
  assert.match(app,/tab==='auditorias' && \(/)
  assert.match(app,/<AuditoriasPage profileName=\{profile\.nome\}\/>/)
})

test('Contlog work continues through same secured API and original storage buckets',()=>{
  for(const route of ['/api/auditorias/bootstrap','/api/auditorias/criar','/api/auditorias/','/api/auditorias/templates/'])
    assert.ok(audits.includes(route),'Missing '+route)
  for(const bucket of ['auditoria-modelos','auditoria-evidencias'])
    assert.ok(audits.includes(bucket),'Missing bucket '+bucket)
  assert.match(api,/app\.MapGet\("\/api\/auditorias\/bootstrap"/)
  assert.match(api,/app\.MapPost\("\/api\/auditorias\/criar"/)
})

test('all four warehouse forms remain available',()=>{
  for(const code of ["'RQ014'","'RQ015'","'RQ016'","'RQ016B'"])
    assert.ok(catalog.includes(code),'Missing '+code)
})

test('warehouse has matching dashboard and mobile editing layout',()=>{
  assert.match(audits,/Inspeções Armazém/)
  assert.match(audits,/audit-overview/)
  assert.match(audits,/audit-history-search/)
  assert.match(styles,/\.sgq-operational-shell \.audit-composer\{[^}]*left:248px/)
  assert.match(styles,/@media\(max-width:850px\)/)
})

test('camera, voice, Word generation and checklist are preserved',()=>{
  assert.match(audits,/capture="environment"/)
  assert.match(audits,/startVoice/)
  assert.match(audits,/generateWord/)
  assert.match(audits,/saveManualAnswer/)
  assert.match(audits,/confirmFinish/)
})
