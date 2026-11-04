export type InsightRow={
  inspectionId:string; inspectionNumber:string; status:string; date:string
  fst:string; client:string; pv:string; sku:string; product:string
  ordered:number|null; received:number; difference:number|null
  evidence:'verified'|'missing'|'ambiguous'
}
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0
export function inspectionInsightRows(inspections:any[],links:any[]):InsightRow[]{
  const byGroup=new Map<string,any[]>()
  for(const link of links){
    const group=String(link?.grupo_inspecao_id||'')
    if(!group)continue
    const existing=byGroup.get(group)||[]
    existing.push(link);byGroup.set(group,existing)
  }
  const result:InsightRow[]=[]
  for(const inspection of inspections){
    const group=inspection?.grupos_inspecao
    const process=group?.processos
    if(!group||!process||process.excluido_em)continue
    const bySku=new Map<string,any[]>()
    for(const link of byGroup.get(group.id)||[]){
      const item=link.processo_itens
      const sku=String(item?.produtos?.sku||'').trim()
      if(!sku)continue
      const batch=bySku.get(sku)||[]
      batch.push(item);bySku.set(sku,batch)
    }
    for(const [sku,items] of bySku){
      // Same SKU may be split in lots, but each lot carries the same original
      // PV quantity. The ordered quantity is counted only once per inspection.
      const snapshots=items.filter(row=>row.quantidade_pv!=null&&String(row.pv_numero||'').trim())
      const unique=new Set(snapshots.map(row=>String(row.pv_numero)+'|'+Number(row.quantidade_pv)))
      const evidence=snapshots.length===0?'missing':unique.size===1?'verified':'ambiguous'
      const ordered=evidence==='verified'?number(snapshots[0].quantidade_pv):null
      const received=items.reduce((sum,row)=>sum+number(row.quantidade),0)
      const difference=ordered===null?null:received-ordered
      result.push({
        inspectionId:String(inspection.id||''),inspectionNumber:String(inspection.numero||''),
        status:String(inspection.status||''),date:String(inspection.criado_em||''),
        fst:String(process.codigo||''),client:String(process.cliente||''),
        pv:evidence==='verified'?String(snapshots[0].pv_numero):'',
        sku,product:String(items[0].produtos?.nome||''),
        ordered,received,difference,evidence,
      })
    }
  }
  return result
}
