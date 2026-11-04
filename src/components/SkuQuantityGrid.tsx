import './SkuQuantityGrid.css'

// One row per process item (including separate lots of the same SKU).
// The parent retains the existing business rules for distribution and sampling.
type Row=Record<string,any>
type Props={
  rows:Row[]
  onChange:(index:number,key:string,value:string)=>void
  onAdd?:()=>void
}
const fields=[
  {key:'quantidade',label:'Peças recebidas'},
  {key:'caixasRecebidas',label:'Caixas recebidas'},
  {key:'caixasInspecionadas',label:'Caixas inspecionadas'},
  {key:'caixasPadrao',label:'Caixas padrão'},
  {key:'unidadesPadrao',label:'Peças / cx padrão'},
  {key:'caixasFracionadas',label:'Caixas fracionadas'},
  {key:'unidadesFracionadas',label:'Peças / cx fração'},
  {key:'unidadesLaboratorio',label:'Peças laboratório'},
  {key:'unidadesPorConjunto',label:'Un. / conjunto'}
] as const
function number(value:any){return Number(value)||0}
function distribution(row:Row){
  const padrao=number(row.caixasPadrao)*number(row.unidadesPadrao||row.quantidadePorCaixa)
  const fracao=number(row.caixasFracionadas)*number(row.unidadesFracionadas)
  const lab=number(row.unidadesLaboratorio)+(number(row.caixasLaboratorio)*number(row.quantidadePorCaixa))
  return padrao+fracao+lab
}
function isFilled(row:Row){
  return Number(row.caixasPadrao)>0||Number(row.caixasFracionadas)>0||Number(row.unidadesLaboratorio)>0||
    Number(row.caixasLaboratorio)>0
}
export default function SkuQuantityGrid({rows,onChange,onAdd}:Props){
  return <div className="sgq-sku-grid-shell">
    <div className="sgq-sku-grid-scroll" role="region" aria-label="Tabela de todos os SKUs da inspeção" tabIndex={0}>
      <table className="sgq-sku-grid">
        <thead><tr>
          <th scope="col">SKU</th><th scope="col">Descrição</th><th scope="col">Lote</th>
          <th scope="col">Material</th><th scope="col">Capacidade</th>
          <th scope="col">PV (referência)</th>
          {fields.map(col=><th key={col.key} scope="col">{col.label}</th>)}
          <th scope="col">Conferência</th>
        </tr></thead>
        <tbody>{rows.map((row,index)=>{
          const sku=String(row.sku||'Novo SKU')
          const total=distribution(row),delta=total-number(row.quantidade)
          const mismatch=isFilled(row)&&Math.abs(delta)>0.0001
          return <tr key={row.processoItemId||index} data-mismatch={mismatch?'true':'false'}>
            {(['sku','nome','lote','material','capacidade'] as const).map(key=><td key={key}>
              <input type="text" aria-label={key+' · '+sku} title={key+' · '+sku}
                value={row[key]??''} onChange={e=>onChange(index,key,e.target.value)}/>
            </td>)}
            <td className="sgq-sku-grid-pv" title={row.numeroPedidoPv?'PV '+row.numeroPedidoPv:'Sem referência do PV'}>
              {row.quantidadePv==null||row.quantidadePv===''?'—':number(row.quantidadePv).toLocaleString('pt-BR')}
            </td>
            {fields.map(col=><td key={col.key}>
              <input type="number" min="0" step="0.01" inputMode="decimal"
                aria-label={col.label+' · '+sku} title={col.label+' · '+sku}
                value={col.key==='unidadesPadrao'?(row.unidadesPadrao||row.quantidadePorCaixa||''):(row[col.key]??'')}
                onChange={e=>onChange(index,col.key,e.target.value)}/>
            </td>)}
            <td><span className={mismatch?'sgq-sku-grid-bad':'sgq-sku-grid-ok'}>
              {isFilled(row)?(mismatch?'Dif. '+delta.toLocaleString('pt-BR'):'OK'):'—'}
            </span></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {onAdd&&<button type="button" className="secondary small" onClick={onAdd}>+ Adicionar SKU</button>}
  </div>
}
