import {useEffect,useRef,useState} from 'react'
import {apiGet,authClient} from '../lib/supabase'
import {ArrowDown,ArrowUp,BookOpen,Check,ChevronLeft,ChevronRight,ClipboardCheck,Download,Eye,FileText,ImagePlus,Plus,RefreshCw,RotateCcw,Settings2,Trash2} from 'lucide-react'
import './ItEditorDemo.css'
import OfficialWordPreview from './OfficialWordPreview'
import RichNarrativeEditor from './RichNarrativeEditor'
import {importNarrativeFromDocx,plainToRichHtml,narrativeTextFromHtml} from './richNarrative'

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
type Snapshot={header:Header;footer:Footer;notebook:string;notebookHtml:string;criteria:Criterion[];documentPath:string|null;documentName:string;warnings:string|null;nqa:string;counts:{checks:number;dimensions:number;special:number}}
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
// NQA and registration matrix checked against IT 001, revision 02/2026.
const it001IdentityRows=[
 ['Produto / descrição','Código do cliente'],['Cliente','Processo FST'],
 ['Nota fiscal','Lote'],['Material','Capacidade'],['Origem','Transporte'],
 ['Quantidade recebida','Quantidade por caixa'],['Nº de caixas recebidas','Chegada no CD'],
 ['Data da inspeção',''],
] as const
const it001SamplingRows=[
 ['281 – 500 unidades','F','20','1 / 2','H','50','2 / 3'],
 ['501 – 1.200 unidades','G','32','1 / 2','J','80','3 / 4'],
 ['1.201 – 3.200 unidades','H','50','2 / 3','K','125','5 / 6'],
 ['3.201 – 10.000 unidades','J','80','3 / 4','L','200','7 / 8'],
 ['10.001 – 35.000 unidades','K','125','5 / 6','M','315','10 / 11'],
 ['35.001 – 150.000 unidades','L','200','7 / 8','N','500','14 / 15'],
 ['Acima de 150.000 unidades','M','315','10 / 11','P','800','21 / 22'],
] as const
const it001BoxRanges=['1','2','3 – 6','7 – 12','13 – 20','21 – 30','31 – 42','43 – 56'] as const
const numeric=(text:string)=>Number(text.replace(',','.'))
function resultFor(c:Criterion):Answer {
 if(c.kind!=='dimensional')return c.answer
 if(!c.nominal.trim()||!c.tolerance.trim()||!c.measurement.trim())return ''
 const nominal=numeric(c.nominal),tol=numeric(c.tolerance),measurement=numeric(c.measurement)
 if(!Number.isFinite(nominal)||!Number.isFinite(tol)||!Number.isFinite(measurement)||tol<0)return ''
 return Math.abs(measurement-nominal)<=tol+0.00000001?'C':'NC'
}
const numericDisplay=(v:number|null|undefined)=>v==null?'':String(v).replace('.',',')
const decimal=(v:number|null|undefined)=>v==null?'não informado':String(v).replace('.',',')
function specification(c:Criterion){
 if(c.kind!=='dimensional')return c.group||'Verificação'
 if(c.nominal.trim()&&c.tolerance.trim())return c.nominal+' ± '+c.tolerance+' '+c.unit
 if(c.minimum||c.maximum)return (c.minimum||'—')+' a '+(c.maximum||'—')+' '+c.unit
 if(c.nominal)return 'Nominal '+c.nominal+' '+c.unit+' · sem desvio definido'
 return 'Sem desvio cadastrado'+(c.unit?' ('+c.unit+')':'')
}
export default function ItEditorDemo({officialVersions=[]}:{officialVersions?:OfficialOption[]}){
 const [step,setStep]=useState<Step>('cabecalho')
 const [documentStatus,setDocumentStatus]=useState<'Vigente'|'Em Revisão'|'Rascunho'|'Obsoleto'>('Rascunho')
 const [previewMode,setPreviewMode]=useState<'original'|'estrutura'>('original')
 const [header,setHeader]=useState<Header>({...exampleHeader})
 const [footer,setFooter]=useState<Footer>({...exampleFooter})
 const [notebook,setNotebook]=useState(exampleNotebook)
 const [notebookHtml,setNotebookHtml]=useState(()=>plainToRichHtml(exampleNotebook))
 const [richImportBusy,setRichImportBusy]=useState(false)
 const [richImportWarning,setRichImportWarning]=useState('')
 const richImportGeneration=useRef(0)
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
  const importToken=++richImportGeneration.current
  setLoadBusy(true);setLoadError('');setRichImportWarning('');setRichImportBusy(false)
  const response=await apiGet<OfficialData>('/api/its/'+encodeURIComponent(id)+'/editor-oficial')
  if(importToken!==richImportGeneration.current)return
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
  const text=data.documento_texto||''
  // Exclude the separately structured registration annex from narrative text.
  const annexAt=text.indexOf('REGISTRO DE INSPEÇÃO')
  const narrative=annexAt>150?text.slice(0,annexAt).trim():text
  const snapshot:Snapshot={
   header:newHeader,footer:newFooter,notebook:narrative,notebookHtml:plainToRichHtml(narrative),
   criteria:[...importedChecks,...importedDimensions,...importedTests],
   documentPath:data.arquivo_storage_path||null,documentName:version.arquivo_nome||'IT-oficial.docx',
   warnings:data.aviso_documento,counts,nqa:summary
  }
  setImportSnapshot(snapshot)
  setHeader({...snapshot.header});setFooter({...snapshot.footer})
  setNotebook(snapshot.notebook);setNotebookHtml(snapshot.notebookHtml)
  setCriteria(snapshot.criteria.map(c=>({...c})))
  setOriginalPath(snapshot.documentPath);setOriginalName(snapshot.documentName)
  setSourceWarning(snapshot.warnings)
  setOfficialCounts(counts);setNqaSummary(summary)
  setOfficialLoaded(option);setSourceId(id);setPreviewMode('original');setStep('previa')
  setLogo(null);setTechnicalImage(null);setTechnicalName('');setShowSpecs(true)
  const path=data.arquivo_storage_path
  if(path?.toLowerCase().endsWith('.docx')){
   setRichImportBusy(true)
   void (async()=>{
    try{
     const file=await authClient.storage.from('it-documentos').download(path)
     if(file.error||!file.data)throw new Error('Arquivo Word indisponível para conversão.')
     const imported=await importNarrativeFromDocx(file.data)
     if(importToken!==richImportGeneration.current)return
     setNotebookHtml(imported.html)
     const plain=narrativeTextFromHtml(imported.html)
     setNotebook(plain)
     setImportSnapshot(current=>current?.documentPath===path?
      {...current,notebook:plain,notebookHtml:imported.html}:current)
     if(imported.warnings.length)setRichImportWarning('Alguns elementos do Word podem exigir conferência no original.')
    }catch{
     if(importToken===richImportGeneration.current)
      setRichImportWarning('Não foi possível importar a formatação. Foi mantida uma transcrição organizada; a IT oficial continua intacta.')
    }finally{if(importToken===richImportGeneration.current)setRichImportBusy(false)}
   })()
  }else setRichImportWarning('Documento sem DOCX disponível: o conteúdo foi organizado a partir da transcrição.')
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
  // Do not let a delayed Word conversion overwrite a manual restore.
  richImportGeneration.current++
  setRichImportBusy(false)
  const source=importSnapshot
  setHeader(source?{...source.header}:{...exampleHeader})
  setFooter(source?{...source.footer}:{...exampleFooter})
  setNotebook(source?source.notebook:exampleNotebook)
  setNotebookHtml(source?source.notebookHtml:plainToRichHtml(exampleNotebook))
  setRichImportWarning('')
  setCriteria(source?source.criteria.map(c=>({...c})):exampleCriteria.map(c=>({...c})))
  setOriginalPath(source?.documentPath||null);setOriginalName(source?.documentName||'')
  setSourceWarning(source?.warnings||null);setShowSpecs(true)
  setLogo(null);setTechnicalImage(null);setTechnicalName('');setStep('cabecalho');setPreviewMode('estrutura')
 }
 const results=criteria.map(resultFor)
 const count=(a:Answer)=>results.filter(x=>x===a).length
 const checklistCriteria=criteria.filter(c=>c.origin==='checklist'||(!c.origin&&c.kind!=='dimensional'))
 const dimensionalCriteria=criteria.filter(c=>c.origin==='dimensional'||(!c.origin&&c.kind==='dimensional'))
 const specialCriteria=criteria.filter(c=>c.origin==='teste')
 const isIt001Reference=!!officialLoaded&&/^IT\s*0*01$/i.test(officialLoaded.codigo)&&officialLoaded.versao==='02/2026'
 return <section className="it-test it-new-editor" aria-label="Editor de Instrução Técnica">
  <div className="it-new-editor-toolbar">
   <label className="it-new-editor-source">IT de referência
    <select value={sourceId} disabled={loadBusy} onChange={e=>setSourceId(e.target.value)} aria-label="IT de referência">
     <option value="">Nova IT em branco</option>
     {officialVersions.map(v=><option key={v.id} value={v.id}>{v.codigo} · {v.titulo} · v{v.versao}</option>)}
    </select>
   </label>
   <button type="button" className="secondary" disabled={!sourceId||loadBusy} onClick={()=>void loadOfficial(sourceId)}>
    <RefreshCw size={16}/>{loadBusy?'Carregando…':'Importar'}
   </button>
   <label className="it-new-editor-status">Status
    <select aria-label="Status da IT" value={documentStatus} onChange={e=>setDocumentStatus(e.target.value as typeof documentStatus)}>
     <option>Vigente</option><option>Em Revisão</option><option>Rascunho</option><option>Obsoleto</option>
    </select>
   </label>
   <button type="button" className="secondary" onClick={reset}><RotateCcw size={16}/> Restaurar</button>
  </div>
  {loadError&&<p className="it-test-source-error" role="alert">{loadError}</p>}
  {richImportWarning&&<p className="it-test-source-warning" role="note">{richImportWarning}</p>}
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
    <div className="section-title"><h2>Conteúdo textual da IT</h2><span className="it-test-hint">Editor visual · Calibri</span></div>

    {richImportBusy&&<p className="it-test-source-warning" role="status">Importando a formatação do documento Word…</p>}
    {richImportWarning&&<p className="it-test-source-warning" role="note">{richImportWarning}</p>}
    <RichNarrativeEditor value={notebookHtml} readOnly={richImportBusy} onChange={html=>{
     setNotebookHtml(html);setNotebook(narrativeTextFromHtml(html))
    }}/>
    <div className="it-test-toolbar">
     <label className="it-test-upload"><ImagePlus size={17}/> Inserir imagem técnica<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>pick(e.target.files?.[0],'image')}/></label>
     {technicalImage&&<button type="button" className="secondary small" onClick={()=>{setTechnicalImage(null);setTechnicalName('')}}>Remover imagem</button>}
     <label className="it-test-checkbox"><input type="checkbox" checked={showSpecs} onChange={e=>setShowSpecs(e.target.checked)}/> Tabela de especificações</label>
    </div>
    {technicalImage&&<div className="it-test-image-preview"><img src={technicalImage} alt="Imagem técnica"/><span>{technicalName}</span></div>}

   </>}
   {step==='criterios'&&<>
    <div className="section-title"><h2>Critérios da inspeção{officialLoaded?' · '+criteria.length+' itens':''}</h2><button type="button" className="secondary" onClick={add}><Plus size={16}/> Adicionar critério</button></div>
    <div className="it-test-criteria">
     {criteria.map((c,i)=><article className="it-test-criterion" key={c.id}>
      <div className="it-test-criterion-head"><div className="it-test-criterion-identification">
       <small>{c.origin==='checklist'?'Verificação':c.origin==='dimensional'?'Dimensional':c.origin==='teste'?'Teste especial':'Critério'}{c.group?' · '+c.group:''}</small>
       <strong>{i+1}. {c.title}</strong>
      </div><div>
       <button className="secondary small" disabled={i===0} type="button" aria-label="Mover para cima" onClick={()=>move(i,-1)}><ArrowUp size={15}/></button>
       <button className="secondary small" disabled={i===criteria.length-1} type="button" aria-label="Mover para baixo" onClick={()=>move(i,1)}><ArrowDown size={15}/></button>
       <button className="secondary small" type="button" aria-label="Excluir critério" onClick={()=>setCriteria(old=>old.filter(x=>x.id!==c.id))}><Trash2 size={15}/></button>
      </div></div>
      <div className="form-grid it-test-grid">
       <label>Descrição<input value={c.title} onChange={e=>update(c.id,{title:e.target.value})}/></label>
       {c.origin==='checklist'?<label>Grupo da verificação<input value={c.group||''} onChange={e=>update(c.id,{group:e.target.value})}/></label>:
         <label>Tipo de registro<select value={c.kind} onChange={e=>update(c.id,{kind:e.target.value as Kind})}><option value="visual">C / NC / NA</option><option value="dimensional">Medição dimensional</option><option value="funcional">Teste funcional</option></select></label>}
       <label className="span-2">Orientação<textarea rows={2} value={c.notes} onChange={e=>update(c.id,{notes:e.target.value})}/></label>
       {c.kind==='dimensional'?<>
        <label>Nominal<input inputMode="decimal" value={c.nominal} onChange={e=>update(c.id,{nominal:e.target.value})}/></label>
        <label>Tolerância ±<input inputMode="decimal" value={c.tolerance} onChange={e=>update(c.id,{tolerance:e.target.value})}/></label>
        <label>Unidade<input value={c.unit} onChange={e=>update(c.id,{unit:e.target.value})}/></label>
        <label>Leitura simulada<input inputMode="decimal" value={c.measurement} onChange={e=>update(c.id,{measurement:e.target.value})}/></label>
        {officialLoaded&&!c.nominal&&!c.tolerance&&<small className="it-test-hint span-2">O cadastro oficial não informa nominal ou desvio para este parâmetro. A medição e a média são registradas na inspeção; nenhum número foi presumido.</small>}
       </>:<label>{c.origin==='checklist'?'Resposta simulada · C/NC/NA':'Resultado de exemplo'}<select value={c.answer} onChange={e=>update(c.id,{answer:e.target.value as Answer})}><option value="">Sem resposta</option><option value="C">Conforme</option><option value="NC">Não conforme</option><option value="NA">Não aplicável</option></select></label>}
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
    <div className="it-test-preview-title">
     <Eye size={20} aria-hidden="true"/>
     <div><h2>Prévia</h2></div>
    </div>
    {officialLoaded&&<div className="it-test-preview-switch" role="tablist" aria-label="Tipo de prévia">
      <button type="button" role="tab" aria-selected={previewMode==='original'}
       className={previewMode==='original'?'selected':''} onClick={()=>setPreviewMode('original')}>
       <FileText size={17}/> Documento oficial (Word)
      </button>
      <button type="button" role="tab" aria-selected={previewMode==='estrutura'}
       className={previewMode==='estrutura'?'selected':''} onClick={()=>setPreviewMode('estrutura')}>
       <ClipboardCheck size={17}/> Estrutura editável
      </button>
    </div>}
    {officialLoaded&&previewMode==='original'&&originalPath&&
     <OfficialWordPreview key={officialLoaded.id} storagePath={originalPath} fileName={originalName}/>}
    {officialLoaded&&previewMode==='original'&&!originalPath&&
     <div className="it-original-error" role="alert">Esta IT não possui um Word original disponível. Use a visualização da estrutura editável.</div>}
    {(!officialLoaded||previewMode==='estrutura')&&<div className="it-structure-preview" aria-label="Simulação da estrutura para edição">
      <header className="it-structure-heading">
       <div><span className="it-structure-stamp">PRÉVIA DE EDIÇÃO</span>
        <h3>{header.title||'Título da IT'}</h3>
        <p>{header.code||'Código não informado'} · Versão {header.revision||'—'} · Vigência {header.date?header.date.split('-').reverse().join('/'):'—'}</p>
       </div>
       <div className="it-structure-metadata">
        <span>Cliente <strong>{header.client||'A definir'}</strong></span>
        <span>Produto / SKU <strong>{header.product||'A definir'} / {header.sku||'A definir'}</strong></span>
       </div>
      </header>
      <section className="it-structure-section">
       <h3><BookOpen size={18}/> Conteúdo textual</h3>
       <p className="it-structure-help">Esta prévia reproduz títulos, negritos, listas e tabelas editados no Caderno. A paginação oficial permanece no Word original.</p>
       <div className="it-structure-body"><RichNarrativeEditor value={notebookHtml} readOnly/></div>
       {technicalImage&&<figure className="it-test-doc-figure"><img src={technicalImage} alt="Figura anexada à cópia"/><figcaption>{technicalName}</figcaption></figure>}
      </section>
      {isIt001Reference&&<section className="it-structure-section">
       <div className="it-structure-section-head"><h3>Identificação · modelo de registro</h3><span>IT 001 · Anexo</span></div>
       <p className="it-structure-help">Campos presentes no formulário oficial, sem preenchimento operacional nesta demonstração.</p>
       <div className="it-test-table-scroll"><table className="it-structure-table it-structure-identification">
        <tbody>{it001IdentityRows.map((labels,i)=><tr key={i}>
         <th scope="row">{labels[0]}</th><td> </td>
         {labels[1]?<><th scope="row">{labels[1]}</th><td> </td></>:<td colSpan={2}> </td>}
        </tr>)}</tbody>
       </table></div>
      </section>}
      {isIt001Reference&&<section className="it-structure-section">
       <div className="it-structure-section-head"><h3>Plano de amostragem · ABNT NBR 5426</h3><span>NQA 1,5%</span></div>
       <div className="it-structure-level-row"><strong>Nível de inspeção</strong><span>☐ Nível I</span><span>☐ Nível II</span><span>☐ Especial S2</span></div>
       <div className="it-structure-level-row"><strong>Quantidade amostrada</strong><span>—</span><strong>Caixas avaliadas</strong><span>—</span></div>
       <div className="it-test-table-scroll"><table className="it-structure-table it-structure-sampling">
        <thead><tr><th rowSpan={2}>Tamanho do lote</th><th colSpan={3}>Nível I · NQA 1,5%</th><th colSpan={3}>Nível II · NQA 1,5%</th></tr>
        <tr><th>Código</th><th>Amostra</th><th>Ac / Re</th><th>Código</th><th>Amostra</th><th>Ac / Re</th></tr></thead>
        <tbody>{it001SamplingRows.map(row=><tr key={row[0]}>{row.map((cell,i)=><td key={i}>{cell}</td>)}</tr>)}</tbody>
       </table></div>
       <div className="it-test-table-scroll"><table className="it-structure-table it-structure-boxes">
        <tbody><tr><th>Caixas recebidas</th>{it001BoxRanges.map(v=><td key={v}>{v}</td>)}</tr>
        <tr><th>Caixas a avaliar</th>{it001BoxRanges.map((v,i)=><td key={v}>{i+1}</td>)}</tr></tbody>
       </table></div>
       <p className="it-structure-help">A linha e o nível selecionados são destacados apenas na inspeção real, após calcular o tamanho do lote.</p>
      </section>}
      <section className="it-structure-section">
       <div className="it-structure-section-head"><h3><ClipboardCheck size={18}/> Verificações</h3><span>{checklistCriteria.length} itens</span></div>
       <p className="it-structure-help">As categorias originais (Visual, Dimensional, Olfativo, Medição e Funcional) foram preservadas.</p>
       <div className="it-test-table-scroll"><table className="it-structure-table">
        <thead><tr><th scope="col">Nº</th><th scope="col">Análise / requisito</th><th scope="col">Tipo de teste</th><th scope="col">C</th><th scope="col">NC</th><th scope="col">NA</th></tr></thead>
        <tbody>{checklistCriteria.map((c,i)=><tr key={c.id}>
         <td>{i+1}</td><td><strong>{c.title||'—'}</strong>{c.notes&&<small>{c.notes}</small>}</td><td>{c.group||'Verificação'}</td>
         <td className="it-structure-check">{resultFor(c)==='C'?'✓':'—'}</td>
         <td className="it-structure-check">{resultFor(c)==='NC'?'✓':'—'}</td>
         <td className="it-structure-check">{resultFor(c)==='NA'?'✓':'—'}</td>
        </tr>)}</tbody>
       </table></div>
      </section>
      {showSpecs&&<section className="it-structure-section">
       <div className="it-structure-section-head"><h3>Análises dimensionais</h3><span>{dimensionalCriteria.length} parâmetros</span></div>
       <p className="it-structure-help">Os valores nominais e desvios somente aparecem quando cadastrados na IT. As medições reais permanecem vinculadas a Componente / SKU durante a inspeção.</p>
       {isIt001Reference&&<div className="it-structure-dim-sku">Componente / SKU <strong>A identificar durante a inspeção</strong></div>}
       <div className="it-structure-dimension-list">
        {dimensionalCriteria.map(c=><div className="it-structure-dimension-item" key={c.id}>
         <div className="it-structure-dimension-title"><strong>{c.title}</strong><span>Equipamento / instrumento: —</span>
          <span>Cód. equipamento: —</span><span>Especificação / desvio: {specification(c)}</span></div>
         {isIt001Reference?<div className="it-structure-dimension-grid">
          {[1,3,5,7,9,2,4,6,8,10].map(index=><div key={index}><small>{index}.</small>{c.measurement&&index===1?<span>{c.measurement} {c.unit}</span>:<span>—</span>}</div>)}
         </div>:<div className="it-structure-dimension-note">Leitura de exemplo: {c.measurement?c.measurement+' '+c.unit:'Não informada'}</div>}
         {c.notes&&<p className="it-structure-help">{c.notes}</p>}
        </div>)}
       </div>
       {isIt001Reference&&<div className="it-structure-level-row"><strong>Resultado dimensional</strong><span>☐ Aprovado</span><span>☐ Reprovado</span></div>}
      </section>}
      {!!specialCriteria.length&&<section className="it-structure-section">
       <div className="it-structure-section-head"><h3>Testes especiais</h3><span>{specialCriteria.length} teste(s)</span></div>
       {specialCriteria.map(c=><div className="it-structure-special" key={c.id}>
        <strong>{c.title}</strong><p>{c.notes||'Procedimento não informado.'}</p>
        <small>Resultado de exemplo: {c.answer||'Não registrado'}</small>
       </div>)}
      </section>}
      {isIt001Reference&&<section className="it-structure-section">
       <div className="it-structure-section-head"><h3>Resultado da inspeção · modelo</h3><span>Sem dados operacionais</span></div>
       <div className="it-test-table-scroll"><table className="it-structure-table it-structure-result-table"><tbody>
        <tr><th>Resultado final</th><td>☐ Aprovado&nbsp;&nbsp; ☐ Reprovado</td></tr>
        <tr><th>Inspecionado por</th><td>—</td></tr>
        <tr><th>Data</th><td>—</td></tr>
        <tr><th>Responsável Técnico (nome/CRF)</th><td>—</td></tr>
        <tr><th>Observação / conclusão</th><td>—</td></tr>
       </tbody></table></div>
      </section>}
      <footer className="it-structure-footer">
       <span><strong>Elaboração:</strong> {footer.prepared||'Não estruturada no cadastro'}</span>
       <span><strong>Aprovação:</strong> {footer.approved||'Consulte o Word oficial'}</span>
       <span>{footer.control||'Cópia de demonstração'}</span>
      </footer>
      
    </div>}
  </div>}
  <div className="it-test-actions">
   <button className="secondary" type="button" disabled={index===0} onClick={()=>setStep(steps[index-1].key)}><ChevronLeft size={16}/> Anterior</button>
   <span>{index+1} de {steps.length}</span>
   {index<steps.length-1?<button type="button" className="primary" onClick={()=>setStep(steps[index+1].key)}>Próximo <ChevronRight size={16}/></button>:
    <button type="button" className="primary" onClick={()=>setStep('cabecalho')}><Check size={16}/> Revisar</button>}
  </div>
 </section>
}
