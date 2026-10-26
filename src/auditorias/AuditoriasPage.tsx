import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeft, ArrowUpRight, Boxes, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, Download, FileText, Flame, Layers3, Loader2, LoaderCircle, MapPin, Save, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { apiGet, apiPost, apiPut, supabase } from '../lib/supabase'
import { AUDIT_DEFINITIONS, getAuditDefinition, type AuditCriterion, type AuditDefinition, type RqCode } from './catalog'
import './auditorias.css'
import './warehouse-unified.css'

type AuditExecution = {
  id:string
  rq_code:RqCode
  rq_version:string
  titulo:string
  status:'em_andamento'|'revisao'|'concluida'|'erro_integracao'
  data_avaliacao:string
  mes_referencia:string|null
  responsavel_nome:string|null
  progresso_total:number
  progresso_concluido:number
  resumo:any
  power_automate_status:string
  power_automate_resposta?:any
  documento_storage_path?:string|null
  documento_nome?:string|null
  documento_gerado_em?:string|null
  finalizado_em:string|null
  criado_em:string
}

type AuditMessage = {
  id:string
  autor:'auditor'|'assistente'|'sistema'
  texto:string
  foto_path:string|null
  metadata:any
  criado_em:string
  photoUrl?:string
}

type AuditAnswer = {
  id:string
  item_key:string
  local_ref:string
  resultado:'C'|'NC'|'NA'
  observacao:string|null
  confianca:number|null
}

type AuditFinding = {
  id:string
  endereco:string|null
  local_ref:string|null
  criterios:string[]
  descricao_original:string|null
  descricao_tecnica:string|null
  risco:string|null
  acao_imediata:string|null
  status:string|null
  foto_path:string|null
}

type AuditObject = {
  id:string
  objeto_tipo:string
  chave:string
  identificacao:string|null
  local_ref:string|null
  dados:any
  criterios_nc:string[]
  status:string|null
  observacao:string|null
}

type TemplateRow = {
  rq_code:RqCode
  rq_version:string
  arquivo_nome:string
  storage_path:string|null
  ativo:boolean
}

type Props = {
  profileName?: string | null
  canDelete?: boolean
  canManageTemplates?: boolean
}

const DOCS_URL=((import.meta.env.VITE_API_URL || 'https://app-sgq-api.onrender.com').replace(/\/$/,'') + '/api/auditorias')

function monthReference(date:string) {
  if (!date) return ''
  const d=new Date(date+'T12:00:00')
  return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(d)
}

function formatDate(value:string) {
  if (!value) return '—'
  const d=new Date(value.length===10 ? value+'T12:00:00' : value)
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d)
}

function sectionForLocation(def:AuditDefinition, area:string) {
  if (def.code!=='RQ016B' || !area) return def.criteria
  return def.criteria.filter((c)=>c.section===area)
}

function statusLabel(value:string) {
  const map:Record<string,string>={
    em_andamento:'Em andamento',
    revisao:'Revisão final',
    concluida:'Concluída',
    erro_integracao:'Concluída · integração pendente',
  }
  return map[value] ?? value
}

export default function AuditoriasPage({profileName,canDelete=false,canManageTemplates=false}:Props) {
  const [executions,setExecutions]=useState<AuditExecution[]>([])
  const [templates,setTemplates]=useState<TemplateRow[]>([])
  const [active,setActive]=useState<AuditExecution|null>(null)
  const [messages,setMessages]=useState<AuditMessage[]>([])
  const [answers,setAnswers]=useState<AuditAnswer[]>([])
  const [findings,setFindings]=useState<AuditFinding[]>([])
  const [objects,setObjects]=useState<AuditObject[]>([])
  const [draft,setDraft]=useState('')
  const [currentLocation,setCurrentLocation]=useState('')
  const [rq016bArea,setRq016bArea]=useState('Ruas')
  const [photo,setPhoto]=useState<File|null>(null)
  const [photoPreview,setPhotoPreview]=useState('')
  const [loading,setLoading]=useState(false)
  const [loadingPage,setLoadingPage]=useState(true)
  const [documentLoading,setDocumentLoading]=useState(false)
  const [templateUploading,setTemplateUploading]=useState<RqCode|null>(null)
  const [savingRow,setSavingRow]=useState('')
  const [notes,setNotes]=useState<Record<string,string>>({})
  const [equipmentType,setEquipmentType]=useState<'extintor'|'hidrante'>('extintor')
  const [equipmentCode,setEquipmentCode]=useState('')
  const [equipmentStatus,setEquipmentStatus]=useState('pendente')
  const [equipmentNotes,setEquipmentNotes]=useState('')
  const [showChecklist,setShowChecklist]=useState(false)
  const [showFinish,setShowFinish]=useState(false)
  const [notice,setNotice]=useState('')
  const [deletionCandidate,setDeletionCandidate]=useState<AuditExecution|null>(null)
  const [deleting,setDeleting]=useState(false)
  const [deletionError,setDeletionError]=useState('')
  const [historyFilter,setHistoryFilter]=useState<'todas'|'em_andamento'|'concluida'>('todas')
  const [historySearch,setHistorySearch]=useState('')
  const [bootstrapFailed,setBootstrapFailed]=useState(false)
  const fileRef=useRef<HTMLInputElement|null>(null)
  const startRequestLock=useRef(false)
  const sendRequestLock=useRef(false)
  const openAuditVersion=useRef(0)

  const definition=active ? getAuditDefinition(active.rq_code) : null
  const readOnly=Boolean(active&&active.status!=='em_andamento'&&active.status!=='revisao')
  const relevantCriteria=useMemo(()=>definition ? sectionForLocation(definition,rq016bArea) : [],[definition,rq016bArea])
  const answerKey=(key:string,local:string)=>key+'@@'+local.trim().toLowerCase()
  const answerMap=useMemo(()=>new Map(answers.map((a)=>[answerKey(a.item_key,a.local_ref),a])),[answers])
  const uniqueAnswered=useMemo(()=>new Set(answers.map((a)=>a.item_key)).size,[answers])
  const progressTotal=definition?.fixedChecklist ? definition.criteria.length : Math.max(active?.progresso_total ?? 0,uniqueAnswered)
  const progressDone=definition?.fixedChecklist ? uniqueAnswered : Math.max(active?.progresso_concluido ?? 0,uniqueAnswered)
  const progressPct=progressTotal ? Math.min(100,Math.round((progressDone/progressTotal)*100)) : 0
  const openCount=executions.filter(x=>x.status==='em_andamento'||x.status==='revisao').length
  const finishedCount=executions.filter(x=>x.status==='concluida'||x.status==='erro_integracao').length
  const visibleExecutions=useMemo(()=>executions.filter(x=>{
    const inGroup=historyFilter==='todas'||(historyFilter==='concluida'
      ? x.status==='concluida'||x.status==='erro_integracao'
      : x.status==='em_andamento'||x.status==='revisao')
    const term=historySearch.trim().toLocaleLowerCase('pt-BR')
    return inGroup&&(!term||[x.titulo,x.rq_code,x.responsavel_nome].some(value=>String(value??'').toLocaleLowerCase('pt-BR').includes(term)))
  }),[executions,historyFilter,historySearch])

  useEffect(()=>{ void loadAuditHome() },[])
  useEffect(()=>{
    if(!notice)return
    const timer=window.setTimeout(()=>setNotice(''),5500)
    return()=>window.clearTimeout(timer)
  },[notice])
  useEffect(()=>{
    return ()=>{ if(photoPreview) URL.revokeObjectURL(photoPreview) }
  },[photoPreview])

  async function loadAuditHome() {
    setLoadingPage(true)
    const loaded=await apiGet<any>('/api/auditorias/bootstrap')
    if (!loaded.error && loaded.data) {
      setExecutions((loaded.data.executions ?? []) as AuditExecution[])
      setTemplates((loaded.data.templates ?? []) as TemplateRow[])
      setBootstrapFailed(false)
    } else {
      setBootstrapFailed(true)
      setNotice(loaded.error?.message || 'Não foi possível carregar as inspeções do armazém.')
    }
    setLoadingPage(false)
  }

  async function loadTemplates() {
    const loaded=await apiGet<any>('/api/auditorias/bootstrap')
    if (!loaded.error && loaded.data) setTemplates((loaded.data.templates ?? []) as TemplateRow[])
  }


  async function uploadTemplate(def:AuditDefinition,file:File|null) {
    if (!file) return
    if(!canManageTemplates){setNotice('Apenas administradores e gestores podem alterar os modelos oficiais.');return}
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setNotice('O modelo precisa ser um arquivo .docx.')
      return
    }
    setTemplateUploading(def.code)
    setNotice('')
    try {
      const path=def.code+'.docx'
      const up=await supabase.storage.from('auditoria-modelos').upload(path,file,{
        upsert:true,
        contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })
      if (up.error) throw up.error
      const saved=await apiPut<any>(`/api/auditorias/templates/${def.code}`,{
        storagePath:path,
        arquivoNome:file.name,
        rqVersion:def.version,
      })
      if (saved.error) throw new Error(saved.error.message)
      await loadTemplates()
      setNotice(def.displayCode+': modelo oficial atualizado com sucesso.')
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível enviar o modelo oficial.')
    } finally {
      setTemplateUploading(null)
    }
  }


  async function loadExecutions() {
    // Do not blank the entire open inspection just to refresh its list.
    const loaded=await apiGet<any>('/api/auditorias/bootstrap')
    if (!loaded.error && loaded.data) setExecutions((loaded.data.executions ?? []) as AuditExecution[])
    else setNotice(loaded.error?.message||'Não foi possível atualizar a lista das inspeções.')
  }


  async function startAudit(def:AuditDefinition) {
    if(startRequestLock.current)return
    startRequestLock.current=true
    setLoading(true)
    setNotice('')
    try {
      const date=new Date().toISOString().slice(0,10)
      const created=await apiPost<any>('/api/auditorias/criar',{
        rqCode:def.code,
        rqVersion:def.version,
        titulo:def.title,
        dataAvaliacao:date,
        mesReferencia:monthReference(date),
        responsavelNome:profileName || null,
        progressoTotal:def.fixedChecklist ? def.criteria.length : 0,
        fixedChecklist:def.fixedChecklist,
      })
      if (created.error || !created.data?.id) throw new Error(created.error?.message || 'Não foi possível iniciar a auditoria.')
      await openAudit(created.data.id)
      await loadExecutions()
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível iniciar a auditoria.')
    } finally {
      startRequestLock.current=false
      setLoading(false)
    }
  }


  async function openAudit(id:string,keepNotice=false,preserveContext=false) {
    const requestVersion=++openAuditVersion.current
    setLoading(true)
    if(!keepNotice)setNotice('')
    try {
      const loaded=await apiGet<any>(`/api/auditorias/${id}/detalhe`)
      if (loaded.error || !loaded.data?.execution) throw new Error(loaded.error?.message || 'Não foi possível abrir a auditoria.')
      if(requestVersion!==openAuditVersion.current)return
      const data=loaded.data
      const urls=data.photoUrls ?? {}
      const withUrls=((data.messages ?? []) as AuditMessage[]).map((m)=>({
        ...m,
        photoUrl:m.foto_path ? (urls[m.foto_path] ?? '') : undefined,
      }))
      setActive(data.execution as AuditExecution)
      setMessages(withUrls)
      setAnswers((data.answers ?? []) as AuditAnswer[])
      setFindings((data.findings ?? []) as AuditFinding[])
      setObjects((data.objects ?? []) as AuditObject[])
      if(!preserveContext) {
        setCurrentLocation('')
        setRq016bArea('Ruas')
        setNotes({})
        setDraft('')
      }
      setShowChecklist(true)
    } catch (e:any) {
      if(requestVersion===openAuditVersion.current)setNotice(e?.message || 'Não foi possível abrir a auditoria.')
    } finally {
      if(requestVersion===openAuditVersion.current)setLoading(false)
    }
  }


  function localForManual(){
    return definition?.code==='RQ016' ? '' : currentLocation.trim()
  }

  async function saveManualAnswer(criterion:AuditCriterion,result:'C'|'NC'|'NA') {
    if(readOnly||!active||savingRow)return
    const local=localForManual()
    if(definition?.code!=='RQ016'&&!local){
      setNotice('Informe o local ou equipamento antes de marcar o checklist.')
      return
    }
    const id=answerKey(criterion.key,local)
    const note=(notes[id]??answerMap.get(id)?.observacao??'').trim()
    setSavingRow(id)
    setNotice('')
    try{
      const saved=await apiPut<any>('/api/auditorias/'+active.id+'/respostas/'+encodeURIComponent(criterion.key),{
        resultado:result,localRef:local,observacao:note,confianca:1,
        progressoTotalEsperado:definition?.fixedChecklist ? definition.criteria.length : 0
      })
      if(saved.error||!saved.data?.resposta)throw new Error(saved.error?.message||'Não foi possível salvar este item.')
      const row=saved.data.resposta as AuditAnswer
      setAnswers(previous=>[...previous.filter(a=>!(a.item_key===row.item_key&&a.local_ref===row.local_ref)),row])
      setActive(previous=>previous?{...previous,progresso_concluido:saved.data.progresso_concluido,progresso_total:saved.data.progresso_total}:previous)
    }catch(error:any){
      setNotice(error?.message||'Falha ao salvar item. Tente novamente.')
    }finally{setSavingRow('')}
  }

  function choosePhoto(file:File|null){
    setPhoto(file)
    setPhotoPreview(file?URL.createObjectURL(file):'')
    if(fileRef.current)fileRef.current.value=''
  }

  async function saveManualRecord(){
    if(!active||readOnly||sendRequestLock.current||(!draft.trim()&&!photo))return
    sendRequestLock.current=true
    setLoading(true)
    setNotice('')
    const originalDraft=draft
    try{
      let photoPath:string|null=null
      if(photo){
        const user=await supabase.auth.getUser()
        const extension=(photo.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase()
        photoPath=(user.data.user?.id||'user')+'/'+active.id+'/'+Date.now()+'.'+extension
        const up=await supabase.storage.from('auditoria-evidencias').upload(photoPath,photo,{upsert:false,contentType:photo.type||'image/jpeg'})
        if(up.error)throw up.error
      }
      const result=await apiPost<any>('/api/auditorias/'+active.id+'/registros',{
        texto:originalDraft.trim(),fotoPath:photoPath,fotoMime:photo?.type||null,
        local:currentLocation||null,area:definition?.code==='RQ016B'?rq016bArea:null
      })
      if(result.error||!result.data)throw new Error(result.error?.message||'Não foi possível salvar o registro.')
      setDraft(old=>old===originalDraft?'':old)
      choosePhoto(null)
      await openAudit(active.id,true,true)
      setNotice('Registro salvo.')
    }catch(error:any){setNotice(error?.message||'Não foi possível salvar a evidência.')}
    finally{sendRequestLock.current=false;setLoading(false)}
  }

  async function saveEquipment(){
    if(!active||readOnly||loading)return
    if(!equipmentCode.trim()){setNotice('Informe o código do equipamento.');return}
    if(!currentLocation.trim()){setNotice('Informe o local do equipamento.');return}
    setLoading(true)
    try{
      const result=await apiPost<any>('/api/auditorias/'+active.id+'/objetos',{
        tipo:equipmentType,identificacao:equipmentCode.trim(),local:currentLocation.trim(),
        status:equipmentStatus,observacao:equipmentNotes.trim()
      })
      if(result.error||!result.data)throw new Error(result.error?.message||'Falha ao salvar equipamento.')
      const row=result.data as AuditObject
      setObjects(old=>[...old.filter(x=>!(x.objeto_tipo===row.objeto_tipo&&x.chave===row.chave)),row])
      setEquipmentCode('');setEquipmentNotes('');setEquipmentStatus('pendente')
      setNotice('Equipamento salvo.')
    }catch(error:any){setNotice(error?.message||'Falha ao salvar equipamento.')}
    finally{setLoading(false)}
  }

  async function requestFinish(nextAnswers=answers) {
    if (!active || !definition) return
    if (definition.fixedChecklist) {
      const answered=new Set(nextAnswers.map((a)=>a.item_key))
      const missing=definition.criteria.filter((c)=>!answered.has(c.key))
      if (missing.length) {
        setShowChecklist(true)
        setNotice(`Ainda existem ${missing.length} item(ns) sem C / NC / NA. Complete apenas o que falta antes de concluir.`)
        return
      }
    }
    if (definition.code==='RQ014' && objects.length===0) {
      setNotice('Cadastre ao menos um extintor ou hidrante antes de concluir.')
      return
    }
    setShowFinish(true)
  }

  async function generateWord(execution:AuditExecution,download=true) {
    setDocumentLoading(true)
    setNotice('')
    try {
      const session=await supabase.auth.getSession()
      const token=session.data.session?.access_token
      if (!token) throw new Error('Sua sessão expirou. Entre novamente.')
      const response=await fetch(DOCS_URL+'/generate/'+execution.id,{headers:{Authorization:'Bearer '+token}})
      if (!response.ok) {
        let msg='Não foi possível gerar o Word oficial.'
        try {
          const body=await response.json()
          msg=body?.detail || body?.error?.message || msg
        } catch {}
        throw new Error(msg)
      }
      const blob=await response.blob()
      const filename=response.headers.get('X-SGQ-File-Name') || execution.documento_nome || execution.rq_code+'.docx'
      if (download) {
        const href=URL.createObjectURL(blob)
        const a=document.createElement('a')
        a.href=href
        a.download=filename
        a.click()
        setTimeout(()=>URL.revokeObjectURL(href),1500)
      }
      const integration=response.headers.get('X-SGQ-Integration-Status')
      if (integration==='sent') setNotice('Word oficial gerado e enviado para o Power Automate.')
      else if (integration==='error') setNotice('Word oficial gerado. O envio ao Power Automate apresentou erro e pode ser reprocessado.')
      else setNotice('Word oficial gerado. A integração HTTP do Power Automate ainda não está configurada.')
      await openAudit(execution.id,true)
      await loadExecutions()
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível gerar o Word oficial.')
    } finally {
      setDocumentLoading(false)
    }
  }


  async function downloadExisting() {
    if (!active) return
    if (!active.documento_storage_path) {
      await generateWord(active,true)
      return
    }
    setDocumentLoading(true)
    const document=await apiGet<any>(`/api/auditorias/${active.id}/documento`)
    setDocumentLoading(false)
    if (document.error || !document.data?.url) {
      setNotice('Não foi possível abrir o Word armazenado.')
      return
    }
    window.open(document.data.url,'_blank','noopener,noreferrer')
  }


  async function confirmFinish() {
    if (!active) return
    setLoading(true)
    const finished=await apiPost<any>(`/api/auditorias/${active.id}/concluir`,{})
    if (finished.error || !finished.data) {
      setLoading(false)
      return setNotice(finished.error?.message || 'Não foi possível concluir a auditoria.')
    }
    const execution=finished.data as AuditExecution
    setActive(execution)
    setShowFinish(false)
    setLoading(false)
    await loadExecutions()
    await generateWord(execution,true)
  }


  async function deleteWarehouseInspection(){
    if(!canDelete||!deletionCandidate||deleting)return
    setDeleting(true)
    setDeletionError('')
    try{
      const id=deletionCandidate.id
      const result=await apiPost<{excluida:boolean;id:string}>(`/api/auditorias/${encodeURIComponent(id)}/excluir`,{})
      if(result.error||!result.data?.excluida){
        setDeletionError(result.error?.message||'Não foi possível excluir a inspeção. Tente novamente.')
        return
      }
      setExecutions(previous=>previous.filter(row=>row.id!==id))
      if(active?.id===id){
        setActive(null)
        setMessages([]);setAnswers([]);setFindings([]);setObjects([])
      }
      setDeletionCandidate(null)
      setNotice('Inspeção excluída da lista. O histórico e os documentos foram preservados.')
    }catch{
      setDeletionError('Não foi possível confirmar a exclusão. Verifique a conexão e tente novamente.')
    }finally{
      setDeleting(false)
    }
  }

  const deleteDialog=deletionCandidate&&(
    <div className="audit-modal-backdrop" role="presentation" onClick={()=>{if(!deleting){setDeletionCandidate(null);setDeletionError('')}}}>
      <div className="audit-modal audit-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="audit-delete-title" aria-describedby="audit-delete-description" onClick={e=>e.stopPropagation()}>
        <div className="audit-modal-icon audit-delete-icon"><Trash2 size={24}/></div>
        <h2 id="audit-delete-title">Excluir inspeção do armazém?</h2>
        <p id="audit-delete-description">A inspeção <strong>{deletionCandidate.rq_code.replace('RQ','RQ ')} · {deletionCandidate.titulo}</strong> deixará de aparecer nas listas. Seus registros, fotos e documentos serão preservados para rastreabilidade.</p>
        {deletionError&&<div className="audit-delete-error" role="alert">{deletionError}</div>}
        <div className="audit-modal-actions">
          <button type="button" className="secondary" disabled={deleting} onClick={()=>{setDeletionCandidate(null);setDeletionError('')}}>Cancelar</button>
          <button type="button" className="audit-delete-confirm" disabled={deleting} onClick={()=>void deleteWarehouseInspection()}>
            {deleting?<Loader2 className="spin" size={17}/>:<Trash2 size={17}/>} {deleting?'Excluindo…':'Excluir inspeção'}
          </button>
        </div>
      </div>
    </div>
  )

  if (loadingPage) return <section className="audit-center"><Loader2 className="spin"/> Carregando auditorias…</section>

  if (!active) {
    return (
      <section className="audit-page audit-integrated sgq-warehouse-workspace">
        <div className="page-title audit-page-title">
          <div>
            <span className="audit-contlog-brand">Contlog</span>
            <h1>Inspeções <span>Armazém</span></h1>
          </div>
        </div>

        <section className="metrics audit-overview" aria-label="Indicadores das inspeções do armazém">
          <button type="button" className={'metric-button '+(historyFilter==='todas'?'selected':'')} onClick={()=>setHistoryFilter('todas')} aria-pressed={historyFilter==='todas'}>
            <article className="metric"><ClipboardCheck size={22}/><div><strong>{executions.length}</strong><span>Inspeções</span></div></article>
          </button>
          <button type="button" className={'metric-button '+(historyFilter==='em_andamento'?'selected':'')} onClick={()=>setHistoryFilter('em_andamento')} aria-pressed={historyFilter==='em_andamento'}>
            <article className="metric"><Activity size={22}/><div><strong>{openCount}</strong><span>Em andamento</span></div></article>
          </button>
          <button type="button" className={'metric-button '+(historyFilter==='concluida'?'selected':'')} onClick={()=>setHistoryFilter('concluida')} aria-pressed={historyFilter==='concluida'}>
            <article className="metric"><CheckCircle2 size={22}/><div><strong>{finishedCount}</strong><span>Concluídas</span></div></article>
          </button>
        </section>

        {notice && <div className="audit-notice">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}

        {bootstrapFailed && <div className="audit-retry"><span>Falha ao consultar o histórico e os modelos do armazém.</span><button type="button" className="secondary" onClick={()=>void loadAuditHome()}>Tentar novamente</button></div>}

        {canManageTemplates && <details className="audit-template-tools">
          <summary><FileText size={16}/> Configurar documentos <ChevronRight size={16}/></summary>
          <div className="audit-template-list">
            {AUDIT_DEFINITIONS.map((def)=>{
              const ready=Boolean(templates.find((x)=>x.rq_code===def.code)?.storage_path)
              return (
                <label className={'audit-template-chip '+(ready?'ready':'missing')} key={def.code}>
                  {templateUploading===def.code ? <Loader2 className="spin" size={15}/> : ready ? <Check size={15}/> : <Upload size={15}/>}
                  <span>{def.displayCode}</span>
                  <small>{ready?'Atualizar DOCX':'Adicionar DOCX'}</small>
                  <input hidden type="file" accept=".docx" onChange={(e)=>void uploadTemplate(def,e.target.files?.[0] ?? null)}/>
                </label>
              )
            })}
          </div>
        </details>}

        <section className="panel section-card audit-new-section">
          <div className="section-title"><h2>Nova inspeção</h2></div>
          <div className="audit-grid">
            {AUDIT_DEFINITIONS.map((def)=>{
              const ready=Boolean(templates.find((x)=>x.rq_code===def.code)?.storage_path)
              return (
                <article className={'audit-card row-card audit-card-'+def.code.toLowerCase()} key={def.code}>
                  <span className="audit-card-symbol" aria-hidden="true">
                    {def.code==='RQ014'?<Flame size={22}/>:
                      def.code==='RQ015'?<Boxes size={22}/>:
                      def.code==='RQ016'?<Layers3 size={22}/>:
                      <Sparkles size={22}/>}
                  </span>
                  <div className="audit-card-content">
                    <span className="audit-code">{def.displayCode}</span>
                    <strong>{def.title}</strong>
                  </div>
                  <button type="button" className="primary audit-start-button" onClick={()=>void startAudit(def)} disabled={loading} aria-label={'Iniciar '+def.title}>
                    {ready?'Iniciar':'Iniciar sem modelo'}<ArrowUpRight size={18}/>
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel queue audit-history">
          <div className="section-title audit-section-title">
            <div><h2>Inspeções</h2></div>
            <div className="audit-history-controls">
              <label className="audit-history-search">Buscar no histórico
                <input value={historySearch} onChange={e=>setHistorySearch(e.target.value)} placeholder="RQ, inspeção ou responsável" />
              </label>
              <button type="button" className="secondary" onClick={()=>void loadAuditHome()} disabled={loadingPage}>Atualizar</button>
            </div>
          </div>
          {!bootstrapFailed && !visibleExecutions.length && <div className="audit-empty">{executions.length?'Nenhum resultado para o filtro.':'Nenhuma inspeção por aqui.'}</div>}
          {visibleExecutions.map((x)=>(
            <div className="queue-row audit-history-entry" key={x.id}>
              <button type="button" className="audit-history-row" onClick={()=>void openAudit(x.id)}>
                <div>
                  <strong>{x.rq_code.replace('RQ','RQ ')} · {x.titulo}</strong>
                  <span>{formatDate(x.data_avaliacao)} · {x.responsavel_nome || 'Responsável não informado'}</span>
                </div>
                <span className={'audit-status '+x.status}>{statusLabel(x.status)}</span>
              </button>
              {canDelete&&<button type="button" className="audit-delete-action" aria-label={'Excluir '+x.rq_code.replace('RQ','RQ ')+' · '+x.titulo} title="Excluir inspeção" onClick={()=>{setDeletionError('');setDeletionCandidate(x)}}>
                <Trash2 size={17}/>
              </button>}
            </div>
          ))}
        </section>
        {deleteDialog}
      </section>
    )
  }

  return (
    <section className="audit-page audit-session audit-form-screen sgq-warehouse-workspace">
      <div className="page-title audit-session-header">
        <button className="audit-back" type="button" title="Voltar" onClick={()=>{setActive(null);setMessages([]);setAnswers([]);setFindings([]);setObjects([]);setNotice('')}}><ArrowLeft size={20}/></button>
        <div className="audit-session-title">
          <span>{definition?.displayCode}</span>
          <strong>{definition?.title}</strong>
        </div>
        <div className="audit-progress-mini"><b>{progressDone}/{progressTotal||definition?.criteria.length||0}</b><small>itens</small></div>
        {canDelete&&<button type="button" className="audit-delete-action audit-session-delete" title="Excluir inspeção" aria-label="Excluir esta inspeção" onClick={()=>{setDeletionError('');setDeletionCandidate(active)}}><Trash2 size={18}/></button>}
      </div>

      {notice&&<div className="audit-notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="Fechar"><X size={15}/></button></div>}
      {definition?.fixedChecklist&&<div className="audit-progress"><div><span style={{width:progressPct+'%'}}/></div><small>{progressPct}%</small></div>}

      <div className="panel section-card audit-manual-controls">
        {definition?.code==='RQ016B'&&<label>Área
          <select value={rq016bArea} onChange={e=>setRq016bArea(e.target.value)}>
            <option>Ruas</option><option>Checkouts</option><option>Docas</option>
          </select>
        </label>}
        {definition?.code!=='RQ016'&&<label className="audit-manual-location">
          <MapPin size={15}/> Local / endereço {definition?.code==='RQ014'?'do equipamento':''}
          <input value={currentLocation} onChange={e=>setCurrentLocation(e.target.value)} placeholder="Informe o local" />
        </label>}
        <button type="button" className="audit-checklist-button" onClick={()=>setShowChecklist(x=>!x)}>
          <ClipboardCheck size={17}/> {showChecklist?'Ocultar itens':'Mostrar itens'}
        </button>
      </div>

      {definition?.code!=='RQ016'&&answers.some(row=>row.local_ref)&&(
        <div className="audit-saved-locations">
          {Array.from(new Set(answers.map(a=>a.local_ref).filter(Boolean))).map(loc=>
            <button key={loc} type="button" className={currentLocation===loc?'active':''} onClick={()=>setCurrentLocation(loc)}>{loc}</button>
          )}
        </div>
      )}

      {definition?.code==='RQ014'&&!readOnly&&(
        <section className="panel section-card audit-manual-panel">
          <h2>Equipamento</h2>
          <div className="audit-equipment-fields">
            <label>Tipo<select value={equipmentType} onChange={e=>setEquipmentType(e.target.value as 'extintor'|'hidrante')}><option value="extintor">Extintor</option><option value="hidrante">Hidrante</option></select></label>
            <label>Identificação<input value={equipmentCode} onChange={e=>setEquipmentCode(e.target.value)} placeholder="Código" /></label>
            <label>Situação<select value={equipmentStatus} onChange={e=>setEquipmentStatus(e.target.value)}><option value="pendente">Pendente</option><option value="liberado">Liberado</option><option value="bloqueado">Bloqueado</option></select></label>
            <label className="audit-equipment-notes">Observação<input value={equipmentNotes} onChange={e=>setEquipmentNotes(e.target.value)} placeholder="Observação" /></label>
            <button className="primary" type="button" disabled={loading||!equipmentCode.trim()||!currentLocation.trim()} onClick={()=>void saveEquipment()}>
              {loading?<Loader2 size={17} className="spin"/>:<Save size={17}/>} Salvar equipamento
            </button>
          </div>
        </section>
      )}
      {definition?.code==='RQ014'&&objects.length>0&&(
        <div className="audit-object-list">
          {objects.map(item=><div key={item.id}><strong>{item.identificacao||item.chave}</strong><span>{item.objeto_tipo} · {item.local_ref} · {item.status}</span></div>)}
        </div>
      )}

      {showChecklist&&<div className="audit-manual-sections">
        {Array.from(new Set(relevantCriteria.map(c=>c.section))).map(section=>(
          <section className="panel section-card audit-manual-panel" key={section}>
            <div className="audit-manual-panel-head">
              <h2>{section}</h2>
              <span>{relevantCriteria.filter(c=>c.section===section).length} itens</span>
            </div>
            <div className="audit-manual-rows">
              {relevantCriteria.filter(c=>c.section===section).map(c=>{
                const local=localForManual()
                const key=answerKey(c.key,local)
                const current=answerMap.get(key)
                const busy=savingRow===key
                return <div className={'audit-manual-row '+(current?'is-answered':'')} key={c.key}>
                  <div className="audit-manual-question"><b>{c.key}</b><span>{c.label}</span></div>
                  <div className="audit-manual-answer">
                    {(['C','NC','NA'] as const).map(result=>(
                      <button type="button" key={result}
                        aria-label={c.key+' '+result}
                        aria-pressed={current?.resultado===result}
                        className={'audit-result-'+result+(current?.resultado===result?' selected':'')}
                        disabled={readOnly||!!savingRow||loading}
                        onClick={()=>void saveManualAnswer(c,result)}>{result}</button>
                    ))}
                    {busy&&<LoaderCircle size={17} className="spin"/>}
                  </div>
                  <div className="audit-manual-observation">
                    <input aria-label={'Observação '+c.key} placeholder="Observação"
                      value={notes[key]??current?.observacao??''}
                      onChange={e=>setNotes(old=>({...old,[key]:e.target.value}))}
                      disabled={readOnly}/>
                    {!readOnly&&current&&notes[key]!==undefined&&notes[key]!==current.observacao&&
                      <button type="button" className="secondary" disabled={!!savingRow} onClick={()=>void saveManualAnswer(c,current.resultado)}>Salvar</button>}
                  </div>
                </div>
              })}
            </div>
          </section>
        ))}
      </div>}

      <section className="panel section-card audit-manual-panel audit-evidence-section">
        <div className="audit-manual-panel-head"><h2>Observações e fotos</h2><span>{messages.filter(x=>x.autor==='auditor').length} registros</span></div>
        {messages.filter(m=>m.autor==='auditor').map(m=>(
          <div className="audit-manual-evidence" key={m.id}>
            {m.photoUrl&&<img src={m.photoUrl} alt="Foto da inspeção"/>}
            <div><p>{m.texto}</p><small>{formatDate(m.criado_em)}</small></div>
          </div>
        ))}
        {!readOnly&&<div className="audit-evidence-entry">
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={3} placeholder="Observação da inspeção" aria-label="Observação da inspeção"/>
          {photoPreview&&<div className="audit-photo-preview"><img src={photoPreview} alt="Foto a enviar"/><button type="button" onClick={()=>choosePhoto(null)} aria-label="Remover foto"><X size={16}/></button></div>}
          <div className="audit-evidence-actions">
            <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>choosePhoto(e.target.files?.[0]??null)}/>
            <button type="button" className="secondary" onClick={()=>fileRef.current?.click()}><Camera size={17}/> Adicionar foto</button>
            <button type="button" className="primary" disabled={loading||(!draft.trim()&&!photo)} onClick={()=>void saveManualRecord()}>{loading?<Loader2 className="spin" size={17}/>:<Save size={17}/>} Salvar registro</button>
          </div>
        </div>}
      </section>

      <div className="audit-manual-footer">
        {!readOnly? <button type="button" className="primary" disabled={loading||documentLoading||!!savingRow} onClick={()=>void requestFinish()}><CheckCircle2 size={19}/> Concluir inspeção</button>:
        <button type="button" className="primary" disabled={documentLoading} onClick={()=>void downloadExisting()}><Download size={19}/> {active.documento_gerado_em?'Baixar Word':'Gerar Word'}</button>}
      </div>

      {deleteDialog}
      {showFinish && !deletionCandidate && (
        <div className="audit-modal-backdrop">
          <div className="audit-modal">
            <div className="audit-modal-icon"><FileText size={24}/></div>
            <h2>Concluir {definition?.displayCode}?</h2>
            <p>Serão consolidados {answers.length} registros de checklist e {findings.length} achado(s){definition?.code==='RQ014'?` e ${objects.length} equipamento(s)`:''}. O sistema gerará uma cópia preenchida do Word oficial.</p>
            <div className="audit-finish-stats">
              <span><b>{answers.filter((x)=>x.resultado==='C').length}</b> C</span>
              <span><b>{answers.filter((x)=>x.resultado==='NC').length}</b> NC</span>
              <span><b>{answers.filter((x)=>x.resultado==='NA').length}</b> NA</span>
              <span><b>{findings.length}</b> achados</span>
            </div>
            <div className="audit-modal-actions">
              <button className="secondary" onClick={()=>setShowFinish(false)}>Continuar inspeção</button>
              <button className="primary" onClick={()=>confirmFinish()} disabled={loading||documentLoading}>{loading?<Loader2 className="spin" size={16}/>:<Check size={16}/>} Concluir e gerar Word</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
