import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const page=read('src/equipamentos/EquipmentPage.tsx')
const eligibility=read('src/equipamentos/equipmentData.ts')

test('equipment list has no calibration alert banner',()=>{
  assert.doesNotMatch(page,/Atenção à calibração:/)
  assert.doesNotMatch(page,/Instrumentos vencidos ou sem data não ficam disponíveis/)
  assert.doesNotMatch(page,/equipment-alerts/)
})

test('Ativo is restricted to calibrated or explicitly exempt operational equipment',()=>{
  assert.match(eligibility,/export function equipmentOperationalStatus\(e:Equipment/)
  assert.match(eligibility,/if\(e.estado!=='ativo'\) return e.estado/)
  assert.match(eligibility,/if\(e.requer_calibracao===false\) return 'ativo'/)
  assert.match(eligibility,/if\(e.requer_calibracao===true && e.proxima_calibracao && e.proxima_calibracao.slice\(0,10\)>=now\) return 'ativo'/)
  assert.match(eligibility,/return 'calibracao_pendente'/)
  assert.match(eligibility,/if\(equipmentOperationalStatus\(e\)!=='ativo'\) return false/)
  assert.match(page,/const operationalStatus=equipmentOperationalStatus\(e,today\)/)
  assert.match(page,/operationalStatus==='calibracao_pendente'\?'Calibração pendente'/)
  assert.match(page,/operationalStatus==='ativo'\?'Ativo'/)
  assert.match(page,/equipments.filter\(e=>equipmentOperationalStatus\(e,today\)==='ativo'\)/)
})

test('equipment exemption flag is explicit and new items require calibration by default',()=>{
  assert.match(page,/requer_calibracao:true,ultima_calibracao:null/)
  assert.match(page,/checked=\{editing.requer_calibracao===false\}/)
  assert.match(page,/requer_calibracao:!e.target.checked/)
  assert.match(page,/Não precisa de calibração/)
  assert.match(eligibility,/America\/Sao_Paulo/)
  assert.match(page,/authClient.from\('sgq_equipamentos'\)/)
  assert.match(page,/authClient.from\('sgq_equipamento_eventos'\)/)
})
