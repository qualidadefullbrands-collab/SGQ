import {useEffect,useMemo,useState} from 'react'
import {apiPost} from '../lib/supabase'
import './SkuReclassification.css'

type Sku={sku:string;nome:string;quantidade:number;unidades:number}
type Entry={id:string;entrada:string;tipo:string;status:string;nf:string|null;it:string|null;nivel:string|null;bloqueio:string|null;skus:Sku[]}
type Context={fst:string;tipo:string;it:string|null;nivel:string|null;entradas:Entry[]}
type Target={entrada:string;sku:string;nome:string;nivel:string;plano:{lote:number;codigo:string;amostra:number;ac:number|null;re:number|null}}
type Preview={confirmacao:string;destinos:Target[];originais:string[];aviso:string}
type Result={originais:string[];novas:string[]}
type Version={id:string;status:string;versao:string;instrucoes_trabalho:{codigo:string;titulo:string}|null}

export default function SkuReclassification({inspectionId,versions,onClose,onApplied}:{inspectionId:string;versions:Version[];onClose:()=>void;onApplied:(result:Result)=>void}){
 const [context,setContext]=useState<Context|null>(null)
 const [selected,setSelected]=useState<string[]>([])
 const [units,setUnits]=useState<Record<string,string>>({})
 const [it,setIt]=useState('')
 const [level,setLevel]=useState('')
 const [preview,setPreview]=useState<Preview|null>(null)
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(true)
 const [error,setError]=useState('')
 const path='/api/inspecoes/'+encodeURIComponent(inspectionId)+'/reclassificar'
 useEffect(()=>{
  let alive=true
  void apiPost<Context>(path,{modo:'contexto'}).then(r=>{
   if(!alive)return
   if(r.error||!r.data)setError(r.error?.message||'Contexto não localizado.')
   else {setContext(r.data);setIt(r.data.it||'');setLevel(r.data.nivel||'');setSelected([inspectionId])}
   setBusy(false)
  })
  return ()=>{alive=false}
 },[path,inspectionId])
 const anchor=context?.entradas.find(row=>row.id===inspectionId)
 const split=context?.tipo==='kit_componentes'
 const candidates=context?.entradas.filter(row=>row.id!==inspectionId&&row.tipo==='individual')||[]
 const skus=useMemo(()=>{
  const all=new Map<string,Sku>()
  for(const entry of context?.entradas||[])if(selected.includes(entry.id))
   for(const sku of entry.skus){const key=sku.sku.trim().toUpperCase();all.set(key,sku)}
  return [...all.entries()]
 },[context,selected])
 function invalidate(){setPreview(null);setConfirmed(false);setError('')}
 function toggle(id:string){setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);invalidate()}
 const validUnits=split||skus.every(([sku])=>/^[1-9][0-9]{0,8}$/.test(units[sku]||''))
 const canPreview=!!anchor&&!anchor.bloqueio&&!!it&&!!level&&skus.length>1&&(split||selected.length>1)&&validUnits&&!busy
 function payload(){
  return {modo:split?'separar':'agrupar',selecionadas:selected,unidades:split?{}:Object.fromEntries(skus.map(([sku])=>[sku,Number(units[sku])])),
   itVersionId:it,nivel:level}
 }
 async function inspect(){
  if(!canPreview)return
  setBusy(true);invalidate()
  try{const r=await apiPost<Preview>(path,payload());if(r.error||!r.data)setError(r.error?.message||'Não foi possível calcular a prévia.');else setPreview(r.data)}
  finally{setBusy(false)}
 }
 async function apply(){
  if(!preview||!reason.trim()||!confirmed||busy)return
  setBusy(true);setError('')
  try{
   const r=await apiPost<Result>(path,{...payload(),confirmacao:preview.confirmacao,motivo:reason.trim()})
   if(r.error||!r.data)setError(r.error?.message||'Não foi possível concluir a correção.');else onApplied(r.data)
  }finally{setBusy(false)}
 }
 return <div className="modal-backdrop">
  <article className="sample-detail inspection-edit-modal sgq-reclassification" role="dialog" aria-modal="true" aria-labelledby="sgq-reclassification-title">
   <button className="close" type="button" disabled={busy} onClick={onClose} aria-label="Fechar reclassificação">×</button>
   <span className="eyebrow">CORREÇÃO DE CADASTRO · {context?.fst||'FST'}</span>
   <h2 id="sgq-reclassification-title">Alterar classificação dos SKUs</h2>
   <p>Não é necessário cadastrar o FST novamente. O sistema reorganiza as entradas e mantém o histórico da correção.</p>
   {error&&<div className="alert error" role="alert">{error}</div>}
   {!context&&busy&&<p role="status">Carregando entradas…</p>}
   {context&&!anchor&&<p role="alert">Esta inspeção foi substituída. Retorne à Central de Inspeções e atualize a lista.</p>}
   {anchor&&<><div className="sgq-reclass-summary">
    <strong>Entrada {anchor.entrada} · {split?'Kit de componentes':'Produto independente'}</strong>
    <span>{anchor.skus.map(s=>s.sku+' — '+s.nome).join(' · ')}</span>
   </div>
   {anchor.bloqueio?<div className="alert error" role="alert"><strong>Reclassificação automática bloqueada</strong><p>{anchor.bloqueio}</p><p>Os registros originais permanecem intactos. A transferência de evidências para outra classificação exige revisão supervisionada.</p></div>:<>
    <fieldset disabled={busy}><legend>{split?'Separar os SKUs em inspeções independentes':'Reunir produtos independentes em um kit'}</legend>
      {split?<p>Uma entrada por SKU, com amostragem individual. O Word permanece único, com anexos separados.</p>:<>
       <p>Selecione somente os produtos que realmente compõem o mesmo conjunto. Não selecione por conveniência do FST.</p>
       <div className="sgq-reclass-candidates">
        {candidates.length===0&&<p>Não há outra entrada independente neste FST.</p>}
        {candidates.map(row=><label key={row.id} className="sgq-reclass-entry">
         <input type="checkbox" checked={selected.includes(row.id)} disabled={!!row.bloqueio} onChange={()=>toggle(row.id)}/>
         <span><strong>Entrada {row.entrada} · {row.skus.map(x=>x.sku).join(', ')}</strong><small>NF {row.nf||'—'} · {row.skus.map(x=>x.nome).join(' / ')}</small>{row.bloqueio&&<small>{row.bloqueio}</small>}</span>
        </label>)}
       </div>
       {selected.length>1&&<div className="form-grid">
        {skus.map(([sku,row])=><label key={sku}>Unidades de {row.sku} por kit<input type="number" min="1" step="1" value={units[sku]||''} onChange={e=>{setUnits(old=>({...old,[sku]:e.target.value}));invalidate()}}/></label>)}
       </div>}
      </>}
      <div className="form-grid">
       <label>IT para a nova classificação<select value={it} onChange={e=>{setIt(e.target.value);invalidate()}}>
        <option value="">Selecionar IT</option>
        {it&&!versions.some(v=>v.id===it)&&<option value={it}>IT atual da inspeção</option>}
        {versions.filter(v=>v.status==='publicada'||v.id===it).map(v=><option key={v.id} value={v.id}>{v.instrucoes_trabalho?.codigo} · {v.instrucoes_trabalho?.titulo} · {v.versao}</option>)}
       </select></label>
       <label>Nível de inspeção<select value={level} onChange={e=>{setLevel(e.target.value);invalidate()}}>
        <option value="">Selecionar nível</option>{['I','II','III','S1','S2','S3','S4'].map(n=><option key={n} value={n}>{n}</option>)}
       </select></label>
      </div>
      {split&&<small>O nível e a IT selecionados serão o ponto de partida de cada entrada. Confira as ITs individuais antes de iniciar a execução.</small>}
    </fieldset>
    <div className="actions"><button type="button" className="secondary" disabled={!canPreview} onClick={()=>void inspect()}>{busy?'Processando…':'Conferir nova classificação'}</button></div>
    {preview&&<section className="sgq-reclass-preview" aria-label="Prévia da reclassificação">
     <h3>Como ficará o FST</h3>
     {preview.destinos.map(t=><div key={t.entrada} className="sgq-reclass-summary"><strong>Entrada {t.entrada} · {t.sku||'Kit'}</strong><span>{t.nome}</span><small>Lote {t.plano.lote} · Nível {t.nivel} · Amostra {t.plano.amostra} · Ac {t.plano.ac??'—'} / Re {t.plano.re??'—'}</small></div>)}
     <p>{preview.aviso} As inspeções anteriores serão preservadas no histórico de auditoria. O laudo continua único por FST.</p>
     <label>Motivo da correção<textarea value={reason} maxLength={2000} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Descreva por que a classificação anterior estava incorreta."/></label>
     <label className="sgq-reclass-entry"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo que os SKUs, a IT, o nível e os novos planos estão corretos.</label>
     <div className="actions"><button className="primary" type="button" disabled={busy||!confirmed||!reason.trim()} onClick={()=>void apply()}>{busy?'Salvando…':'Aplicar correção'}</button></div>
    </section>}
   </>}</>}
   <div className="actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button></div>
  </article>
 </div>
}
