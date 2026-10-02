import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, Download, FileText, Loader2, MapPin, Mic, MicOff, Send, Sparkles, Upload, X } from 'lucide-react'
import { apiGet, apiPost, apiPut, supabase } from '../lib/supabase'
import { AUDIT_DEFINITIONS, getAuditDefinition, type AuditCriterion, type AuditDefinition, type RqCode } from './catalog'
import './auditorias.css'

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

async function imageToDataUrl(file:File,max=1280,quality=.78) {
  const url=URL.createObjectURL(file)
  try {
    const img=new Image()
    await new Promise<void>((resolve,reject)=>{
      img.onload=()=>resolve()
      img.onerror=()=>reject(new Error('Falha ao ler foto'))
      img.src=url
    })
    const scale=Math.min(max/img.naturalWidth,max/img.naturalHeight,1)
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale))
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale))
    const ctx=canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas indisponível')
    ctx.drawImage(img,0,0,canvas.width,canvas.height)
    return canvas.toDataURL('image/jpeg',quality)
  } finally {
    URL.revokeObjectURL(url)
  }
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

export default function AuditoriasPage({profileName}:Props) {
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
  const [listening,setListening]=useState(false)
  const [showChecklist,setShowChecklist]=useState(false)
  const [showFinish,setShowFinish]=useState(false)
  const [notice,setNotice]=useState('')
  const bottomRef=useRef<HTMLDivElement|null>(null)
  const fileRef=useRef<HTMLInputElement|null>(null)

  const definition=active ? getAuditDefinition(active.rq_code) : null
  const relevantCriteria=useMemo(()=>definition ? sectionForLocation(definition,rq016bArea) : [],[definition,rq016bArea])
  const answerKey=(key:string,local:string)=>key+'@@'+local.trim().toLowerCase()
  const answerMap=useMemo(()=>new Map(answers.map((a)=>[answerKey(a.item_key,a.local_ref),a])),[answers])
  const uniqueAnswered=useMemo(()=>new Set(answers.map((a)=>a.item_key)).size,[answers])
  const progressTotal=definition?.fixedChecklist ? definition.criteria.length : Math.max(active?.progresso_total ?? 0,uniqueAnswered)
  const progressDone=definition?.fixedChecklist ? uniqueAnswered : Math.max(active?.progresso_concluido ?? 0,uniqueAnswered)
  const progressPct=progressTotal ? Math.min(100,Math.round((progressDone/progressTotal)*100)) : 0

  useEffect(()=>{ void loadAuditHome() },[])
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[messages.length,loading])
  useEffect(()=>{
    return ()=>{ if(photoPreview) URL.revokeObjectURL(photoPreview) }
  },[photoPreview])

  async function loadAuditHome() {
    setLoadingPage(true)
    const loaded=await apiGet<any>('/api/auditorias/bootstrap')
    if (!loaded.error && loaded.data) {
      setExecutions((loaded.data.executions ?? []) as AuditExecution[])
      setTemplates((loaded.data.templates ?? []) as TemplateRow[])
    }
    setLoadingPage(false)
  }

  async function loadTemplates() {
    const loaded=await apiGet<any>('/api/auditorias/bootstrap')
    if (!loaded.error && loaded.data) setTemplates((loaded.data.templates ?? []) as TemplateRow[])
  }


  async function uploadTemplate(def:AuditDefinition,file:File|null) {
    if (!file) return
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
      const db=await supabase.from('auditoria_templates').update({
        storage_path:path,
        arquivo_nome:file.name,
        rq_version:def.version,
        ativo:true,
        atualizado_em:new Date().toISOString()
      }).eq('rq_code',def.code)
      if (db.error) throw db.error
      await loadTemplates()
      setNotice(def.displayCode+': modelo oficial atualizado com sucesso.')
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível enviar o modelo oficial.')
    } finally {
      setTemplateUploading(null)
    }
  }

  async function loadExecutions() {
    setLoadingPage(true)
    const loaded=await apiGet<any>('/api/auditorias/bootstrap')
    if (!loaded.error && loaded.data) setExecutions((loaded.data.executions ?? []) as AuditExecution[])
    setLoadingPage(false)
  }


  async function startAudit(def:AuditDefinition) {
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
      setLoading(false)
    }
  }


  async function openAudit(id:string) {
    setLoading(true)
    setNotice('')
    try {
      const loaded=await apiGet<any>(`/api/auditorias/${id}/detalhe`)
      if (loaded.error || !loaded.data?.execution) throw new Error(loaded.error?.message || 'Não foi possível abrir a auditoria.')
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
      setCurrentLocation('')
      setRq016bArea('Ruas')
      setShowChecklist(false)
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível abrir a auditoria.')
    } finally {
      setLoading(false)
    }
  }


  async function saveManualAnswer(criterion:AuditCriterion,result:'C'|'NC'|'NA') {
    if (!active) return
    const local=definition?.code==='RQ016B' ? currentLocation.trim() : ''
    if (definition?.code==='RQ016B' && !local) {
      setNotice('Informe o local avaliado antes de marcar o checklist.')
      return
    }
    setNotice('')
    const saved=await apiPut<any>(`/api/auditorias/${active.id}/respostas/${encodeURIComponent(criterion.key)}`,{
      resultado:result,
      localRef:local,
      observacao:'Registro manual do auditor',
      confianca:1,
      progressoTotalEsperado:definition?.fixedChecklist ? definition.criteria.length : 0,
    })
    if (saved.error || !saved.data?.resposta) return setNotice(saved.error?.message || 'Falha ao salvar resposta.')
    const row=saved.data.resposta as AuditAnswer
    const next=[...answers.filter((a)=>!(a.item_key===row.item_key && a.local_ref===row.local_ref)),row]
    setAnswers(next)
    setActive((prev)=>prev ? {...prev,progresso_concluido:saved.data.progresso_concluido,progresso_total:saved.data.progresso_total} : prev)
  }


  function choosePhoto(file:File|null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhoto(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : '')
  }

  async function sendMessage() {
    if (!active || !definition || (!draft.trim() && !photo) || loading) return
    const text=draft.trim() || 'Foto registrada para análise.'
    setDraft('')
    setLoading(true)
    setNotice('')
    try {
      let photoPath:string|null=null
      let imageDataUrl:string|undefined
      if (photo) {
        imageDataUrl=await imageToDataUrl(photo)
        const user=await supabase.auth.getUser()
        const ext=(photo.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase()
        photoPath=`${user.data.user?.id || 'user'}/${active.id}/${Date.now()}.${ext}`
        const upload=await supabase.storage.from('auditoria-evidencias').upload(photoPath,photo,{upsert:false,contentType:photo.type || 'image/jpeg'})
        if (upload.error) throw upload.error
      }

      const criteriaForAi=(definition.code==='RQ016B' ? relevantCriteria : definition.criteria).map((criterion)=>({
        key:criterion.key,label:criterion.label,section:criterion.section,
      }))
      const state={
        currentLocation,
        area:definition.code==='RQ016B'?rq016bArea:null,
        answers:answers.map((a)=>({key:a.item_key,local:a.local_ref,result:a.resultado})),
        findings:findings.map((finding)=>({criteria:finding.criterios,location:finding.local_ref,address:finding.endereco,description:finding.descricao_tecnica})),
        objects:objects.map((obj)=>({type:obj.objeto_tipo,key:obj.chave,identification:obj.identificacao,location:obj.local_ref,status:obj.status})),
      }

      const processed=await apiPost<any>(`/api/auditorias/${active.id}/mensagens`,{
        rqCode:definition.code,
        message:text,
        imageDataUrl,
        criteria:criteriaForAi,
        state,
        currentLocation:currentLocation || null,
        area:definition.code==='RQ016B'?rq016bArea:null,
        photoPath,
        photoMime:photo?.type || null,
        fixedChecklist:definition.fixedChecklist,
        criteriaCount:definition.criteria.length,
      })
      if (processed.error) throw new Error(processed.error.message || 'Não foi possível registrar a mensagem.')

      choosePhoto(null)
      await openAudit(active.id)
      if (processed.data?.finishRequested) await requestFinish()
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível registrar a mensagem.')
    } finally {
      setLoading(false)
    }
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
      setNotice('Ainda não identifiquei nenhum extintor ou hidrante. Informe pelo menos a identificação/local do equipamento antes de concluir.')
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
          msg=body?.detail || msg
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
      const fresh=await supabase.from('auditoria_execucoes').select('*').eq('id',execution.id).single()
      if (fresh.data) setActive(fresh.data as AuditExecution)
      const integration=await supabase.functions.invoke('sgq-auditoria-integracao',{body:{executionId:execution.id}})
      if (integration.data?.configured && integration.data?.sent) setNotice('Word oficial gerado e enviado para o Power Automate.')
      else setNotice('Word oficial gerado. A integração HTTP do Power Automate ainda não está configurada.')
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
    const signed=await supabase.storage.from('auditoria-relatorios').createSignedUrl(active.documento_storage_path,300)
    setDocumentLoading(false)
    if (signed.error || !signed.data?.signedUrl) {
      setNotice('Não foi possível abrir o Word armazenado.')
      return
    }
    window.open(signed.data.signedUrl,'_blank','noopener,noreferrer')
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


  function startVoice() {
    const Ctor=(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) {
      setNotice('Ditado por voz não está disponível neste navegador. No Chrome/Edge mobile ele costuma funcionar.')
      return
    }
    const rec=new Ctor()
    rec.lang='pt-BR'
    rec.interimResults=false
    rec.continuous=false
    rec.onstart=()=>setListening(true)
    rec.onend=()=>setListening(false)
    rec.onerror=()=>setListening(false)
    rec.onresult=(event:any)=>{
      const heard=String(event.results?.[0]?.[0]?.transcript || '').trim()
      if (heard) setDraft((x)=>x ? x+' '+heard : heard)
    }
    rec.start()
  }

  if (loadingPage) return <section className="audit-center"><Loader2 className="spin"/> Carregando auditorias…</section>

  if (!active) {
    const readyCount=templates.filter((t)=>t.ativo && t.storage_path).length
    return (
      <section className="audit-page">
        <div className="audit-hero">
          <div>
            <span className="eyebrow">QUALIDADE · CAMPO</span>
            <h1>Assistente de inspeções</h1>
            <p>Escolha o registro. Durante a inspeção, converse normalmente, dite ou fotografe a evidência. O sistema estrutura os achados no modelo oficial.</p>
          </div>
          <div className="audit-hero-icon"><Sparkles size={28}/></div>
        </div>

        {notice && <div className="audit-notice">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}

        <div className="audit-template-panel">
          <div>
            <span className="eyebrow">MODELOS OFICIAIS</span>
            <strong>{readyCount}/4 modelos disponíveis para geração do Word</strong>
            <small>O sistema preenche uma cópia do arquivo mestre e preserva o original.</small>
          </div>
          <div className="audit-template-list">
            {AUDIT_DEFINITIONS.map((def)=>{
              const ready=Boolean(templates.find((x)=>x.rq_code===def.code)?.storage_path)
              return (
                <label className={'audit-template-chip '+(ready?'ready':'missing')} key={def.code}>
                  {templateUploading===def.code ? <Loader2 className="spin" size={15}/> : ready ? <Check size={15}/> : <Upload size={15}/>}
                  <span>{def.displayCode}</span>
                  <small>{ready?'Modelo carregado':'Enviar .docx'}</small>
                  <input hidden type="file" accept=".docx" onChange={(e)=>void uploadTemplate(def,e.target.files?.[0] ?? null)}/>
                </label>
              )
            })}
          </div>
        </div>

        <div className="audit-grid">
          {AUDIT_DEFINITIONS.map((def)=>{
            const ready=Boolean(templates.find((x)=>x.rq_code===def.code)?.storage_path)
            return (
              <article className="audit-card" key={def.code}>
                <div className="audit-card-head">
                  <span className="audit-code">{def.displayCode}</span>
                  <span className={'audit-model-pill '+(ready?'ready':'')}>{ready?'Word pronto':'Modelo pendente'}</span>
                </div>
                <strong>{def.title}</strong>
                <span>{def.description}</span>
                <small>Versão {def.version} · {def.requiresPhoto?'Foto disponível':'Sem foto no modelo'}</small>
                <button className="audit-start-button" onClick={()=>startAudit(def)} disabled={loading}>Iniciar inspeção <ChevronRight size={18}/></button>
              </article>
            )
          })}
        </div>

        <div className="audit-history">
          <div className="audit-section-title">
            <div><span className="eyebrow">HISTÓRICO</span><h2>Inspeções recentes</h2></div>
          </div>
          {!executions.length && <div className="audit-empty">Nenhuma inspeção deste módulo ainda.</div>}
          {executions.map((x)=>(
            <button className="audit-history-row" key={x.id} onClick={()=>openAudit(x.id)}>
              <div>
                <strong>{x.rq_code.replace('RQ','RQ ')} · {x.titulo}</strong>
                <span>{formatDate(x.data_avaliacao)} · {x.responsavel_nome || 'Responsável não informado'}{x.documento_gerado_em?' · Word gerado':''}</span>
              </div>
              <span className={'audit-status '+x.status}>{statusLabel(x.status)}</span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="audit-page audit-session">
      <div className="audit-session-header">
        <button className="audit-back" onClick={()=>{setActive(null);setMessages([]);setAnswers([]);setFindings([]);setObjects([]);setNotice('')}}><ArrowLeft size={20}/></button>
        <div className="audit-session-title">
          <span>{definition?.displayCode} · versão {definition?.version}</span>
          <strong>{definition?.title}</strong>
        </div>
        <div className="audit-progress-mini">
          {definition?.fixedChecklist ? <><b>{progressDone}/{progressTotal}</b><small>itens</small></> : definition?.code==='RQ014' ? <><b>{objects.length}</b><small>equipamentos</small></> : <><b>{findings.length}</b><small>achados</small></>}
        </div>
      </div>

      {definition?.fixedChecklist && (
        <div className="audit-progress">
          <div><span style={{width:progressPct+'%'}}/></div>
          <small>{progressPct}% do checklist classificado</small>
        </div>
      )}

      <div className="audit-context">
        {definition?.code==='RQ016B' && (
          <label>
            Área
            <select value={rq016bArea} onChange={(e)=>setRq016bArea(e.target.value)}>
              <option>Ruas</option>
              <option>Checkouts</option>
              <option>Docas</option>
            </select>
          </label>
        )}
        <label className="grow">
          <MapPin size={15}/> Local / endereço atual
          <input value={currentLocation} onChange={(e)=>setCurrentLocation(e.target.value)} placeholder={definition?.code==='RQ016B'?'Ex.: Rua 02, Checkout 04, Doca 17':definition?.code==='RQ014'?'Ex.: EXT-022 · Doca 17':'Ex.: Rua 03 / A17'}/>
        </label>
        <button className="audit-checklist-button" onClick={()=>setShowChecklist(!showChecklist)}>
          <ClipboardCheck size={17}/> Checklist
        </button>
      </div>

      {notice && <div className="audit-notice">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}

      {showChecklist && (
        <div className="audit-checklist">
          <div className="audit-checklist-head">
            <div><strong>Checklist do modelo oficial</strong><span>{definition?.code==='RQ016B' ? rq016bArea+' · informe o local para registrar' : 'Use C / NC / NA quando quiser corrigir ou completar a leitura da IA.'}</span></div>
            <button onClick={()=>setShowChecklist(false)}><X size={18}/></button>
          </div>
          <div className="audit-checklist-list">
            {relevantCriteria.map((criterion)=>{
              const local=definition?.code==='RQ016B' ? currentLocation : ''
              const current=answerMap.get(answerKey(criterion.key,local))
              return (
                <div className="audit-check-row" key={criterion.key}>
                  <div><b>{criterion.key}</b><span>{criterion.label}</span></div>
                  <div className="audit-result-actions">
                    {(['C','NC','NA'] as const).map((r)=>(
                      <button key={r} className={current?.resultado===r?'active '+r:''} onClick={()=>saveManualAnswer(criterion,r)}>{r}</button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="audit-chat">
        {messages.map((m)=>(
          <div className={'audit-bubble-row '+m.autor} key={m.id}>
            <div className="audit-bubble">
              {m.photoUrl && <img src={m.photoUrl} alt="Evidência da inspeção"/>}
              <p>{m.texto}</p>
              {m.autor==='assistente' && Array.isArray(m.metadata?.matches) && m.metadata.matches.length>0 && (
                <div className="audit-tags">{m.metadata.matches.map((x:any)=><span key={x.key}>{x.key} · {x.result}</span>)}</div>
              )}
              <small>{new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(m.criado_em))}</small>
            </div>
          </div>
        ))}
        {loading && <div className="audit-bubble-row assistente"><div className="audit-bubble typing"><Loader2 className="spin" size={16}/> Analisando o registro…</div></div>}
        <div ref={bottomRef}/>
      </div>

      {active.status!=='concluida' ? (
        <div className="audit-composer">
          {photoPreview && <div className="audit-photo-preview"><img src={photoPreview}/><button onClick={()=>choosePhoto(null)}><X size={16}/></button></div>}
          <div className="audit-input-row">
            {definition?.requiresPhoto && <>
              <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={(e)=>choosePhoto(e.target.files?.[0] ?? null)}/>
              <button className="audit-icon-button" onClick={()=>fileRef.current?.click()} title="Tirar foto"><Camera size={20}/></button>
            </>}
            <button className={'audit-icon-button '+(listening?'active':'')} onClick={startVoice} title="Ditar">{listening?<MicOff size={20}/>:<Mic size={20}/>}</button>
            <textarea value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder="Descreva o que está vendo…" rows={1} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage()}}}/>
            <button className="audit-send" onClick={()=>sendMessage()} disabled={loading || (!draft.trim()&&!photo)}><Send size={19}/></button>
          </div>
          <div className="audit-composer-foot">
            <span>{definition?.photoHint || 'Registre a ocorrência em linguagem natural.'}</span>
            <button onClick={()=>requestFinish()}><CheckCircle2 size={16}/> Finalizar inspeção</button>
          </div>
        </div>
      ) : (
        <div className="audit-completed">
          <CheckCircle2 size={22}/>
          <div><strong>Inspeção concluída</strong><span>{active.documento_gerado_em?'Word oficial gerado e arquivado no SGQ.':'O Word oficial ainda precisa ser gerado.'}</span></div>
          <button onClick={()=>downloadExisting()} disabled={documentLoading}>
            {documentLoading?<Loader2 className="spin" size={17}/>:<Download size={17}/>} {active.documento_gerado_em?'Baixar Word':'Gerar Word'}
          </button>
        </div>
      )}

      {showFinish && (
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
