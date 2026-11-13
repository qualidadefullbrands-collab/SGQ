import {useEffect,useState} from 'react'
import {AlertTriangle,CheckCircle2,RefreshCw} from 'lucide-react'
import {authClient} from '../lib/supabase'
import './InventoryOmieComparison.css'

export type OmieCheck={
 ok?:boolean;skuInformado:string;situacao:'encontrado'|'codigo_divergente'|'nao_localizado'|'indisponivel';
 codigoOmie:string|null;descricaoOmie:string|null
}
const key=(value:string)=>value.trim().toUpperCase()
const desc=(value:string)=>value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .replace(/\s+/g,' ').toUpperCase()
const cache=new Map<string,{at:number;job:Promise<OmieCheck>}>()
let active=0
const pending:Array<()=>void>=[]
async function bounded<T>(job:()=>Promise<T>):Promise<T>{
 if(active>=3)await new Promise<void>(resolve=>pending.push(resolve))
 active++
 try{return await job()}
 finally{active--;pending.shift()?.()}
}
function verifySku(sku:string,force=false):Promise<OmieCheck>{
 const code=key(sku)
 const cached=cache.get(code)
 if(!force&&cached&&Date.now()-cached.at<120000)return cached.job
 const job=bounded(async()=>{
  const {data,error}=await authClient.functions.invoke('sgq-inventario-cadastro-omie',{body:{codigo:code}})
  const result=data as OmieCheck|null
  if(error||!result?.ok||result.skuInformado!==code){
   throw new Error('Não foi possível consultar o cadastro Omie neste momento.')
  }
  return result
 }).catch(()=>({ok:false,skuInformado:code,situacao:'indisponivel',
  codigoOmie:null,descricaoOmie:null} as OmieCheck))
 cache.set(code,{at:Date.now(),job})
 return job
}
export default function InventoryOmieComparison({sku,descricao}:{
 sku:string;descricao:string
}){
 const [result,setResult]=useState<OmieCheck|null>(null)
 const [checking,setChecking]=useState(true)
 const [retry,setRetry]=useState(0)
 useEffect(()=>{
  let alive=true
  setChecking(true);setResult(null)
  void verifySku(sku,retry>0).then(value=>{if(alive){setResult(value);setChecking(false)}})
  return ()=>{alive=false}
 },[sku,retry])
 const wrongCode=result?.situacao==='codigo_divergente'||
  (result?.situacao==='encontrado'&&key(result.codigoOmie||'')!==key(sku))
 const wrongDescription=!!result?.descricaoOmie&&['encontrado','codigo_divergente'].includes(result.situacao)&&
  desc(result.descricaoOmie)!==desc(descricao)
 const missing=result?.situacao==='nao_localizado'
 const unavailable=result?.situacao==='indisponivel'
 const mismatch=wrongCode||wrongDescription||missing
 return <div className={'sgq-omie-comparison'+(mismatch?' mismatch':'')}>
  <div className="sgq-omie-comparison-head">
   {checking?<span><RefreshCw size={13}/> Consultando cadastro no Omie…</span>:
    mismatch?<span className="sgq-omie-comparison-alert"><AlertTriangle size={14}/>
     Divergência cadastral no Omie</span>:
    unavailable?<span><AlertTriangle size={14}/> Não foi possível consultar o Omie</span>:
    <span className="sgq-omie-comparison-ok"><CheckCircle2 size={14}/> Código e descrição conferidos</span>}
   <button type="button" className="secondary small" disabled={checking}
    onClick={()=>setRetry(x=>x+1)} title="Consultar novamente o cadastro">Reconsultar</button>
  </div>
  {result&&<div className="sgq-omie-comparison-values">
   <div><small>Código registrado</small><b>{sku}</b></div>
   <div><small>Código Omie</small><b>{result.codigoOmie||'Não disponível'}</b></div>
   <div><small>Descrição registrada</small><span>{descricao}</span></div>
   <div><small>Descrição Omie</small><span>{result.descricaoOmie||'Não disponível'}</span></div>
  </div>}
  {wrongCode&&<small className="sgq-omie-comparison-alert">O código retornado não corresponde ao SKU da contagem. Conferir cadastro físico e ERP.</small>}
  {wrongDescription&&<small className="sgq-omie-comparison-alert">Descrição divergente entre o item contado e o cadastro atual do Omie.</small>}
  {missing&&<small className="sgq-omie-comparison-alert">O código não foi encontrado pelo Omie. Confira antes de aprovar.</small>}
  {unavailable&&<small>Consulta indisponível: não foi possível determinar se há divergência.</small>}
 </div>
}
