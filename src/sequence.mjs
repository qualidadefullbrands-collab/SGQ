export function sequentialProductInfo(inspection, all) {
  const metadata=inspection.parametros_amostragem
  const batch=metadata?.lote_sequencial
  if(!batch)return {blocked:false,order:1,total:1,previous:null}
  const order=Number(metadata?.ordem_produto||1),total=Number(metadata?.total_produtos||1)
  const prior=all.filter(x=>x.parametros_amostragem?.lote_sequencial===batch
    &&Number(x.parametros_amostragem?.ordem_produto||0)<order)
  const pending=prior.filter(x=>x.status!=='concluida')
    .sort((a,b)=>Number(a.parametros_amostragem?.ordem_produto||0)-Number(b.parametros_amostragem?.ordem_produto||0))
  const previous=pending[0]||null
  return {blocked:previous!==null||prior.length<order-1,order,total,previous}
}
