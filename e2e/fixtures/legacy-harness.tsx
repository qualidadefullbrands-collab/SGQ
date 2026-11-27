// Separate dev-only QA entry. Not a production Vite build input.
import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {authClient,apiGet} from '../../src/lib/supabase'
import ItLibrary,{type ItLibraryEntry} from '../../src/its/ItLibrary'
import StockWorkspaceNav,{type StockWorkspaceMode} from '../../src/stock/StockWorkspaceNav'
import BlindInventoryUnified from '../../src/stock/BlindInventoryUnified'
import BlindInventoryReconciliation from '../../src/stock/BlindInventoryReconciliation'
import BlindInventoryStatus from '../../src/stock/BlindInventoryStatus'
import '../../src/styles.css'

function Harness(){
 const module=new URLSearchParams(location.search).get('module')
 const [authorized,setAuthorized]=useState(false)
 const [versions,setVersions]=useState<ItLibraryEntry[]>([])
 const [mode,setMode]=useState<StockWorkspaceMode>('posicoes')
 useEffect(()=>{
  void authClient.auth.getSession().then(async ({data})=>{
   if(!data.session)return
   setAuthorized(true)
   if(module==='its'){
    const r=await apiGet<{itVersions:ItLibraryEntry[]}>('/api/app/catalogos')
    if(r.data)setVersions(r.data.itVersions)
   }
  })
 },[module])
 if(!authorized)return <p role="status">Aguardando sessão sintética</p>
 if(module==='its')return <main className="workspace" data-qa-module="its"><ItLibrary versions={versions} canManage busyId={null} onStructure={()=>{throw Error('Escrita não prevista no cenário IT')}} onReview={()=>{throw Error('Revisão não prevista no cenário IT')}}/></main>
 return <main className="workspace stock-page" data-qa-module="estoque">
  <StockWorkspaceNav active={mode} onChange={setMode}/>
  {['cego','status_cegos','conciliacao'].includes(mode)&&<p role="note"><strong>Referência de quantidade:</strong> controles físicos do SGQ para a mesma localização. A consulta ao Omie confere apenas código e descrição do produto.</p>}
  {mode==='cego'&&<BlindInventoryUnified canWrite canApprove/>}
  {mode==='conciliacao'&&<BlindInventoryReconciliation canWrite canApprove/>}
  {mode==='status_cegos'&&<BlindInventoryStatus onOpenCount={()=>setMode('cego')} onOpenReconciliation={()=>setMode('conciliacao')}/>}
 </main>
}
if(!import.meta.env.DEV || import.meta.env.VITE_SUPABASE_URL!=='https://sgq-auth.qa.invalid' || import.meta.env.VITE_API_URL!=='https://sgq-api.qa.invalid')throw Error('Harness restrito ao ambiente sintético QA')
createRoot(document.getElementById('root')!).render(<Harness/>)
