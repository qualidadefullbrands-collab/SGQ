import {useEffect,useState} from 'react'
import {CheckCircle2,FileText,FolderSearch,Paperclip,RefreshCw,Search,ShieldAlert,Upload} from 'lucide-react'
import {authClient} from '../lib/supabase'
import {blindInventoryError} from './blindInventoryErrors'

type ProcessRow={id:string;codigo:string;cliente:string|null;codigo_cliente:string|null;status:string}
type ProcessItem={produto_id:string|null}
type LocalProduct={id:string;sku:string;nome:string|null}
type OmieItem={sku:string;descricao:string}
type OmieProcess={found?:boolean;cliente?:string|null;matchedCode?:string;source?:string;reason?:string;error?:string;itens?:OmieItem[];itensDisponiveis?:boolean}
type Check={campo:string;status:'conforme'|'divergente'|'nao_verificado';detalhe:string}
export type VerifiedBlindContext={
 sku:string;processoId:string;processoCodigo:string;clienteNome:string
 verificacao:{consultadoEm:string;fonte:string;clienteOmie:string|null;statusOmie:string;checks:Check[]}
}
type DocumentRow={id:string;arquivo_nome:string;criado_em:string;storage_path:string;mime_type:string}
const docBucket='sgq-inventario-inspecoes'
const trim=(v:unknown)=>String(v??'').trim()
const normalized=(v:unknown)=>trim(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const describe=blindInventoryError
const formats=['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const limit=15*1024*1024

export default function BlindInventoryProcessPanel({sku,omieDescription,inventoryId,canWrite,initialProcessCode='',onChange}:{
 sku:string;omieDescription:string;inventoryId:string;canWrite:boolean;initialProcessCode?:string
 onChange:(value:VerifiedBlindContext|null)=>void
}){
 const [code,setCode]=useState(initialProcessCode)
 const [process,setProcess]=useState<ProcessRow|null>(null)
 const [client,setClient]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [checks,setChecks]=useState<Check[]>([])
 const [snapshot,setSnapshot]=useState<VerifiedBlindContext['verificacao']|null>(null)
 const [loading,setLoading]=useState(false)
 const [docs,setDocs]=useState<DocumentRow[]>([])
 const [file,setFile]=useState<File|null>(null)
 const [docNote,setDocNote]=useState('')
 const [uploading,setUploading]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')

 const invalidate=()=>{setConfirmed(false);setChecks([]);setSnapshot(null);onChange(null)}
 async function loadDocs(processId:string){
  const {data,error:dbError}=await authClient.from('sgq_inventario_cego_inspecoes')
   .select('id,arquivo_nome,criado_em,storage_path,mime_type')
   .eq('inventario_id',inventoryId).eq('processo_id',processId)
   .order('criado_em',{ascending:false}).limit(60)
  if(dbError)throw new Error('Não foi possível listar documentos do processo: '+dbError.message)
  setDocs((data||[]) as DocumentRow[])
 }
 async function lookup(override?:string){
  invalidate();setProcess(null);setDocs([]);setError('');setNotice('')
  const requested=(override??code).trim().toUpperCase()
  if(!/^[A-Z0-9-]{3,40}$/.test(requested)){setError('Informe o código exato do processo SGQ (ex.: FST26125-A).');return}
  setLoading(true)
  try{
   const {data,error:queryError}=await authClient.from('processos')
    .select('id,codigo,cliente,codigo_cliente,status')
    .ilike('codigo',requested).is('excluido_em',null).limit(2)
   if(queryError)throw queryError
   if(!data?.length)throw new Error('Processo não localizado no SGQ. Confira o código completo, inclusive eventual sufixo A/B.')
   if(data.length!==1)throw new Error('Há mais de um registro correspondente. A seleção automática foi bloqueada.')
   const selected=data[0] as ProcessRow
   setProcess(selected);setClient(selected.cliente||'')
   await loadDocs(selected.id)
   setNotice('Processo localizado. Confirme o cliente e consulte as divergências antes de salvar.')
  }catch(e){setError(describe(e))}
  finally{setLoading(false)}
 }
 async function verify(){
  if(!process||!client.trim())return
  invalidate();setLoading(true);setError('');setNotice('')
  try{
   const [{data:localProducts,error:localError},{data:links,error:linkError},response]=await Promise.all([
    authClient.from('produtos').select('id,sku,nome').ilike('sku',sku).limit(2),
    authClient.from('processo_itens').select('produto_id').eq('processo_id',process.id).limit(500),
    authClient.functions.invoke('sgq-omie-fst',{body:{codigo:process.codigo}})
   ])
   if(localError||linkError)throw new Error('Falha na consulta dos vínculos do SGQ: '+(localError?.message||linkError?.message))
   const local=(localProducts||[])[0] as LocalProduct|undefined
   const itemLinks=(links||[]) as ProcessItem[]
   const omie=response.error?null:response.data as OmieProcess|null
   const results:Check[]=[]
   const push=(campo:string,status:Check['status'],detalhe:string)=>results.push({campo,status,detalhe})
   if(local){
    push('Produto cadastrado no SGQ',normalized(local.nome)===normalized(omieDescription)?'conforme':'divergente',
     'SGQ: '+trim(local.nome||'Sem descrição')+' | Omie: '+omieDescription)
    push('Vínculo SKU × processo',itemLinks.some(x=>x.produto_id===local.id)?'conforme':'divergente',
     itemLinks.some(x=>x.produto_id===local.id)?'Produto associado ao processo no SGQ.':'Produto não está associado aos itens deste processo no SGQ.')
   }else{
    push('Produto cadastrado no SGQ','divergente','SKU '+sku+' localizado no Omie, mas não no catálogo local SGQ.')
    push('Vínculo SKU × processo','nao_verificado','Não é possível validar vínculo sem o cadastro local do produto.')
   }
   push('Cliente físico × SGQ',normalized(client)===normalized(process.cliente)?'conforme':'divergente',
    'Informado: '+client.trim()+' | SGQ: '+trim(process.cliente||'Não identificado'))
   if(!omie||omie.found!==true){
    push('Processo no Omie',omie?.reason==='not_found_exact'?'divergente':'nao_verificado',
     omie?.reason==='not_found_exact'?'Processo não localizado com o código exato no Omie.':'Consulta ao Omie indisponível ou incompleta; não interpretada como cadastro correto.')
    push('Cliente no Omie','nao_verificado','O cliente não pôde ser confirmado no Omie.')
    push('SKU no pedido Omie','nao_verificado','Pedido do processo não disponível para conferir o SKU.')
   }else{
    push('Processo no Omie',normalized(omie.matchedCode)===normalized(process.codigo)?'conforme':'divergente',
     'SGQ: '+process.codigo+' | Omie: '+trim(omie.matchedCode))
    push('Cliente no Omie',!omie.cliente?'nao_verificado':normalized(omie.cliente)===normalized(process.cliente)?'conforme':'divergente',
     'SGQ: '+trim(process.cliente)+' | Omie: '+trim(omie.cliente||'Não disponível'))
    if(omie.itensDisponiveis&&Array.isArray(omie.itens)){
     const found=omie.itens.find(item=>normalized(item.sku)===normalized(sku))
     push('SKU no pedido Omie',found?'conforme':'divergente',
      found?'Pedido contém '+found.sku+' — '+found.descricao:'O SKU '+sku+' não consta no pedido Omie consultado.')
    }else push('SKU no pedido Omie','nao_verificado','Detalhes do pedido não disponíveis; não presumir correspondência.')
   }
   const evidence={consultadoEm:new Date().toISOString(),fonte:omie?.source||'sgq_sem_retorno_omie',
    clienteOmie:omie?.cliente||null,statusOmie:omie?.found?'localizado':'nao_confirmado',checks:results}
   setChecks(results);setSnapshot(evidence)
   const divergences=results.filter(x=>x.status==='divergente').length
   const unavailable=results.filter(x=>x.status==='nao_verificado').length
   setNotice(divergences?divergences+' divergência(s) identificada(s). Revise antes de confirmar.':
    unavailable?'Consulta feita, mas '+unavailable+' verificação(ões) ficaram inconclusivas.':
    'Processo, cliente e cadastro consultados. Nenhuma divergência encontrada nos campos verificáveis.')
  }catch(e){setError('Não foi possível realizar a conferência: '+describe(e))}
  finally{setLoading(false)}
 }
 function confirm(checked:boolean){
  setConfirmed(checked)
  onChange(checked&&process&&snapshot&&client.trim()?{
   sku,processoId:process.id,processoCodigo:process.codigo,clienteNome:client.trim(),verificacao:snapshot
  }:null)
 }
 async function upload(){
  if(!process||!confirmed||!snapshot||!file||!canWrite||uploading)return
  if(!formats.includes(file.type)||file.size<=0||file.size>limit){setError('Documento inválido: PDF, DOC, DOCX, JPG ou PNG de até 15 MB.');return}
  setUploading(true);setError('');setNotice('')
  try{
   const {data:{user},error:authError}=await authClient.auth.getUser()
   if(authError||!user)throw new Error('Sessão expirada.')
   const ext=file.name.split('.').pop()?.toLowerCase()||'bin'
   const safeExt=/^(pdf|doc|docx|jpg|jpeg|png)$/.test(ext)?ext:'bin'
   if(safeExt==='bin')throw new Error('Extensão de arquivo não suportada.')
   const storagePath=[user.id,inventoryId,process.id,crypto.randomUUID()+'.'+safeExt].join('/')
   const {error:storeError}=await authClient.storage.from(docBucket).upload(storagePath,file,{upsert:false,contentType:file.type})
   if(storeError)throw new Error('Falha ao enviar documento: '+storeError.message)
   const {error:dbError}=await authClient.from('sgq_inventario_cego_inspecoes').insert({
    inventario_id:inventoryId,processo_id:process.id,arquivo_nome:file.name.slice(0,200),
    mime_type:file.type,storage_path:storagePath,observacao:docNote.trim().slice(0,1000),criado_por:user.id
   })
   if(dbError)throw new Error('Arquivo enviado, mas o registro de auditoria não foi concluído: '+dbError.message)
   setFile(null);setDocNote('');await loadDocs(process.id)
   setNotice('Inspeção anexada ao processo '+process.codigo+'. O documento não altera resultados de inspeção ou estoque.')
  }catch(e){setError(describe(e))}
  finally{setUploading(false)}
 }
 async function openDoc(row:DocumentRow){
  setError('')
  const {data,error:signError}=await authClient.storage.from(docBucket).createSignedUrl(row.storage_path,600)
  if(signError||!data?.signedUrl){setError('Não foi possível abrir a inspeção: '+describe(signError));return}
  window.open(data.signedUrl,'_blank','noopener,noreferrer')
 }
 useEffect(()=>{
  setProcess(null);setCode(initialProcessCode);setClient('');setDocs([])
  setChecks([]);setSnapshot(null);setConfirmed(false)
  if(initialProcessCode)void lookup(initialProcessCode)
 },[sku,initialProcessCode])
 return <section className="sgq-blind-process">
  <div className="sgq-blind-section-head"><FolderSearch size={20}/><h3>Processo, cliente e divergências cadastrais</h3></div>
  <p>Confirme o processo completo (inclusive sufixos), o cliente físico e o vínculo do produto. Compare os registros do SGQ com o Omie antes de lançar a contagem.</p>
  <div className="sgq-blind-find">
   <label>Código do processo SGQ<input value={code} maxLength={40} placeholder="FST26125-A" onChange={e=>{setCode(e.target.value);setProcess(null);setDocs([]);invalidate()}}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void lookup()}}}/></label>
   <button type="button" className="secondary" disabled={loading||!code.trim()} onClick={()=>void lookup()}><Search size={16}/> Confirmar processo</button>
  </div>
  {process&&<>
   <div className="sgq-blind-process-summary"><strong>{process.codigo}</strong><span>Status SGQ: {process.status}</span><small>Cliente do processo: {process.cliente||'não informado'}</small></div>
   <label>Cliente identificado na mercadoria / documentação
    <input value={client} maxLength={180} placeholder="Informe o cliente físico" onChange={e=>{setClient(e.target.value);invalidate()}}/>
   </label>
   <button type="button" className="secondary" disabled={loading||!client.trim()} onClick={()=>void verify()}><RefreshCw size={16}/> {loading?'Consultando cadastros…':'Consultar divergências SGQ × Omie'}</button>
   {checks.length>0&&<div className="sgq-blind-checks" aria-label="Conferência de divergências cadastrais">
     {checks.map((c,i)=><div key={i} data-result={c.status}><span>{c.status==='conforme'?<CheckCircle2 size={16}/>:<ShieldAlert size={16}/>}</span>
      <div><strong>{c.campo}</strong><small>{c.detalhe}</small></div><b>{c.status==='conforme'?'Conforme':c.status==='divergente'?'Revisar':'Não verificado'}</b></div>)}
    </div>}
   {snapshot&&<label className="sgq-blind-client-confirm"><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/>
      <span>Confirmo que o processo <b>{process.codigo}</b> e o cliente <b>{client}</b> correspondem à mercadoria física. Estou ciente das divergências ou campos não verificados.</span>
    </label>}
   <div className="sgq-blind-inspection-upload">
    <div className="sgq-blind-section-head"><FileText size={18}/><h3>Documentos de inspeção do processo</h3></div>
    <p>Envie o laudo/inspeção em PDF, Word ou foto. O arquivo fica vinculado a {process.codigo} e preservado no histórico deste inventário, sem alterar o laudo oficial.</p>
    {canWrite&&<div className="sgq-blind-inspection-form">
     <label>Arquivo de inspeção (PDF, DOC/DOCX, JPG, PNG · até 15 MB)
      <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]||null)}/>
     </label>
     <label>Observação do documento (opcional)<input value={docNote} maxLength={1000} onChange={e=>setDocNote(e.target.value)} placeholder="Ex.: Inspeção de recebimento, lote..." /></label>
     <button type="button" className="secondary" disabled={!confirmed||!snapshot||!file||uploading} onClick={()=>void upload()}>
      <Upload size={15}/>{uploading?'Enviando…':'Anexar inspeção ao processo'}
     </button>
    </div>}
    <div className="sgq-blind-document-list">{docs.map(row=><button type="button" key={row.id} className="secondary small" onClick={()=>void openDoc(row)}>
      <Paperclip size={14}/><span>{row.arquivo_nome}</span><small>{new Date(row.criado_em).toLocaleDateString('pt-BR')}</small>
     </button>)}{!docs.length&&<small>Sem documentos de inspeção anexados a este processo no inventário.</small>}</div>
   </div>
  </>}
  {error&&<p role="alert" className="sgq-blind-context-error">{error}</p>}
  {notice&&<p role="status" className="sgq-blind-context-notice">{notice}</p>}
 </section>
}
