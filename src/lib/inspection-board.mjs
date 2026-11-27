/** Index active inspections in one traversal, retaining each inspection identity. */
export function indexActiveInspections(inspections) {
  const byProcess = new Map()
  for (const inspection of inspections) {
    if (inspection.status === 'cancelada') continue
    const id = inspection.grupos_inspecao?.processo_id
    if (!id) continue
    const group = byProcess.get(id)
    if (group) group.push(inspection)
    else byProcess.set(id, [inspection])
  }
  return byProcess
}

/** Operational workspace owns its search; legacy embedded panel follows its parent. */
export function workspaceQuery(mode, localQuery, externalQuery) {
  return mode === 'panel' ? (externalQuery ?? '') : localQuery
}

/** Completed/cancelled inspections are not eligible for operational status changes. */
export function canTransitionInspection(status, allowed, busy) {
  return allowed && !busy && (status === 'aberta' || status === 'em_andamento')
}

/** Continue active work before starting new work; completed work is history. */
export function workQueueCounts(items) {
  const active=items.filter(x=>x.status!=='cancelada')
  const aberta=active.filter(x=>x.status==='aberta').length
  const em_andamento=active.filter(x=>x.status==='em_andamento').length
  const concluida=active.filter(x=>x.status==='concluida').length
  return {aberta,em_andamento,concluida,pendentes:active.length-concluida,todas:active.length}
}
export function workQueue(items,filter) {
  const rows=items.filter(x=>x.status!=='cancelada'&&(filter==='todas'||(filter==='pendentes'?x.status!=='concluida':x.status===filter)))
  const priority=x=>x.status==='em_andamento'?0:x.status==='aberta'?1:x.status==='concluida'?3:2
  return rows.sort((a,b)=>priority(a)-priority(b)||(a.status==='concluida'?-1:1)*String(a.criado_em||'').localeCompare(String(b.criado_em||'')))
}
