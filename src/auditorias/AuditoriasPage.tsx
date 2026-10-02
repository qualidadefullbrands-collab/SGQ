import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, Download, FileText, Loader2, MapPin, Mic, MicOff, Send, Sparkles, Upload, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
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

const DOCS_URL=(import.meta.env.VITE_AUDIT_DOCS_URL || 'https://app-sgq-docs.onrender.com').replace(/\/$/,'')

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

  useEffect(()=>{ void Promise.all([loadExecutions(),loadTemplates()]) },[])
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[messages.length,loading])
  useEffect(()=>{
    return ()=>{ if(photoPreview) URL.revokeObjectURL(photoPreview) }
  },[photoPreview])

  async function loadTemplates() {
    const {data}=await supabase.from('auditoria_templates').select('rq_code,rq_version,arquivo_nome,storage_path,ativo').order('rq_code')
    setTemplates((data ?? []) as TemplateRow[])
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
    const {data,error}=await supabase
      .from('auditoria_execucoes')
      .select('*')
      .order('criado_em',{ascending:false})
      .limit(30)
    if (!error) setExecutions((data ?? []) as AuditExecution[])
    setLoadingPage(false)
  }

  async function startAudit(def:AuditDefinition) {
    setLoading(true)
    setNotice('')
    try {
      const date=new Date().toISOString().slice(0,10)
      const {data,error}=await supabase.from('auditoria_execucoes').insert({
        rq_code:def.code,
        rq_version:def.version,
        titulo:def.title,
        data_avaliacao:date,
        mes_referencia:monthReference(date),
        responsavel_nome:profileName || null,
        progresso_total:def.fixedChecklist ? def.criteria.length : 0,
        progresso_concluido:0,
        resumo:{origem:'chat_mobile'}
      }).select('*').single()
      if (error) throw error
      const execution=data as AuditExecution
      const intro=def.code==='RQ016B'
        ? 'Pré-avaliação iniciada. Selecione a área e informe o local atual. Registre o que encontrar por mensagem. Neste RQ não é necessário anexar fotos.'
        : def.fixedChecklist
          ? 'Avaliação iniciada. Vá registrando o que observar por texto, voz ou foto. Eu organizo os achados e acompanho os 30 itens do modelo.'
          : 'Inspeção iniciada. Informe o local/endereço atual e registre cada achado por texto, voz ou foto. Eu organizo as evidências no modelo do RQ.'
      await supabase.from('auditoria_mensagens').insert({execucao_id:execution.id,autor:'assistente',texto:intro})
      await openAudit(execution.id)
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
      const [ex,msg,res,ach]=await Promise.all([
        supabase.from('auditoria_execucoes').select('*').eq('id',id).single(),
        supabase.from('auditoria_mensagens').select('*').eq('execucao_id',id).order('criado_em'),
        supabase.from('auditoria_respostas').select('*').eq('execucao_id',id).order('criado_em'),
        supabase.from('auditoria_achados').select('*').eq('execucao_id',id).order('criado_em'),
      ])
      if (ex.error) throw ex.error
      const messageRows=(msg.data ?? []) as AuditMessage[]
      const withUrls=await Promise.all(messageRows.map(async(m)=>{
        if (!m.foto_path) return m
        const signed=await supabase.storage.from('auditoria-evidencias').createSignedUrl(m.foto_path,3600)
        return {...m,photoUrl:signed.data?.signedUrl ?? ''}
      }))
      setActive(ex.data as AuditExecution)
      setMessages(withUrls)
      setAnswers((res.data ?? []) as AuditAnswer[])
      setFindings((ach.data ?? []) as AuditFinding[])
      setCurrentLocation('')
      setRq016bArea('Ruas')
      setShowChecklist(false)
    } catch (e:any) {
      setNotice(e?.message || 'Não foi possível abrir a auditoria.')
    } finally {
      setLoading(false)
    }
  }

  async function persistProgress(nextAnswers:AuditAnswer[]) {
    if (!active || !definition) return
    const done=new Set(nextAnswers.map((a)=>a.item_key)).size
    const total=definition.fixedChecklist ? definition.criteria.length : Math.max(active.progresso_total,done)
    const {data}=await supabase.from('auditoria_execucoes').update({
      progresso_total:total,
      progresso_concluido:done,
      atualizado_em:new Date().toISOString(),
      resumo:{
        ...(active.resumo || {}),
        respostas:nextAnswers.length,
        achados:findings.length,
        ultima_localizacao:currentLocation || null,
      }
    }).eq('id',active.id).select('*').single()
    if (data) setActive(data as AuditExecution)
  }

  async function saveManualAnswer(criterion:AuditCriterion,result:'C'|'NC'|'NA') {
    if (!active) return
    const local=definition?.code==='RQ016B' ? currentLocation.trim() : ''
    if (definition?.code==='RQ016B' && !local) {
      setNotice('Informe o local avaliado antes de marcar o checklist.')
      return
    }
    setNotice('')
    const {data,error}=await supabase.from('auditoria_respostas').upsert({
      execucao_id:active.id,
      item_key:criterion.key,
      local_ref:local,
      resultado:result,
      observacao:'Registro manual do auditor',
      confianca:1,
      atualizado_em:new Date().toISOString(),
    },{onConflict:'execucao_id,item_key,local_ref'}).select('*').single()
    if (error) return setNotice(error.message)
    const row=data as AuditAnswer
    const next=[...answers.filter((a)=>!(a.item_key===row.item_key && a.local_ref===row.local_ref)),row]
    setAnswers(next)
    await persistProgress(next)
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

      const inserted=await supabase.from('auditoria_mensagens').insert({
        execucao_id:active.id,
        autor:'auditor',
        texto:text,
        foto_path:photoPath,
        foto_mime:photo?.type || null,
        metadata:{local:currentLocation || null,area:definition.code==='RQ016B'?rq016bArea:null}
      }).select('*').single()
      if (inserted.error) throw inserted.error
      const auditorMessage=inserted.data as AuditMessage
      if (photoPath) {
        const signed=await supabase.storage.from('auditoria-evidencias').createSignedUrl(photoPath,3600)
        auditorMessage.photoUrl=signed.data?.signedUrl ?? ''
      }
      setMessages((x)=>[...x,auditorMessage])

      const criteriaForAi=(definition.code==='RQ016B' ? relevantCriteria : definition.criteria).map((c)=>({key:c.key,label:c.label,section:c.section}))
      const {data:ai,error:aiError}=await supabase.functions.invoke('sgq-auditoria-assistente',{
        body:{
          rqCode:definition.code,
          message:text,
          imageDataUrl,
          criteria:criteriaForAi,
          state:{
            currentLocation,
            area:definition.code==='RQ016B'?rq016bArea:null,
            answers:answers.map((a)=>({key:a.item_key,local:a.local_ref,result:a.resultado})),
            findings:findings.map((f)=>({criteria:f.criterios,location:f.local_ref,address:f.endereco,description:f.descricao_tecnica}))
          }
        }
      })

      const interpreted=aiError ? {
        reply:'Registro salvo. A análise assistida não respondeu agora; você pode revisar pelo checklist.',
        matches:[],finding:null,finishRequested:false,degraded:true
      } : ai

      let nextAnswers=[...answers]
      for (const match of interpreted?.matches ?? []) {
        const local=String(match.location || (definition.code==='RQ016B'?currentLocation:'') || '')
        const up=await supabase.from('auditoria_respostas').upsert({
          execucao_id:active.id,
          item_key:String(match.key),
          local_ref:local,
          resultado:match.result,
          observacao:match.observation || text,
          confianca:Number(match.confidence || 0),
          origem_mensagem_id:auditorMessage.id,
          atualizado_em:new Date().toISOString(),
        },{onConflict:'execucao_id,item_key,local_ref'}).select('*').single()
        if (up.data) {
          const row=up.data as AuditAnswer
          nextAnswers=[...nextAnswers.filter((a)=>!(a.item_key===row.item_key && a.local_ref===row.local_ref)),row]
        }
      }
      setAnswers(nextAnswers)

      if (interpreted?.finding?.description || interpreted?.finding?.criteria?.length) {
        const f=interpreted.finding
        const ins=await supabase.from('auditoria_achados').insert({
          execucao_id:active.id,
          endereco:f.address || null,
          local_ref:f.location || currentLocation || null,
          criterios:f.criteria || [],
          descricao_original:text,
          descricao_tecnica:f.description || text,
          risco:f.riskSuggestion || null,
          acao_imediata:f.immediateAction || null,
          status:'pendente',
          foto_path:photoPath,
          origem_mensagem_id:auditorMessage.id,
          metadata:{ia:true}
        }).select('*').single()
        if (ins.data) setFindings((x)=>[...x,ins.data as AuditFinding])
      }

      const assistant=await supabase.from('auditoria_mensagens').insert({
        execucao_id:active.id,
        autor:'assistente',
        texto:interpreted?.reply || 'Registro interpretado.',
        metadata:{
          matches:interpreted?.matches ?? [],
          finding:interpreted?.finding ?? null,
          clarification:interpreted?.clarification ?? null,
          degraded:Boolean(interpreted?.degraded)
        }
      }).select('*').single()
      if (assistant.data) setMessages((x)=>[...x,assistant.data as AuditMessage])
      await persistProgress(nextAnswers)

      choosePhoto(null)
      if (interpreted?.finishRequested) await requestFinish(nextAnswers)
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
    setShowFinish(true)
  }

  async function confirmFinish() {
    if (!active) return
    setLoading(true)
    const now=new Date().toISOString()
    const {data,error}=await supabase.from('auditoria_execucoes').update({
      status:'concluida',
      finalizado_em:now,
      atualizado_em:now,
      power_automate_status:'aguardando_geracao_documento',
      resumo:{
        ...(active.resumo || {}),
        respostas:answers.length,
        achados:findings.length,
        observacao_integracao:'Estrutura preparada para POST HTTP via Power Automate após a geração do DOCX oficial.'
      }
    }).eq('id',active.id).select('*').single()
    setLoading(false)
    if (error) return setNotice(error.message)
    setActive(data as AuditExecution)
    setShowFinish(false)
    setNotice('Inspeção concluída. O registro ficou preparado para a etapa de geração do Word oficial e envio HTTP ao Power Automate.')
    await loadExecutions()
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

        {notice && <div className="audit-notice">{notice}</div>}

        <div className="audit-grid">
          {AUDIT_DEFINITIONS.map((def)=>(
            <button className="audit-card" key={def.code} onClick={()=>startAudit(def)} disabled={loading}>
              <div className="audit-card-head">
                <span className="audit-code">{def.displayCode}</span>
                <ChevronRight size={20}/>
              </div>
              <strong>{def.title}</strong>
              <span>{def.description}</span>
              <small>Versão {def.version} · {def.requiresPhoto?'Foto disponível':'Sem foto no modelo'}</small>
            </button>
          ))}
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
                <span>{formatDate(x.data_avaliacao)} · {x.responsavel_nome || 'Responsável não informado'}</span>
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
        <button className="audit-back" onClick={()=>{setActive(null);setMessages([]);setAnswers([]);setFindings([]);setNotice('')}}><ArrowLeft size={20}/></button>
        <div className="audit-session-title">
          <span>{definition?.displayCode} · versão {definition?.version}</span>
          <strong>{definition?.title}</strong>
        </div>
        <div className="audit-progress-mini">
          {definition?.fixedChecklist ? <><b>{progressDone}/{progressTotal}</b><small>itens</small></> : <><b>{findings.length}</b><small>achados</small></>}
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
          <input value={currentLocation} onChange={(e)=>setCurrentLocation(e.target.value)} placeholder={definition?.code==='RQ016B'?'Ex.: Rua 02, Checkout 04, Doca 17':'Ex.: Doca 17, Rua 03 / A17, EXT-022'}/>
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
          <CheckCircle2 size={22}/><div><strong>Inspeção concluída</strong><span>Word oficial: etapa de geração em preparação · Power Automate: aguardando integração HTTP.</span></div>
        </div>
      )}

      {showFinish && (
        <div className="audit-modal-backdrop">
          <div className="audit-modal">
            <div className="audit-modal-icon"><FileText size={24}/></div>
            <h2>Concluir {definition?.displayCode}?</h2>
            <p>Serão consolidados {answers.length} registros de checklist e {findings.length} achado(s). Depois da conclusão, a próxima etapa é gerar uma cópia preenchida do Word oficial e enviar o payload para o Power Automate.</p>
            <div className="audit-finish-stats">
              <span><b>{answers.filter((x)=>x.resultado==='C').length}</b> C</span>
              <span><b>{answers.filter((x)=>x.resultado==='NC').length}</b> NC</span>
              <span><b>{answers.filter((x)=>x.resultado==='NA').length}</b> NA</span>
              <span><b>{findings.length}</b> achados</span>
            </div>
            <div className="audit-modal-actions">
              <button className="secondary" onClick={()=>setShowFinish(false)}>Continuar inspeção</button>
              <button className="primary" onClick={()=>confirmFinish()} disabled={loading}>{loading?<Loader2 className="spin" size={16}/>:<Check size={16}/>} Concluir</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
