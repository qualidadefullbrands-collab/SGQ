import {useEffect,useRef,useState} from 'react'
import {apiGet,authClient} from '../lib/supabase'
import {ArrowDown,ArrowUp,BookOpen,Check,ChevronLeft,ChevronRight,ClipboardCheck,Download,Eye,FileText,ImagePlus,Plus,RefreshCw,RotateCcw,Settings2,Trash2} from 'lucide-react'
import './ItEditorDemo.css'

type Step='cabecalho'|'caderno'|'criterios'|'rodape'|'previa'
type Kind='visual'|'dimensional'|'funcional'
type Answer='C'|'NC'|'NA'|''
type Criterion={id:string;kind:Kind;title:string;notes:string;unit:string;nominal:string;tolerance:string;measurement:string;answer:Answer;origin?:'checklist'|'dimensional'|'teste';group?:string;minimum?:string;maximum?:string}
type Header={company:string;sgq:string;code:string;title:string;revision:string;date:string;client:string;sku:string;product:string}
type Footer={prepared:string;approved:string;control:string}
type OfficialOption={id:string;codigo:string;titulo:string;versao:string}
type OfficialData={
 versao:{id:string;versao:string;status:string;vigencia:string|null;arquivo_nome:string|null;arquivo_storage_path:string|null;
  nivel_inspecao_padrao:string|null;regime_inspecao_padrao:string|null;tipo_plano_padrao:string|null;
  nqa_critico:number|null;nqa_grave:number|null;nqa_toleravel:number|null;
  instrucoes_trabalho:{codigo:string;titulo:string}|null},
 checklist:Array<{id:string;ordem:number;grupo:string;requisito:string;instrucao:string|null}>,
 dimensionais:Array<{id:string;ordem:number;nome:string;unidade:string|null;minimo:number|null;alvo:number|null;maximo:number|null;observacao:string|null}>,
 testes:Array<{id:string;ordem:number;nome:string;procedimento:string|null;criterio_aprovacao:string|null;destrutivo:boolean}>,
 documento_texto:string;aviso_documento:string|null;arquivo_storage_path:string|null
}
type Snapshot={header:Header;footer:Footer;notebook:string;criteria:Criterion[];documentPath:string|null;documentName:string;warnings:string|null;nqa:string;counts:{checks:number;dimensions:number;special:number}}
const steps:{key:Step;title:string}[]=[
 {key:'cabecalho',title:'Cabeçalho'},{key:'caderno',title:'Caderno'},
 {key:'criterios',title:'Critérios'},{key:'rodape',title:'Rodapé'},{key:'previa',title:'Prévia'}
]
const exampleHeader:Header={company:'Full Brands',sgq:'Sistema de Gestão da Qualidade',code:'IT-024',title:'Inspeção de frascos plásticos',revision:'01',date:'2026-10-28',client:'Cliente de exemplo',sku:'FR-100-EX',product:'Frasco plástico 100 mL'}
const exampleFooter:Footer={prepared:'Setor da Qualidade',approved:'Responsável pela aprovação',control:'Documento controlado · SGQ'}
const exampleNotebook='1. OBJETIVO\nEstabelecer as verificações de recebimento do produto.\n\n2. PREPARAÇÃO\nConfirmar código, lote e quantidade recebida. Separar a amostra conforme o plano de inspeção.\n\n3. VERIFICAÇÕES\nAvaliar a integridade visual, conferir identificação e realizar medições dimensionais com instrumentos adequados.\n\n4. REGISTROS\nRegistrar resultados, observações e evidências fotográficas quando necessário.'
const exampleCriteria:Criterion[]=[
 {id:'demo1',kind:'visual',title:'Integridade da embalagem',notes:'Verificar danos, deformações e trincas.',unit:'',nominal:'',tolerance:'',measurement:'',answer:'C'},
 {id:'demo2',kind:'visual',title:'Identificação e rotulagem',notes:'Conferir identificação e legibilidade.',unit:'',nominal:'',tolerance:'',measurement:'',answer:'C'},
 {id:'demo3',kind:'dimensional',title:'Diâmetro externo',notes:'Medir no ponto indicado no caderno.',unit:'mm',nominal:'24,00',tolerance:'0,20',measurement:'24,10',answer:''},
 {id:'demo4',kind:'dimensional',title:'Altura total',notes:'Medir da base à extremidade superior.',unit:'mm',nominal:'112,00',tolerance:'0,50',measurement:'112,20',answer:''}
]
const numeric=(text:string)=>Number(text.replace(',','.'))
function resultFor(c:Criterion):Answer {
 if(c.kind!=='dimensional')return c.answer
 if(!c.nominal.trim()||!c.tolerance.trim()||!c.measurement.trim())return ''
 const nominal=numeric(c.nominal),tol=numeric(c.tolerance),measurement=numeric(c.measurement)
 if(!Number.isFinite(nominal)||!Number.isFinite(tol)||!Number.isFinite(measurement)||tol<0)return ''
 return Math.abs(measurement-nominal)<=tol+0.00000001?'C':'NC'
}
const showDate=(s:string)=>s&&s.split('-').length===3?s.split('-').reverse().join('/'):'—'
const numericDisplay=(v:number|null|undefined)=>v==null?'':String(v).replace('.',',')
const decimal=(v:number|null|undefined)=>v==null?'não informado':String(v).replace('.',',')
function specification(c:Criterion){
 if(c.kind!=='dimensional')return c.group||'Verificação'
 if(c.nominal.trim()&&c.tolerance.trim())return c.nominal+' ± '+c.tolerance+' '+c.unit
 if(c.minimum||c.maximum)return (c.minimum||'—')+' a '+(c.maximum||'—')+' '+c.unit
 if(c.nominal)return 'Nominal '+c.nominal+' '+c.unit+' · sem tolerância'
 return 'Sem tolerância aprovada'+(c.unit?' ('+c.unit+')':'')
}
function PaperHeader({header,logo}:{header:Header;logo:string|null}){
 return <div className="it-test-doc-header">
  <div className="it-test-doc-logo">{logo?<img src={logo} alt="Logotipo da empresa"/>:<img src="/sgq-icon.svg" alt="Marca SGQ de exemplo"/>}</div>
  <div className="it-test-doc-company"><b>{header.company||'Empresa'}</b><span>{header.sgq||'Sistema de Gestão da Qualidade'}</span></div>
  <div className="it-test-doc-meta"><b>{header.code||'Código'}</b><span>Rev. {header.revision||'—'}</span><span>{showDate(header.date)}</span></div>
 </div>
}
function PaperFooter({footer,page}:{footer:Footer;page:number}){
 return <footer className="it-test-doc-footer">
  <div><span>Elaborado por: {footer.prepared||'—'}</span><span>Aprovado por: {footer.approved||'—'}</span></div>
  <div><span>{footer.control||'SGQ'}</span><b>Página {page} de 2</b></div>
 </footer>
}
export default function ItEditorDemo({officialVersions=[]}:{officialVersions?:OfficialOption[]}){
 const [step,setStep]=useState<Step>('cabecalho')
 const [header,setHeader]=useState<Header>({...exampleHeader})
 const [footer,setFooter]=useState<Footer>({...exampleFooter})
 const [notebook,setNotebook]=useState(exampleNotebook)
 const [criteria,setCriteria]=useState<Criterion[]>(exampleCriteria.map(c=>({...c})))
 const [logo,setLogo]=useState<string|null>(null)
 const [technicalImage,setTechnicalImage]=useState<string|null>(null)
 const [technicalName,setTechnicalName]=useState('')
 const [showSpecs,setShowSpecs]=useState(true)
 const [sourceId,setSourceId]=useState('')
 const [officialLoaded,setOfficialLoaded]=useState<OfficialOption|null>(null)
 const [loadBusy,setLoadBusy]=useState(false)
 const [loadError,setLoadError]=useState('')
 const [sourceWarning,setSourceWarning]=useState<string|null>(null)
 const [officialCounts,setOfficialCounts]=useState({checks:0,dimensions:0,special:0})
 const [nqaSummary,setNqaSummary]=useState('')
 const [originalPath,setOriginalPath]=useState<string|null>(null)
 const [originalName,setOriginalName]=useState('')
 const [downloadingOriginal,setDownloadingOriginal]=useState(false)
 const [importSnapshot,setImportSnapshot]=useState<Snapshot|null>(null)
 const initialLoad=useRef(false)
 const defaultOfficial=officialVersions.find(v=>/^IT\s*0*01$/i.test(v.codigo))||officialVersions[0]
 useEffect(()=>{
  if(!defaultOfficial||initialLoad.current)return
  initialLoad.current=true
  setSourceId(defaultOfficial.id)
  void loadOfficial(defaultOfficial.id)
 },[defaultOfficial?.id])
 async function loadOfficial(id:string){
  if(!id)return setLoadError('Selecione uma IT publicada.')
  setLoadBusy(true);setLoadError('')
  const response=await apiGet<OfficialData>('/api/its/'+encodeURIComponent(id)+'/editor-oficial')
  setLoadBusy(false)
  if(response.error||!response.data){
   setLoadError(response.error?.message||'Não foi possível carregar a IT oficial.')
   return
  }
  const data=response.data
  const version=data.versao
  const meta=version.instrucoes_trabalho
  const fromList=officialVersions.find(option=>option.id===id)
  const option=fromList||{id,codigo:meta?.codigo||'IT',titulo:meta?.titulo||'',versao:version.versao}
  const importedChecks=(data.checklist||[]).map(c=>({
   id:'verificacao-'+c.id,kind:(c.grupo?.toLowerCase()==='funcional'?'funcional':'visual') as Kind,
   origin:'checklist' as const,group:c.grupo||'Verificação',title:c.requisito||'',
   notes:c.instrucao||'',unit:'',nominal:'',tolerance:'',measurement:'',answer:'' as Answer
  }))
  const importedDimensions=(data.dimensionais||[]).map(d=>{
   const lower=d.minimo!=null&&d.alvo!=null?d.alvo-d.minimo:null
   const upper=d.maximo!=null&&d.alvo!=null?d.maximo-d.alvo:null
   const isSymmetric=lower!=null&&upper!=null&&Math.abs(lower-upper)<0.00000001
   return {id:'dimensional-'+d.id,kind:'dimensional' as Kind,
    origin:'dimensional' as const,group:'Análise dimensional',title:d.nome||'',notes:d.observacao||'',
    unit:d.unidade||'',nominal:numericDisplay(d.alvo),tolerance:isSymmetric?numericDisplay(lower):'',
    minimum:numericDisplay(d.minimo),maximum:numericDisplay(d.maximo),measurement:'',answer:'' as Answer}
  })
  const importedTests=(data.testes||[]).map(t=>({
   id:'teste-'+t.id,kind:'funcional' as Kind,origin:'teste' as const,
   group:'Teste especial',title:t.nome||'',notes:[t.procedimento,t.criterio_aprovacao?'Critério de aprovação: '+t.criterio_aprovacao:'',t.destrutivo?'Destrutivo':''].filter(Boolean).join('\n'),
   unit:'',nominal:'',tolerance:'',measurement:'',answer:'' as Answer
  }))
  const newHeader:Header={
   company:'',sgq:'Sistema de Gestão da Qualidade',code:meta?.codigo||option.codigo,
   title:meta?.titulo||option.titulo,revision:version.versao,date:version.vigencia||'',
   client:'',sku:'',product:''
  }
  const newFooter:Footer={prepared:'',approved:'',control:'Cópia de demonstração · referência '+(meta?.codigo||option.codigo)+' / '+version.versao}
  const counts={checks:importedChecks.length,dimensions:importedDimensions.length,special:importedTests.length}
  const summary='NQA crítico '+decimal(version.nqa_critico)+'% · grave '+decimal(version.nqa_grave)+'% · tolerável '+decimal(version.nqa_toleravel)+'% · plano '+(version.tipo_plano_padrao||'não informado')+' / '+(version.regime_inspecao_padrao||'não informado')
  const snapshot:Snapshot={
   header:newHeader,footer:newFooter,notebook:data.documento_texto||'',
   criteria:[...importedChecks,...importedDimensions,...importedTests],
   documentPath:data.arquivo_storage_path||null,documentName:version.arquivo_nome||'IT-oficial.docx',
   warnings:data.aviso_documento,counts,nqa:summary
  }
  setImportSnapshot(snapshot)
  setHeader({...snapshot.header});setFooter({...snapshot.footer})
  setNotebook(snapshot.notebook);setCriteria(snapshot.criteria.map(c=>({...c})))
  setOriginalPath(snapshot.documentPath);setOriginalName(snapshot.documentName)
  setSourceWarning(snapshot.warnings)
  setOfficialCounts(counts);setNqaSummary(summary)
  setOfficialLoaded(option);setSourceId(id);setStep('cabecalho')
  setLogo(null);setTechnicalImage(null);setTechnicalName('');setShowSpecs(true)
 }
 async function downloadOriginal(){
  if(!originalPath)return
  setDownloadingOriginal(true);setLoadError('')
  try{
   const result=await authClient.storage.from('it-documentos').download(originalPath)
   if(result.error||!result.data)throw new Error(result.error?.message||'Não foi possível abrir o Word oficial.')
   const url=URL.createObjectURL(result.data)
   const anchor=document.createElement('a');anchor.href=url;anchor.download=originalName||'IT-oficial.docx'
   document.body.appendChild(anchor);anchor.click();anchor.remove()
   window.setTimeout(()=>URL.revokeObjectURL(url),15000)
  }catch(error){setLoadError(error instanceof Error?error.message:'Falha ao baixar o documento oficial.')}
  finally{setDownloadingOriginal(false)}
 }
 useEffect(()=>()=>{if(logo)URL.revokeObjectURL(logo)},[logo])
 useEffect(()=>()=>{if(technicalImage)URL.revokeObjectURL(technicalImage)},[technicalImage])
 const index=steps.findIndex(x=>x.key===step)
 const update=(id:string,patch:Partial<Criterion>)=>setCriteria(old=>old.map(c=>c.id===id?{...c,...patch}:c))
 const move=(i:number,delta:number)=>setCriteria(old=>{const j=i+delta;if(j<0||j>=old.length)return old;const a=[...old];[a[i],a[j]]=[a[j],a[i]];return a})
 const add=()=>setCriteria(old=>[...old,{id:'demo-'+Date.now()+'-'+old.length,kind:'visual',title:'Novo critério',notes:'',unit:'',nominal:'',tolerance:'',measurement:'',answer:''}])
 const pick=(file:File|undefined,kind:'logo'|'image')=>{if(!file||!file.type.startsWith('image/'))return;const url=URL.createObjectURL(file);if(kind==='logo')setLogo(url);else{setTechnicalImage(url);setTechnicalName(file.name)}}
 const reset=()=>{
  const source=importSnapshot
  setHeader(source?{...source.header}:{...exampleHeader})
  setFooter(source?{...source.footer}:{...exampleFooter})
  setNotebook(source?source.notebook:exampleNotebook)
  setCriteria(source?source.criteria.map(c=>({...c})):exampleCriteria.map(c=>({...c})))
  setOriginalPath(source?.documentPath||null);setOriginalName(source?.documentName||'')
  setSourceWarning(source?.warnings||null);setShowSpecs(true)
  setLogo(null);setTechnicalImage(null);setTechnicalName('');setStep('cabecalho')
 }
 const results=criteria.map(resultFor)
 const count=(a:Answer)=>results.filter(x=>x===a).length
 return <section className="it-test" aria-label="Editor de IT experimental">
  <div className="it-test-banner">
   <div className="it-test-banner-copy"><Settings2 size={21}/><div><strong>Editor de IT · Tela teste</strong><span>Exemplo preenchido para avaliação do layout. Não salva nem publica documentos reais.</span></div></div>
   <button className="secondary" type="button" onClick={reset}><RotateCcw size={16}/> Restaurar exemplo</button>
  </div>
  <nav className="it-test-tabs" aria-label="Etapas do editor">
   {steps.map((x,i)=><button type="button" key={x.key} className={x.key===step?'selected':''} aria-current={x.key===step?'step':undefined} onClick={()=>setStep(x.key)}><span>{i+1}</span>{x.title}</button>)}
  </nav>

  {step!=='previa'&&<div className="panel section-card it-test-editor">
   {step==='cabecalho'&&<>
    <div className="section-title"><h2>Cabeçalho</h2><span className="it-test-hint">Repetido nas páginas do documento</span></div>
    <div className="it-test-logo-row"><div className="it-test-logo">{logo?<img src={logo} alt="Logo de teste"/>:<img src="/sgq-icon.svg" alt="Marca SGQ de exemplo"/>}</div><div>
     <label className="it-test-upload"><ImagePlus size={17}/> Inserir logotipo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>pick(e.target.files?.[0],'logo')}/></label>
     {logo&&<button type="button" className="secondary small" onClick={()=>setLogo(null)}>Remover logo</button>}
    </div></div>
    <div className="form-grid it-test-grid">
     <label>Empresa<input value={header.company} onChange={e=>setHeader({...header,company:e.target.value})}/></label>
     <label>Identificação do SGQ<input value={header.sgq} onChange={e=>setHeader({...header,sgq:e.target.value})}/></label>
     <label>Código da IT<input value={header.code} onChange={e=>setHeader({...header,code:e.target.value})}/></label>
     <label>Título<input value={header.title} onChange={e=>setHeader({...header,title:e.target.value})}/></label>
     <label>Revisão<input value={header.revision} onChange={e=>setHeader({...header,revision:e.target.value})}/></label>
     <label>Vigência<input type="date" value={header.date} onChange={e=>setHeader({...header,date:e.target.value})}/></label>
     <label>Cliente<input value={header.client} onChange={e=>setHeader({...header,client:e.target.value})}/></label>
     <label>Produto<input value={header.product} onChange={e=>setHeader({...header,product:e.target.value})}/></label>
     <label>Código / SKU<input value={header.sku} onChange={e=>setHeader({...header,sku:e.target.value})}/></label>
    </div>
   </>}
   {step==='caderno'&&<>
    <div className="section-title"><h2>Caderno de inspeção</h2></div>
    <label className="it-test-caderno-label">Cole ou escreva o conteúdo
     <textarea rows={14} value={notebook} onChange={e=>setNotebook(e.target.value)} placeholder="Cole o texto do caderno aqui"/>
    </label>
    <div className="it-test-toolbar">
     <label className="it-test-upload"><ImagePlus size={17}/> Inserir imagem técnica<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>pick(e.target.files?.[0],'image')}/></label>
     {technicalImage&&<button type="button" className="secondary small" onClick={()=>{setTechnicalImage(null);setTechnicalName('')}}>Remover imagem</button>}
     <label className="it-test-checkbox"><input type="checkbox" checked={showSpecs} onChange={e=>setShowSpecs(e.target.checked)}/> Tabela de especificações</label>
    </div>
    {technicalImage&&<div className="it-test-image-preview"><img src={technicalImage} alt="Imagem técnica"/><span>{technicalName}</span></div>}
    <p className="it-test-hint">Nesta tela experimental é possível colar texto e anexar uma imagem. A importação completa de arquivos Word/PDF com formatação será uma etapa posterior.</p>
   </>}
   {step==='criterios'&&<>
    <div className="section-title"><h2>Critérios da inspeção</h2><button type="button" className="secondary" onClick={add}><Plus size={16}/> Adicionar critério</button></div>
    <div className="it-test-criteria">
     {criteria.map((c,i)=><article className="it-test-criterion" key={c.id}>
      <div className="it-test-criterion-head"><strong>{i+1}. {c.title}</strong><div>
       <button className="secondary small" disabled={i===0} type="button" aria-label="Mover para cima" onClick={()=>move(i,-1)}><ArrowUp size={15}/></button>
       <button className="secondary small" disabled={i===criteria.length-1} type="button" aria-label="Mover para baixo" onClick={()=>move(i,1)}><ArrowDown size={15}/></button>
       <button className="secondary small" type="button" aria-label="Excluir critério" onClick={()=>setCriteria(old=>old.filter(x=>x.id!==c.id))}><Trash2 size={15}/></button>
      </div></div>
      <div className="form-grid it-test-grid">
       <label>Descrição<input value={c.title} onChange={e=>update(c.id,{title:e.target.value})}/></label>
       <label>Tipo<select value={c.kind} onChange={e=>update(c.id,{kind:e.target.value as Kind})}><option value="visual">Visual · C/NC/NA</option><option value="dimensional">Dimensional · tolerância</option><option value="funcional">Funcional · C/NC/NA</option></select></label>
       <label className="span-2">Orientação<textarea rows={2} value={c.notes} onChange={e=>update(c.id,{notes:e.target.value})}/></label>
       {c.kind==='dimensional'?<>
        <label>Nominal<input inputMode="decimal" value={c.nominal} onChange={e=>update(c.id,{nominal:e.target.value})}/></label>
        <label>Tolerância ±<input inputMode="decimal" value={c.tolerance} onChange={e=>update(c.id,{tolerance:e.target.value})}/></label>
        <label>Unidade<input value={c.unit} onChange={e=>update(c.id,{unit:e.target.value})}/></label>
        <label>Leitura simulada<input inputMode="decimal" value={c.measurement} onChange={e=>update(c.id,{measurement:e.target.value})}/></label>
       </>:<label>Resultado de exemplo<select value={c.answer} onChange={e=>update(c.id,{answer:e.target.value as Answer})}><option value="">Sem resposta</option><option value="C">Conforme</option><option value="NC">Não conforme</option><option value="NA">Não aplicável</option></select></label>}
      </div>
     </article>)}
     {!criteria.length&&<div className="empty">Nenhum critério cadastrado no teste.</div>}
    </div>
   </>}
   {step==='rodape'&&<>
    <div className="section-title"><h2>Rodapé e controle documental</h2></div>
    <div className="form-grid it-test-grid">
     <label>Elaborado por<input value={footer.prepared} onChange={e=>setFooter({...footer,prepared:e.target.value})}/></label>
     <label>Aprovado por<input value={footer.approved} onChange={e=>setFooter({...footer,approved:e.target.value})}/></label>
     <label className="span-2">Identificação de controle<input value={footer.control} onChange={e=>setFooter({...footer,control:e.target.value})}/></label>
    </div>
    <p className="it-test-hint">Cabeçalho e rodapé aparecerão em cada página, com numeração automática no modelo demonstrativo.</p>
   </>}
  </div>}

  {step==='previa'&&<div className="it-test-preview">
   <div className="it-test-preview-title"><Eye size={20}/><div><h2>Prévia do documento</h2><p>O caderno aparece antes da própria inspeção, na sequência prevista.</p></div></div>
   <div className="it-test-paper-stack">
    <article className="it-test-paper" aria-label="Página 1 do exemplo">
     <PaperHeader header={header} logo={logo}/>
     <div className="it-test-paper-body">
      <span className="it-test-kicker">INSTRUÇÃO DE TRABALHO</span><h2>{header.title||'Título da IT'}</h2>
      <div className="it-test-doc-fields"><span>Cliente: {header.client||'—'}</span><span>Produto: {header.product||'—'}</span><span>SKU: {header.sku||'—'}</span></div>
      <h3><BookOpen size={18}/> Caderno de inspeção</h3>
      <div className="it-test-pasted-content">{notebook||'Nenhum conteúdo incluído.'}</div>
      {technicalImage&&<figure className="it-test-doc-figure"><img src={technicalImage} alt="Imagem técnica do caderno"/><figcaption>{technicalName}</figcaption></figure>}
      {showSpecs&&<><h4>Especificações de referência</h4><div className="it-test-table-scroll"><table><thead><tr><th>Parâmetro</th><th>Especificação</th><th>Unidade</th></tr></thead><tbody>
       {criteria.filter(c=>c.kind==='dimensional').map(c=><tr key={c.id}><td>{c.title}</td><td>{c.nominal||'—'} ± {c.tolerance||'—'}</td><td>{c.unit||'—'}</td></tr>)}
      </tbody></table></div></>}
     </div><PaperFooter footer={footer} page={1}/>
    </article>
    <article className="it-test-paper" aria-label="Página 2 do exemplo">
     <PaperHeader header={header} logo={logo}/>
     <div className="it-test-paper-body">
      <span className="it-test-kicker">REGISTRO DE INSPEÇÃO · DEMONSTRAÇÃO</span><h2>Inspeção do produto</h2>
      <div className="it-test-doc-fields"><span>Produto: {header.product||'—'}</span><span>SKU: {header.sku||'—'}</span><span>Data da inspeção: —</span></div>
      <h3><ClipboardCheck size={18}/> Resultados</h3>
      <div className="it-test-summary"><span>Conformes <b>{count('C')}</b></span><span>Não conformes <b>{count('NC')}</b></span><span>Não aplicáveis <b>{count('NA')}</b></span></div>
      <div className="it-test-table-scroll"><table><thead><tr><th>#</th><th>Critério</th><th>Especificação</th><th>Leitura / resposta</th><th>Status</th></tr></thead><tbody>
       {criteria.map((c,i)=>{const r=resultFor(c);return <tr key={c.id}><td>{i+1}</td><td><b>{c.title||'—'}</b><small>{c.notes}</small></td>
        <td>{c.kind==='dimensional'?(c.nominal||'—')+' ± '+(c.tolerance||'—')+' '+c.unit:c.kind==='funcional'?'Teste funcional':'Visual'}</td>
        <td>{c.kind==='dimensional'?(c.measurement?c.measurement+' '+c.unit:'Sem leitura'):r==='C'?'Conforme':r==='NC'?'Não conforme':r==='NA'?'Não aplicável':'Pendente'}</td>
        <td><span className={'it-test-result '+(r||'pending')}>{r||'—'}</span></td>
       </tr>})}
      </tbody></table></div>
      <div className="it-test-record"><b>Observações e evidências</b><p>Reservado aos registros e fotos da inspeção executada no SGQ.</p></div>
     </div><PaperFooter footer={footer} page={2}/>
    </article>
   </div>
   <p className="it-test-hint">Prévia ilustrativa em duas páginas. O editor definitivo precisará de paginação dinâmica e exportação Word/PDF.</p>
  </div>}
  <div className="it-test-actions">
   <button className="secondary" type="button" disabled={index===0} onClick={()=>setStep(steps[index-1].key)}><ChevronLeft size={16}/> Anterior</button>
   <span>{index+1} de {steps.length}</span>
   {index<steps.length-1?<button type="button" className="primary" onClick={()=>setStep(steps[index+1].key)}>Próximo <ChevronRight size={16}/></button>:
    <button type="button" className="primary" onClick={()=>setStep('cabecalho')}><Check size={16}/> Revisar</button>}
  </div>
 </section>
}
