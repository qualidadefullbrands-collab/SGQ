import {useEffect,useMemo,useState} from 'react'
import {AlertTriangle,CheckCircle2,ClipboardCheck,Plus,RefreshCw,Save,SlidersHorizontal,Wrench} from 'lucide-react'
import {authClient} from '../lib/supabase'
import type {Equipment} from './equipmentData'

type EventRow={id:string;equipamento_id:string;tipo:string;data_evento:string;proximo_vencimento:string|null;resultado:string;prestador:string|null;documento_url:string|null;observacoes:string|null}
type EventDraft={tipo:string;data_evento:string;proximo_vencimento:string;resultado:string;prestador:string;documento_url:string;observacoes:string}
const blank=():Partial<Equipment>=>({codigo:'',nome:'',tipo:'instrumento',fabricante:'',modelo:'',numero_serie:'',patrimonio:'',setor:'',localizacao:'',responsavel:'',unidade:'',faixa_medicao:'',resolucao:'',tolerancia:'',aplicacoes:[],requer_calibracao:false,ultima_calibracao:null,proxima_calibracao:null,certificado_calibracao:'',laboratorio_calibracao:'',periodicidade_calibracao_meses:null,proxima_verificacao:null,proxima_manutencao:null,estado:'ativo',observacoes:''})
const localDate=(date=new Date())=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const pick=(type:string)=>parts.find(p=>p.type===type)?.value||''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}
const newEvent=():EventDraft=>({tipo:'calibracao',data_evento:localDate(),proximo_vencimento:'',resultado:'realizado',prestador:'',documento_url:'',observacoes:''})
const fmt=(x:string|null|undefined)=>{if(!x)return '—';const y=x.slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(y)?y.slice(8,10)+'/'+y.slice(5,7)+'/'+y.slice(0,4):x}
const uses=['comprimento','diametro','largura','altura','espessura','massa','volume','temperatura','forca','pressao','outros']
export default function EquipmentPage({canManage,equipments,setEquipments,busy,refresh}:{
  canManage:boolean;
  equipments:Equipment[];
  setEquipments:React.Dispatch<React.SetStateAction<Equipment[]>>;
  busy:boolean;
  refresh:()=>Promise<any>;
}) {
  const [editing,setEditing]=useState<Partial<Equipment>|null>(null)
  const [selected,setSelected]=useState<string>('')
  const [section,setSection]=useState<'historico'|'rotina'|'manutencao'|'calibracao'>('historico')
  const [routineChecks,setRoutineChecks]=useState<string[]>([])
  const [events,setEvents]=useState<EventRow[]>([])
  const [eventsLoading,setEventsLoading]=useState(false)
  const [eventsError,setEventsError]=useState('')
  const [eventDraft,setEventDraft]=useState<EventDraft>(newEvent())
  const [saving,setSaving]=useState(false)
  const [search,setSearch]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3500);return()=>window.clearTimeout(timer)},[notice])
  const [failure,setFailure]=useState('')
  const today=localDate()
  const thirty=localDate(new Date(Date.now()+30*86400000))
  const alerts=useMemo(()=>equipments.filter(e=>e.estado==='ativo'&&e.requer_calibracao&&(!e.proxima_calibracao||e.proxima_calibracao<=thirty)),[equipments,thirty])
  const shown=useMemo(()=>equipments.filter(e=>[e.nome,e.codigo,e.fabricante,e.localizacao,e.numero_serie].some(s=>String(s||'').toLowerCase().includes(search.toLowerCase()))),[equipments,search])
  useEffect(()=>{
    if(!selected){setEvents([]);setEventsError('');return}
    let valid=true
    setEventsLoading(true);setEventsError('')
    Promise.resolve(authClient.from('sgq_equipamento_eventos').select('*').eq('equipamento_id',selected)
      .order('data_evento',{ascending:false}))
      .then(({data,error})=>{
        if(!valid)return
        if(error){setEventsError('Não foi possível carregar o histórico. Tente abrir o equipamento novamente.');setEvents([])}
        else setEvents((data||[]) as EventRow[])
      }).catch(()=>{
        if(valid){setEventsError('Falha na conexão com o histórico.');setEvents([])}
      }).finally(()=>{if(valid)setEventsLoading(false)})
    return()=>{valid=false}
  },[selected])
  async function saveEquipment(e:React.FormEvent){
    e.preventDefault();if(!editing||!canManage||saving)return
    setFailure('');setNotice('');setSaving(true)
    const value={...editing,codigo:String(editing.codigo||'').trim().toUpperCase(),nome:String(editing.nome||'').trim(),aplicacoes:editing.aplicacoes||[],dados_origem:editing.dados_origem||{}}
    const {id:equipmentId,criado_em:ignored,atualizado_em:ignored2,...payload}=value as Equipment & {criado_em?:string;atualizado_em?:string}
    void ignored;void ignored2
    const {data,error}=equipmentId
      ?await authClient.from('sgq_equipamentos').update({...payload,atualizado_em:new Date().toISOString()}).eq('id',equipmentId).select('*').single()
      :await authClient.from('sgq_equipamentos').insert(payload).select('*').single()
    setSaving(false)
    if(error){setFailure(error.message);return}
    setEquipments(old=>[...(old.filter(x=>x.id!==data.id)),data as Equipment].sort((a,b)=>a.nome.localeCompare(b.nome)))
    setEditing(null);setSelected(data.id);setNotice('Equipamento salvo.')
  }
  async function saveEvent(e:React.FormEvent){
    e.preventDefault();if(!selected||saving||!canManage)return
    setSaving(true);setFailure('');setNotice('')
    const {data:{user}}=await authClient.auth.getUser()
    const {data,error}=await authClient.from('sgq_equipamento_eventos').insert({
      equipamento_id:selected,tipo:eventDraft.tipo,data_evento:eventDraft.data_evento,
      proximo_vencimento:eventDraft.proximo_vencimento||null,resultado:eventDraft.resultado,
      prestador:eventDraft.prestador||null,documento_url:eventDraft.documento_url||null,
      observacoes:[eventDraft.observacoes||'',...(eventDraft.tipo==='verificacao'?['Checklist de rotina: '+(routineChecks.length?routineChecks.join('; '):'Não informado')]:[])].filter(Boolean).join(' | ')||null,responsavel_id:user?.id
    }).select('*').single()
    if(error){setFailure(error.message);setSaving(false);return}
    setEvents(old=>[data as EventRow,...old])
    const field=eventDraft.tipo==='calibracao'?'proxima_calibracao':eventDraft.tipo==='verificacao'?'proxima_verificacao':'proxima_manutencao'
    const last=eventDraft.tipo==='calibracao'?{ultima_calibracao:eventDraft.data_evento}:{}
    const patch={...last,[field]:eventDraft.proximo_vencimento||null,atualizado_em:new Date().toISOString()}
    const {data:equipment,error:equipmentError}=await authClient.from('sgq_equipamentos').update(patch).eq('id',selected).select('*').single()
    if(!equipmentError && equipment) setEquipments(old=>old.map(x=>x.id===selected?equipment as Equipment:x))
    if(equipmentError)setFailure('Evento salvo; verifique o vencimento no cadastro: '+equipmentError.message)
    else setNotice('Evento e vencimento atualizados.')
    setRoutineChecks([]);setEventDraft(newEvent());setSaving(false);setSection('historico')
  }
  const field=(label:string,name:keyof Equipment,opts?:{type?:string,placeholder?:string})=>(
    <label key={name}>{label}<input type={opts?.type||'text'} placeholder={opts?.placeholder} value={String(editing?.[name]??'')} onChange={e=>setEditing(old=>({...old,[name]:e.target.value||null}))}/></label>
  )
  return <section className="workspace equipment-page">
    <div className="page-title"><div><span className="eyebrow">PATRIMÔNIO · CONTROLE METROLÓGICO</span><h1>Equipamentos e instrumentos</h1><p>Disponibilidade, verificações, calibrações e manutenção em um só lugar.</p></div>
      <div className="row-actions"><button className="secondary" type="button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/> Atualizar</button>{canManage&&<button className="primary" type="button" onClick={()=>setEditing(blank())}><Plus size={17}/> Cadastrar equipamento</button>}</div></div>
    {notice&&<div className="alert success" role="status">{notice}</div>}
    {failure&&<div className="alert error" role="alert">{failure}</div>}
    <div className="equipment-summary">
      <div><strong>{equipments.length}</strong><span>Equipamentos cadastrados</span></div>
      <div><strong>{equipments.filter(e=>e.estado==='ativo').length}</strong><span>Ativos</span></div>
      <div><strong>{alerts.filter(e=>!e.proxima_calibracao||e.proxima_calibracao<today).length}</strong><span>Calibração pendente/vencida</span></div>
      <div><strong>{alerts.filter(e=>e.proxima_calibracao&&e.proxima_calibracao>=today).length}</strong><span>Vencem em até 30 dias</span></div>
    </div>
    {alerts.length>0&&<div className="equipment-alerts"><AlertTriangle size={17}/><span><strong>Atenção à calibração:</strong> {alerts.map(e=>e.codigo).join(', ')}. Instrumentos vencidos ou sem data não ficam disponíveis para dimensionais.</span></div>}
    <div className="equipment-toolbar"><SlidersHorizontal size={17}/><input aria-label="Buscar equipamentos" placeholder="Buscar por código, nome, local ou número de série" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {!equipments.length&&<div className="panel section-card"><h2>Cadastro preparado</h2><p>A base está vazia. Cadastre instrumentos manualmente ou importe os registros da planilha quando ela estiver acessível. Nenhum equipamento foi inventado.</p></div>}
    <div className="equipment-list">
      {shown.map(e=><article key={e.id} className={'equipment-row '+(selected===e.id?'selected':'')}>
        <div><b>{e.codigo} · {e.nome}</b><span>{[String(e.dados_origem?.tipo_controle||'Controle de rotina'),e.localizacao,e.patrimonio].filter(Boolean).join(' · ')}</span></div>
        <div><span className={'equipment-status '+(e.estado==='ativo'?'valid':'inactive')}>{e.estado.replaceAll('_',' ')}</span>{e.requer_calibracao&&<small>Próxima calibração: {fmt(e.proxima_calibracao)}</small>}</div>
        <div className="equipment-actions"><button className="secondary small" type="button" onClick={()=>setSelected(selected===e.id?'':e.id)}><ClipboardCheck size={15}/> Histórico</button>{canManage&&<button className="secondary small" type="button" onClick={()=>setEditing({...e})}><Wrench size={15}/> Editar</button>}</div>
      </article>)}
    </div>
    {selected&&<div className="panel section-card equipment-history">
      <div className="section-title"><h2>Histórico do equipamento</h2><button className="secondary small" onClick={()=>setSelected('')} type="button">Fechar</button></div>
      {section==='historico' && <div className="equipment-events">{eventsLoading?<p>Carregando histórico…</p>:eventsError?<p role="alert">{eventsError}</p>:events.length?events.map(e=><div key={e.id}><b>{e.tipo.replaceAll('_',' ')}</b><span>{fmt(e.data_evento)} · {e.resultado}{e.proximo_vencimento?' · Próximo: '+fmt(e.proximo_vencimento):''}</span>{e.observacoes&&<small>{e.observacoes}</small>}{e.documento_url&&<a href={e.documento_url} target="_blank" rel="noreferrer">Certificado / evidência</a>}</div>):<p>Nenhum evento cadastrado.</p>}</div>}
      <div className="equipment-section-tabs">
        {([['historico','Histórico'],['rotina','Verificação de rotina'],['manutencao','Manutenção'],['calibracao','Calibração']] as const).map(([k,label])=><button className={section===k?'active':''} type="button" key={k} onClick={()=>{
          setSection(k)
          if(k!=='historico')setEventDraft(old=>({...old,tipo:k==='rotina'?'verificacao':k==='calibracao'?'calibracao':'manutencao_preventiva'}))
        }}>{label}</button>)}
      </div>
      {section==='rotina' && <div className="routine-checklist"><h3>Checklist de verificação de rotina</h3>
        {['Identificação legível e íntegra','Condições físicas e conservação','Funcionamento verificado','Limpeza e armazenamento adequados'].map(label=><label key={label}><input type="checkbox" checked={routineChecks.includes(label)} onChange={e=>setRoutineChecks(old=>e.target.checked?[...old,label]:old.filter(v=>v!==label))}/>{label}</label>)}
      </div>}
      {canManage&&section!=='historico'&&<form onSubmit={saveEvent} className="equipment-event-form">
        <h3>{section==='rotina'?'Registrar verificação de rotina':section==='calibracao'?'Registrar calibração':'Registrar manutenção'}</h3>
        {section==='manutencao'&&<label>Tipo de manutenção<select value={eventDraft.tipo} onChange={e=>setEventDraft({...eventDraft,tipo:e.target.value})}><option value="manutencao_preventiva">Preventiva</option><option value="manutencao_corretiva">Corretiva</option></select></label>}
        <label>Data<input required type="date" value={eventDraft.data_evento} onChange={e=>setEventDraft({...eventDraft,data_evento:e.target.value})}/></label>
        <label>Próximo vencimento<input type="date" value={eventDraft.proximo_vencimento} onChange={e=>setEventDraft({...eventDraft,proximo_vencimento:e.target.value})}/></label>
        <label>Resultado<select value={eventDraft.resultado} onChange={e=>setEventDraft({...eventDraft,resultado:e.target.value})}><option value="realizado">Realizado</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option><option value="pendente">Pendente</option></select></label>
        <label>Prestador<input value={eventDraft.prestador} onChange={e=>setEventDraft({...eventDraft,prestador:e.target.value})}/></label>
        <label>Link do certificado<input type="url" value={eventDraft.documento_url} onChange={e=>setEventDraft({...eventDraft,documento_url:e.target.value})}/></label>
        <label className="span-2">Observações<textarea rows={2} value={eventDraft.observacoes} onChange={e=>setEventDraft({...eventDraft,observacoes:e.target.value})}/></label>
        <button className="primary" disabled={saving} type="submit"><Save size={16}/> Registrar evento</button>
      </form>}
    </div>}
    {editing&&<div className="modal-backdrop" onClick={()=>setEditing(null)}><form className="sample-detail inspection-edit-modal equipment-editor" onClick={e=>e.stopPropagation()} onSubmit={saveEquipment}>
      <button className="close" type="button" onClick={()=>setEditing(null)}>×</button>
      <h2>{editing.id?'Editar equipamento':'Cadastrar equipamento'}</h2>
      <div className="form-grid">
        {field('Código','codigo')}{field('Nome do equipamento','nome')}
        <label>Finalidade para uso nas inspeções<select value={editing.tipo||'instrumento'} onChange={e=>setEditing({...editing,tipo:e.target.value})}><option value="instrumento">Medição metrológica</option><option value="dimensional">Medição dimensional</option><option value="teste">Ensaio ou teste funcional</option><option value="apoio">Apoio ou conservação (não medir)</option></select></label>
        {!!editing.dados_origem?.tipo_controle && <div className="span-2 equipment-source"><b>Controle previsto na L 017</b><span>{String(editing.dados_origem.tipo_controle)}</span><small>Criticidade {String(editing.dados_origem.criticidade||'—')} · classificação original preservada</small></div>}
        {field('Fabricante','fabricante')}{field('Modelo','modelo')}{field('Número de série','numero_serie')}{field('Patrimônio','patrimonio')}
        {field('Setor','setor')}{field('Localização','localizacao')}{field('Responsável','responsavel')}
        {field('Unidade','unidade')}{field('Faixa de medição','faixa_medicao')}{field('Resolução','resolucao')}{field('Tolerância','tolerancia')}
        <label>Estado<select value={editing.estado||'ativo'} onChange={e=>setEditing({...editing,estado:e.target.value as Equipment['estado']})}><option value="ativo">Ativo</option><option value="em_manutencao">Em manutenção</option><option value="interditado">Interditado</option><option value="inativo">Inativo</option></select></label>
        <label className="check-option span-2"><input type="checkbox" checked={!!editing.requer_calibracao} onChange={e=>setEditing({...editing,requer_calibracao:e.target.checked})}/> Exige calibração periódica</label>
        {field('Última calibração','ultima_calibracao',{type:'date'})}
        {field('Próxima calibração','proxima_calibracao',{type:'date'})}
        {field('Próxima verificação','proxima_verificacao',{type:'date'})}
        {field('Próxima manutenção','proxima_manutencao',{type:'date'})}
        {field('Laboratório de calibração','laboratorio_calibracao')}
        {field('Certificado (URL ou número)','certificado_calibracao')}
        <label>Periodicidade da calibração (meses)<input type="number" min="1" value={editing.periodicidade_calibracao_meses??''} onChange={e=>setEditing({...editing,periodicidade_calibracao_meses:e.target.value?Number(e.target.value):null})}/></label>
        <div className="span-2 equipment-applications"><b>Aplicações permitidas</b><small>Selecione somente as grandezas que o instrumento pode medir.</small>
          <div>{uses.map(use=><label className="check-option" key={use}><input type="checkbox" checked={(editing.aplicacoes||[]).includes(use)} onChange={e=>setEditing({...editing,aplicacoes:e.target.checked?[...(editing.aplicacoes||[]),use]:(editing.aplicacoes||[]).filter(u=>u!==use)})}/>{use}</label>)}</div>
        </div>
        <label className="span-2">Observações<textarea value={editing.observacoes||''} onChange={e=>setEditing({...editing,observacoes:e.target.value})}/></label>
      </div>
      <button type="submit" className="primary wide" disabled={saving||!editing.nome?.trim()||!editing.codigo?.trim()}><CheckCircle2 size={16}/>{saving?'Salvando…':'Salvar equipamento'}</button>
    </form></div>}
  </section>
}
