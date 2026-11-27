import {readDocument,plan,fmt,generate,reproduce,clearResults,pending,observation,getPhotos} from './word.js'
const app=document.querySelector('#app')
let model=null,stage='plan',error='',urls=[]
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const e=esc
function revoke(){urls.forEach(x=>URL.revokeObjectURL(x));urls=[]}
const field=(r,k,label,type='text')=>'<label class="field">'+e(label)+'<input type="'+type+'" data-field="'+k+'" data-id="'+r.id+'" value="'+e(r[k])+'"></label>'
const first=()=>model.records[0]
const short=r=>{const m=r.name.match(/\(([^)]+)\)\s*$/);return m?m[1]:r.sku}
function reset(){revoke();model=null;stage='plan';error='';render()}
function start(){return '<section class="start"><h1>Inspeção a partir do Word</h1><p>Abra o documento de referência uma única vez. O sistema reutiliza identificação, critérios, tabelas e fotos.</p><label class="file">Abrir Word original<input id="source" type="file" accept=".docx"></label><p class="muted">Processamento no navegador. Nenhum documento é enviado ao servidor.</p><p id="status" role="status" class="error">'+e(error)+'</p></section>'}
function common(){const r=first();return '<div class="heading"><div><h1>'+e(r.ref.replace(/-[A-Z]$/i,''))+' · '+e(r.client)+'</h1><small>'+e(model.fileName)+'</small></div><button data-action="reset" class="quiet">Outro documento</button></div><div class="bar"><strong>'+e([...new Set(model.records.map(x=>x.ref))].join(' · '))+'</strong><span>NF '+e(r.nf)+'</span><span>'+e(r.arrival)+'</span><span class="tag">IT do documento</span><span class="right muted">'+model.records.length+' registros · '+model.records.reduce((s,x)=>s+x.photoCount,0)+' fotos originais</span></div><nav class="tabs" aria-label="Fluxo">'+[['plan','Planejamento'],['execute','Inspeção'],['report','Laudo']].map(([k,v])=>'<button data-stage="'+k+'" '+(stage===k?'aria-current="step"':'')+'>'+v+'</button>').join('')+'</nav>'}
function planning(){
 return '<div class="heading"><h2>Conferir os produtos</h2><span class="tag">Independentes · mesma entrada quando indicado no Word</span></div><div class="tablewrap"><table><thead><tr><th>Entrada / SKU</th><th>Produto</th><th>Recebido</th><th>Caixas</th><th>Lote</th><th>Amostra</th><th>Ac/Re</th><th>Avaliar</th></tr></thead><tbody>'+model.records.map(r=>{const p=plan(r);return '<tr><td><strong>'+e(r.sku)+'</strong><small class="sub">'+e(r.ref)+'</small></td><td>'+e(r.name)+'</td><td><input type="number" min="1" step="1" aria-label="Recebido '+e(r.sku)+'" data-field="qty" data-id="'+r.id+'" value="'+r.qty+'"></td><td><input type="number" min="1" step="1" aria-label="Caixas '+e(r.sku)+'" data-field="boxes" data-id="'+r.id+'" value="'+r.boxes+'"></td><td><input aria-label="Lote '+e(r.sku)+'" data-field="lot" data-id="'+r.id+'" value="'+e(r.lot)+'"></td><td><span data-plan="sample" data-id="'+r.id+'">'+(p?fmt(p.sample):'—')+'</span></td><td><span data-plan="acRe" data-id="'+r.id+'">'+(p?e(p.acRe):'—')+'</span></td><td><span data-plan="boxes" data-id="'+r.id+'">'+(p?p.boxes+' cx.':'—')+'</span></td></tr>'}).join('')+'</tbody></table></div><p class="muted">'+e(first().level)+' · Plano calculado pela tabela da IT importada.</p><details><summary>Dados do recebimento e identificação</summary>'+model.records.map(r=>'<section class="panel"><h2>'+e(r.sku)+' · '+e(short(r))+'</h2><div class="grid">'+[['nf','Nota fiscal'],['arrival','Chegada'],['date','Inspeção'],['origin','Origem'],['transport','Transporte'],['pack','Embalagem / quantidade por caixa'],['material','Material'],['capacity','Capacidade']].map(([k,l])=>field(r,k,l)).join('')+'</div></section>').join('')+'</details><div class="foot"><span class="muted">Os resultados permanecem vazios até confirmação.</span><button class="primary" data-stage="execute" '+(model.records.every(r=>plan(r))?'':'disabled')+'>Iniciar inspeção →</button></div>'
}
function execution(){
 const r=first();let prev=''
 let table=r.checks.map((c,i)=>{
  const heading=c.type!==prev?'<tr class="sectionrow"><td colspan="'+(model.records.length+1)+'">'+e(c.type)+'</td></tr>':'';prev=c.type
  return heading+'<tr><td><strong>'+String(i+1).padStart(2,'0')+'</strong> · '+e(c.label)+'</td>'+model.records.map(x=>'<td>'+['C','NC','NA'].map(k=>'<button title="'+({C:'Conforme',NC:'Não conforme',NA:'Não se aplica'}[k])+'" aria-label="'+e(x.sku+' item '+(i+1)+' '+k)+'" aria-pressed="'+(x.results[i]===k)+'" data-result="'+x.id+'|'+i+'|'+k+'" '+(x.results[i]===k?'data-chosen="'+k+'"':'')+'>'+k+'</button>').join('')+'</td>').join('')+'</tr>'
 }).join('')
 const done=model.records.reduce((s,x)=>s+x.results.filter(Boolean).length,0)
 return '<div class="heading"><h2>Verificações</h2><span class="muted">'+done+'/'+(r.checks.length*model.records.length)+' registradas</span><button data-action="batch">Registrar em lote</button><button data-action="original" class="quiet">Reproduzir original</button></div><div class="tablewrap"><table class="checks"><thead><tr><th>Requisito</th>'+model.records.map(x=>'<th>'+e(x.sku)+' · '+e(short(x))+'<span class="sub">'+e(x.ref)+'</span></th>').join('')+'</tr></thead><tbody>'+table+'</tbody></table></div><p class="muted">C — Conforme · NC — Não conforme · NA — Não se aplica</p><div class="heading"><h2>Retenção e resultado</h2></div>'+model.records.map(x=>'<section class="panel"><div class="heading"><strong>'+e(x.sku)+' · '+e(short(x))+'</strong><button data-photo="'+x.id+'" class="quiet">'+x.photoCount+' fotos originais ↗</button></div><div class="grid">'+field(x,'retention','Unidades retidas','number')+'<div class="field">Saldo após retenção<strong data-balance="'+x.id+'">'+((x.retention===null||x.retention>x.qty||x.retention<0)?'—':fmt(x.qty-x.retention)+' un.')+'</strong></div><label class="field">Decisão<select data-field="decision" data-id="'+x.id+'"><option value="">Confirmar</option><option value="aprovado" '+(x.decision==='aprovado'?'selected':'')+'>Aprovado</option><option value="reprovado" '+(x.decision==='reprovado'?'selected':'')+'>Reprovado</option></select></label></div><div class="grid"><label class="field">Motivo de NA<input data-id="'+x.id+'" data-field="na" value="'+e(x.na)+'" '+(!x.results.includes('NA')?'disabled':'')+'></label><label class="field">Observações e não conformidades<textarea data-id="'+x.id+'" data-field="extra">'+e(x.extra)+'</textarea></label><details><summary>Responsáveis</summary>'+field(x,'inspector','Inspecionado por')+field(x,'rt','Responsável técnico')+'</details></div></section>').join('')+'<div class="foot"><button class="quiet" data-stage="plan">← Planejamento</button><button class="primary" data-stage="report">Conferir laudo →</button></div>'
}
function report(){
 const missing=model.records.flatMap(r=>pending(r).map(p=>r.sku+' · '+p))
 const groups=[...new Set(model.records.map(r=>r.ref))]
 return '<div class="heading"><h2>Laudo consolidado</h2><span class="tag">'+(missing.length?'Com pendências':'Pronto para gerar')+'</span></div><div class="panel"><strong>Caderno original da IT · 1 vez</strong><p class="muted">O Word mantém cabeçalho, rodapé, tabelas e fotos do modelo importado.</p></div>'+groups.map(g=>'<section class="panel"><h2>'+e(g)+'</h2>'+model.records.filter(r=>r.ref===g).map(r=>'<div class="bar"><strong>'+e(r.sku)+' · '+e(short(r))+'</strong><span>'+fmt(r.qty)+' un.</span><span>'+r.results.filter(x=>x==='C').length+' C / '+r.results.filter(x=>x==='NC').length+' NC / '+r.results.filter(x=>x==='NA').length+' NA</span><span>'+r.photoCount+' fotos</span><span class="right '+(r.decision==='aprovado'?'ok':'')+'">'+e(r.decision||'Pendente')+'</span></div><details><summary>Observação que sairá no Word</summary><p>'+e(r.retention===null?'Informe a retenção.':observation(r))+'</p></details>').join('')+'</section>').join('')+(missing.length?'<div class="notice"><strong>Antes de emitir:</strong><p>'+missing.map(e).join(' · ')+'</p></div>':'')+'<div class="foot"><button data-stage="execute" class="quiet">← Editar inspeção</button><button data-action="word" class="primary" '+(missing.length?'disabled':'')+'>Gerar Word (.docx)</button></div><p class="muted">Documento de teste, sem lançamento no SGQ. Os registros continuam separados por SKU e recebimento.</p>'
}
function render(){app.innerHTML=model?common()+(stage==='plan'?planning():stage==='execute'?execution():report())+(error?'<p class="error" role="alert">'+e(error)+'</p>':''):start()}
function dialog(title,body,foot){
 const d=document.createElement('dialog');d.innerHTML='<h2>'+e(title)+'</h2>'+body+'<div class="actions"><button data-action="close">Cancelar</button>'+foot+'</div>'
 d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d
}
function batch(){
 const d=dialog('Registrar verificações em lote','<div class="grid"><div><strong>Produtos</strong>'+model.records.map(r=>'<p><label><input type="checkbox" name="unit" value="'+r.id+'"> '+e(r.sku)+' · '+e(short(r))+'</label></p>').join('')+'</div><div><strong>Verificações</strong><p><button class="quiet" data-action="visual">Visual e olfativo</button></p>'+first().checks.map((c,i)=>'<p><label><input type="checkbox" name="check" value="'+i+'"> '+(i+1)+' · '+e(c.label)+'</label></p>').join('')+'</div><div><label class="field">Resultado<select name="result"><option value="">Escolher</option><option value="C">Conforme</option><option value="NC">Não conforme</option><option value="NA">Não se aplica</option></select></label><label class="field">Justificativa NA<input name="reason"></label></div></div><p class="error" data-batch-error></p>','<button data-action="apply-batch" class="primary">Confirmar selecionados</button>')
 d.style.maxWidth='760px'
}
async function showPhotos(id){
 const r=model.records[id],d=dialog(r.sku+' · Evidências originais','<p role="status">Abrindo fotografias…</p>','')
 try{const p=await getPhotos(model,r);if(!d.open)return
  const host=d.querySelector('p');const gallery=document.createElement('div');gallery.className='photos'
  for(const x of p){const url=URL.createObjectURL(x.blob);urls.push(url);const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=url;img.alt=x.caption||'Evidência';img.loading='lazy';caption.textContent=x.caption;figure.append(img,caption);gallery.append(figure)}
  host.replaceWith(gallery)
 }catch(ex){d.querySelector('p').textContent=ex.message}
}
document.addEventListener('change',async event=>{
 const t=event.target
 if(t.id==='source'){
  if(!t.files[0])return
  document.querySelector('#status').textContent='Lendo documento…'
  t.disabled=true
  try{const parsed=await readDocument(t.files[0]);revoke();model=parsed;stage='plan';error='';render()}
  catch(ex){error=ex.message;render()}
 }
})
document.addEventListener('input',event=>{
 const t=event.target
 const k=t.dataset.field;if(!k||!model)return
 const r=model.records[Number(t.dataset.id)]
 if(!r)return
 const value=['qty','boxes','retention'].includes(k)?(t.value===''?null:Number(t.value)):t.value
 r[k]=value
 if(k!=='decision'){r.decision='';const d=app.querySelector('[data-field="decision"][data-id="'+r.id+'"]');if(d)d.value=''}
 const computed=plan(r)
 for(const node of app.querySelectorAll('[data-plan][data-id="'+r.id+'"]'))node.textContent=computed?(node.dataset.plan==='sample'?fmt(computed.sample):node.dataset.plan==='boxes'?computed.boxes+' cx.':computed.acRe):'—'
 const balance=app.querySelector('[data-balance="'+r.id+'"]');if(balance)balance.textContent=r.retention===null||r.retention<0||r.retention>r.qty?'—':fmt(r.qty-r.retention)+' un.'
 const next=app.querySelector('.foot [data-stage="execute"]');if(next&&stage==='plan')next.disabled=!model.records.every(x=>plan(x))
 error=''
})
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button');if(!b||b.disabled||!model)return
 const d=b.dataset,a=d.action
 if(d.stage){stage=d.stage;error='';render();return}
 if(d.result){const [id,i,k]=d.result.split('|'),r=model.records[Number(id)];r.results[Number(i)]=r.results[Number(i)]===k?'':k;r.decision='';render();return}
 if(d.photo!==undefined){await showPhotos(Number(d.photo));return}
 if(a==='close'){b.closest('dialog').close();return}
 if(a==='reset'){if(confirm('Descartar a simulação atual? O Word original permanecerá intacto.'))reset();return}
 if(a==='batch'){batch();return}
 if(a==='visual'){b.closest('dialog').querySelectorAll('[name=check]').forEach(t=>t.checked=/visual|olfativo/i.test(first().checks[Number(t.value)].type));return}
 if(a==='apply-batch'){
  const d=b.closest('dialog'),units=[...d.querySelectorAll('[name=unit]:checked')].map(t=>Number(t.value)),checks=[...d.querySelectorAll('[name=check]:checked')].map(t=>Number(t.value)),v=d.querySelector('[name=result]').value,reason=d.querySelector('[name=reason]').value.trim()
  if(!units.length||!checks.length||!v||(v==='NA'&&!reason)){d.querySelector('[data-batch-error]').textContent='Selecione os produtos, verificações e resultado. Justifique NA.';return}
  for(const i of units){const r=model.records[i];checks.forEach(j=>r.results[j]=v);if(v==='NA')r.na=reason;r.decision=''}
  d.close();render();return
 }
 if(a==='original'){if(confirm('Reproduzir os resultados e a retenção registrados no documento original? Esta ação substitui os resultados da simulação.')){model.records.forEach(reproduce);render()}return}
 if(a==='word'){
  try{const blob=generate(model),url=URL.createObjectURL(blob),a=document.createElement('a')
   a.href=url;a.download='TESTE - '+model.fileName.replace(/\.docx$/i,'')+'.docx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);error='';render()}
  catch(ex){error=ex.message;render()}
 }
})
render()
