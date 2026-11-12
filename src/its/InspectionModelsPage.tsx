import {useEffect,useMemo,useState} from 'react'
import {ArrowDown,ArrowUp,CheckCircle2,ClipboardCheck,Plus,RefreshCw,Save,Search,Trash2} from 'lucide-react'
import {authClient} from '../lib/supabase'
import './InspectionModelsPage.css'

type Scope='armazem'|'qualidade'|'ambos'
type Status='rascunho'|'vigente'|'obsoleto'
type FieldType='conformidade'|'texto'|'numero'|'foto'
type ChecklistItem={id:string;titulo:string;tipo:FieldType;area:Scope;obrigatorio:boolean}
type Model={
  id:string;codigo:string;nome:string;escopo:Scope;status:Status
  checklist:ChecklistItem[];criado_por:string;atualizado_em:string
}
type Draft=Pick<Model,'codigo'|'nome'|'escopo'|'status'|'checklist'> & {id?:string}
const scopeLabels:Record<Scope,string>={armazem:'Armazém',qualidade:'Qualidade',ambos:'Armazém e Qualidade'}
const statusLabels:Record<Status,string>={rascunho:'Rascunho',vigente:'Vigente',obsoleto:'Obsoleto'}
const typeLabels:Record<FieldType,string>={conformidade:'Conforme / Não conforme',texto:'Resposta textual',numero:'Valor numérico',foto:'Evidência fotográfica'}
const sample=(titulo:string,area:Scope,tipo:FieldType='conformidade',obrigatorio=true):ChecklistItem=>({id:crypto.randomUUID(),titulo,area,tipo,obrigatorio})
const blank=():Draft=>({
 codigo:'',nome:'',escopo:'ambos',status:'rascunho',
 checklist:[
  sample('Identificação do produto, SKU e lote','ambos'),
  sample('Conferência da quantidade recebida','armazem','numero'),
  sample('Integridade das embalagens','armazem'),
  sample('Avaliação visual de conformidade','qualidade'),
  sample('Registro de evidências','qualidade','foto',false),
 ],
})
const copy=(value:Draft):Draft=>({...value,checklist:value.checklist.map(item=>({...item}))})
const getError=(error:unknown)=>error instanceof Error?error.message:String(error||'Erro inesperado')

export default function InspectionModelsPage({canManage}:{canManage:boolean}){
 const [models,setModels]=useState<Model[]>([])
 const [draft,setDraft]=useState<Draft>(()=>blank())
 const [baseline,setBaseline]=useState<Draft>(()=>blank())
 const [search,setSearch]=useState('')
 const [loading,setLoading]=useState(false)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [creating,setCreating]=useState(true)
 const changed=JSON.stringify(draft)!==JSON.stringify(baseline)
 const filtered=useMemo(()=>models.filter(row=>(row.codigo+' '+row.nome+' '+scopeLabels[row.escopo]).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))),[models,search])

 async function reload(){
  setLoading(true);setError('')
  try{
   const {data,error:dbError}=await authClient.from('sgq_modelos_inspecao')
    .select('id,codigo,nome,escopo,status,checklist,criado_por,atualizado_em')
    .order('atualizado_em',{ascending:false})
   if(dbError)throw dbError
   setModels((data||[]) as Model[])
  }catch(e){setError('Não foi possível consultar os modelos: '+getError(e))}
  finally{setLoading(false)}
 }
 useEffect(()=>{void reload()},[])
 function allowDiscard(){return !changed||window.confirm('Descartar alterações ainda não salvas?')}
 function choose(row:Model){
  if(!allowDiscard())return
  const next:Draft={id:row.id,codigo:row.codigo,nome:row.nome,escopo:row.escopo,
   status:row.status,checklist:Array.isArray(row.checklist)?row.checklist.map(x=>({...x})):[]}
  setDraft(copy(next));setBaseline(copy(next));setCreating(false);setError('');setMessage('')
 }
 function createNew(){
  if(!allowDiscard())return
  const next=blank();setDraft(copy(next));setBaseline(copy(next));setCreating(true);setError('');setMessage('')
 }
 function updateItem(id:string,patch:Partial<ChecklistItem>){
  setDraft(old=>({...old,checklist:old.checklist.map(item=>item.id===id?{...item,...patch}:item)}))
 }
 function moveItem(index:number,step:number){
  setDraft(old=>{const to=index+step;if(to<0||to>=old.checklist.length)return old
   const checklist=old.checklist.slice();[checklist[index],checklist[to]]=[checklist[to],checklist[index]]
   return {...old,checklist}})
 }
 async function save(){
  if(!canManage)return
  setError('');setMessage('')
  const code=draft.codigo.trim().toUpperCase()
  const name=draft.nome.trim()
  if(code.length<3||name.length<3){setError('Informe código e nome do modelo (mínimo 3 caracteres).');return}
  if(!/^[A-Z0-9_-]+$/.test(code)){setError('O código aceita somente letras, números, hífen e sublinhado.');return}
  if(!draft.checklist.length||draft.checklist.some(item=>item.titulo.trim().length<3)){
   setError('O checklist deve ter ao menos um item e todos os itens precisam de uma descrição.');return
  }
  if(draft.escopo!=='ambos'&&draft.checklist.some(item=>item.area!==draft.escopo&&item.area!=='ambos')){
   setError('Existem itens de outra área. Ajuste o escopo dos itens antes de salvar.');return
  }
  const checklist=draft.checklist.map(item=>({...item,titulo:item.titulo.trim()}))
  const payload={codigo:code,nome:name,escopo:draft.escopo,status:draft.status,checklist,atualizado_em:new Date().toISOString()}
  setSaving(true)
  try{
   const result=draft.id
    ?await authClient.from('sgq_modelos_inspecao').update(payload).eq('id',draft.id)
      .select('id,codigo,nome,escopo,status,checklist,criado_por,atualizado_em').single()
    :await (async()=>{
       const {data:{user},error:authError}=await authClient.auth.getUser()
       if(authError||!user)throw new Error('Sessão expirada. Entre novamente.')
       return authClient.from('sgq_modelos_inspecao').insert({...payload,criado_por:user.id})
        .select('id,codigo,nome,escopo,status,checklist,criado_por,atualizado_em').single()
      })()
   if(result.error||!result.data)throw result.error||new Error('O modelo não foi gravado.')
   const saved=result.data as Model
   const next:Draft={id:saved.id,codigo:saved.codigo,nome:saved.nome,escopo:saved.escopo,status:saved.status,checklist:saved.checklist}
   setDraft(copy(next));setBaseline(copy(next));setCreating(false)
   setModels(old=>[saved,...old.filter(item=>item.id!==saved.id)])
   setMessage('Modelo salvo com sucesso.')
  }catch(e){setError('Não foi possível salvar o modelo: '+getError(e))}
  finally{setSaving(false)}
 }
 return <section className="workspace sgq-models" aria-label="Modelos de inspeção">
  <header className="sgq-models-header">
   <div><span className="eyebrow">QUALIDADE · CONFIGURAÇÃO</span><h1>Modelos de inspeção</h1>
    <p>Defina o roteiro de inspeção, as perguntas e o escopo de aplicação. As Instruções Técnicas oficiais permanecem separadas.</p></div>
   <button type="button" className="primary" onClick={createNew} disabled={!canManage}><Plus size={17}/> Novo modelo</button>
  </header>
  {error&&<div className="alert error" role="alert">{error}</div>}
  {message&&<div className="alert success" role="status"><CheckCircle2 size={17}/>{message}</div>}
  <div className="sgq-models-layout">
   <aside className="sgq-models-list" aria-label="Modelos cadastrados">
    <div className="sgq-models-list-head"><strong>Biblioteca de modelos</strong><button className="secondary small" type="button" onClick={()=>void reload()} disabled={loading} aria-label="Atualizar modelos"><RefreshCw size={16}/></button></div>
    <label className="sgq-models-search"><Search size={16}/><input type="search" placeholder="Buscar modelo..." value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {loading&&<p className="sgq-models-empty">Carregando modelos…</p>}
    {!loading&&!filtered.length&&<p className="sgq-models-empty">Nenhum modelo encontrado.</p>}
    {filtered.map(row=><button type="button" className={'sgq-models-list-card '+(draft.id===row.id&&!creating?'is-selected':'')} key={row.id} onClick={()=>choose(row)}>
      <strong>{row.codigo} · {row.nome}</strong><span>{scopeLabels[row.escopo]} · {row.checklist?.length||0} critérios</span>
      <small data-status={row.status}>{statusLabels[row.status]}</small>
    </button>)}
   </aside>
   <div className="sgq-models-editor">
    <div className="sgq-models-editor-heading"><div><h2>{creating?'Novo modelo de inspeção':'Editar modelo'}</h2><p>Configure e valide o modelo antes de disponibilizá-lo.</p></div><ClipboardCheck size={26}/></div>
    <fieldset disabled={!canManage||saving}>
     <div className="sgq-models-form-grid">
      <label>Código do modelo<input value={draft.codigo} maxLength={40} placeholder="Ex.: INS-RECEBIMENTO" onChange={e=>setDraft(d=>({...d,codigo:e.target.value.toUpperCase()}))}/></label>
      <label>Nome do modelo<input value={draft.nome} maxLength={160} placeholder="Ex.: Inspeção de recebimento" onChange={e=>setDraft(d=>({...d,nome:e.target.value}))}/></label>
      <label>Escopo<select value={draft.escopo} onChange={e=>setDraft(d=>({...d,escopo:e.target.value as Scope}))}>{Object.entries(scopeLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
      <label>Situação<select value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value as Status}))}>{Object.entries(statusLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
     </div>
     <div className="sgq-models-checklist-heading"><div><h3>Checklist configurável</h3><p>Selecione o tipo de resposta e a área responsável por cada verificação.</p></div>
      <button className="secondary small" type="button" onClick={()=>setDraft(d=>({...d,checklist:[...d.checklist,sample('','ambos')]}))}><Plus size={16}/> Adicionar item</button>
     </div>
     <div className="sgq-models-checklist">
      {draft.checklist.map((item,index)=><div className="sgq-models-check-item" key={item.id}>
       <div className="sgq-models-check-index">{index+1}</div>
       <label className="sgq-models-check-title">Verificação<input value={item.titulo} maxLength={240} placeholder="Descreva o que será verificado" onChange={e=>updateItem(item.id,{titulo:e.target.value})}/></label>
       <label>Resposta<select value={item.tipo} onChange={e=>updateItem(item.id,{tipo:e.target.value as FieldType})}>{Object.entries(typeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
       <label>Área<select value={item.area} onChange={e=>updateItem(item.id,{area:e.target.value as Scope})}>{Object.entries(scopeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
       <label className="sgq-models-required"><input type="checkbox" checked={item.obrigatorio} onChange={e=>updateItem(item.id,{obrigatorio:e.target.checked})}/> Obrigatório</label>
       <div className="sgq-models-check-actions">
        <button type="button" aria-label="Mover item para cima" title="Mover para cima" disabled={index===0} onClick={()=>moveItem(index,-1)}><ArrowUp size={16}/></button>
        <button type="button" aria-label="Mover item para baixo" title="Mover para baixo" disabled={index===draft.checklist.length-1} onClick={()=>moveItem(index,1)}><ArrowDown size={16}/></button>
        <button type="button" aria-label="Remover item" title="Remover" onClick={()=>setDraft(d=>({...d,checklist:d.checklist.filter(x=>x.id!==item.id)}))}><Trash2 size={16}/></button>
       </div>
      </div>)}
      {!draft.checklist.length&&<p className="sgq-models-empty">Adicione pelo menos uma verificação.</p>}
     </div>
    </fieldset>
    <div className="sgq-models-footer">
     <span>{changed?'Alterações não salvas':'Sem alterações pendentes'}</span>
     <button type="button" className="primary" disabled={!canManage||saving||!changed} onClick={()=>void save()}><Save size={17}/>{saving?'Salvando…':'Salvar modelo'}</button>
    </div>
    <p className="sgq-models-help">Os modelos são independentes das ITs oficiais e não alteram inspeções em andamento. A integração do modelo com a execução será homologada separadamente.</p>
   </div>
  </div>
 </section>
}
