import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './inspection-chat.css'

type Props = {
  inspectionId:string
  detail:any
  userId:string
  onClose:()=>void
  onChanged:()=>Promise<void> | void
}

type ChatMessage = {
  id:string
  autor:'inspetor'|'assistente'|'sistema'
  texto:string
  metadata:any
  criado_em:string
}

function severityForNc(value:string|null|undefined) {
  if (value==='critico') return 'critica'
  if (value==='toleravel') return 'leve'
  return 'maior'
}

export default function InspectionChat({inspectionId,detail,userId,onClose,onChanged}:Props) {
  const [messages,setMessages]=useState<ChatMessage[]>([])
  const [draft,setDraft]=useState('')
  const [loading,setLoading]=useState(true)
  const [sending,setSending]=useState(false)
  const [listening,setListening]=useState(false)
  const [notice,setNotice]=useState('')
  const bottomRef=useRef<HTMLDivElement|null>(null)

  const stats=useMemo(()=>{
    const checklist=detail?.checklist ?? []
    const checklistResults=detail?.checklistResults ?? []
    const tests=detail?.tests ?? []
    const testResults=detail?.testResults ?? []
    return {
      checklistDone:checklistResults.length,
      checklistTotal:checklist.length,
      testsDone:testResults.length,
      testsTotal:tests.length,
      inspected:Number(detail?.total_inspecionado ?? 0),
      sample:Number(detail?.tamanho_amostra ?? 0),
      ncs:Number(detail?.total_nao_conforme ?? 0),
    }
  },[detail])

  useEffect(()=>{void loadMessages()},[inspectionId])
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages.length,sending])

  async function loadMessages(){
    setLoading(true)
    const q=await supabase.from('inspecao_chat_mensagens').select('*').eq('inspecao_id',inspectionId).order('criado_em')
    if(q.error){
      setNotice(q.error.message)
      setLoading(false)
      return
    }
    let rows=(q.data ?? []) as ChatMessage[]
    if(!rows.length){
      const products=(detail?.items ?? []).map((x:any)=>x.processo_itens?.produtos?.sku).filter(Boolean).join(', ')
      const intro='Modo chat iniciado. Você pode registrar unidades, verificações, testes e medições em linguagem natural. Fotos ficam para a etapa final da inspeção.'+(products?' Produtos: '+products+'.':'')
      const ins=await supabase.from('inspecao_chat_mensagens').insert({
        inspecao_id:inspectionId,autor:'assistente',texto:intro,metadata:{tipo:'intro'}
      }).select('*').single()
      if(ins.data) rows=[ins.data as ChatMessage]
    }
    setMessages(rows)
    setLoading(false)
  }

  function buildContext(){
    return {
      inspection:{
        id:inspectionId,
        numero:detail?.numero,
        processo:detail?.grupos_inspecao?.processos?.codigo,
        cliente:detail?.grupos_inspecao?.processos?.cliente,
        status:detail?.status,
        total_inspecionado:detail?.total_inspecionado,
        tamanho_amostra:detail?.tamanho_amostra,
        total_nao_conforme:detail?.total_nao_conforme,
        limite_aceitacao:detail?.limite_aceitacao,
        limite_rejeicao:detail?.limite_rejeicao,
      },
      products:(detail?.items ?? []).map((link:any)=>({
        processoItemId:link.processo_itens?.id,
        produtoId:link.processo_itens?.produto_id,
        sku:link.processo_itens?.produtos?.sku,
        nome:link.processo_itens?.produtos?.nome,
      })),
      checklist:(detail?.checklist ?? []).map((x:any)=>({
        id:x.id,ordem:x.ordem,requisito:x.requisito,instrucao:x.instrucao,
        atual:detail?.checklistResults?.find((r:any)=>r.checklist_id===x.id)?.resultado ?? 'pendente',
      })),
      tests:(detail?.tests ?? []).map((x:any)=>({
        id:x.id,nome:x.nome,procedimento:x.procedimento,criterio:x.criterio_aprovacao,
        atual:detail?.testResults?.find((r:any)=>r.teste_id===x.id)?.resultado ?? 'pendente',
      })),
      dimensionals:(detail?.params ?? []).map((x:any)=>({
        id:x.id,nome:x.nome,unidade:x.unidade,tipo_referencia:x.tipo_referencia,
      })),
      dimensionalConfigs:(detail?.dimConfigs ?? []).map((x:any)=>({
        processoItemId:x.processo_item_id,parametroId:x.parametro_id,naoAplicavel:x.nao_aplicavel,
        unidade:x.unidade,minimo:x.minimo_aceitavel,maximo:x.maximo_aceitavel,
      })),
      dimensionalResults:(detail?.dimResults ?? []).map((x:any)=>({
        processoItemId:x.processo_item_id,parametroId:x.parametro_id,sequencia:x.sequencia_amostra,valor:x.valor,
      })),
      recentConversation:messages.slice(-12).map((m)=>({autor:m.autor,texto:m.texto})),
    }
  }

  async function applyChecklistUpdates(items:any[]){
    const valid=new Set((detail?.checklist ?? []).map((x:any)=>x.id))
    for(const item of items ?? []){
      if(!valid.has(item.checklistId)) continue
      await supabase.from('inspecao_checklist_resultados').upsert({
        inspecao_id:inspectionId,
        checklist_id:item.checklistId,
        resultado:item.result,
        observacao:item.observation || null,
        severidade_confirmada:item.result==='nao_conforme' ? (item.severity || 'grave') : null,
        registrado_por:userId,
        registrado_em:new Date().toISOString(),
      },{onConflict:'inspecao_id,checklist_id'})
    }
  }

  async function applySampleResults(items:any[]){
    if(!(items ?? []).length) return
    const allowedChecks=new Set((detail?.checklist ?? []).map((x:any)=>x.id))
    const allowedItems=new Set((detail?.items ?? []).map((x:any)=>x.processo_itens?.id).filter(Boolean))
    const current=await supabase.from('inspecao_registros').select('sequencia,conforme').eq('inspecao_id',inspectionId).order('sequencia')
    let seq=Math.max(0,...(current.data ?? []).map((x:any)=>Number(x.sequencia||0)))
    for(const item of items){
      if(Number(detail?.tamanho_amostra ?? 0)>0 && seq>=Number(detail.tamanho_amostra)) break
      const conforme=Boolean(item.conforme)
      if(!conforme && (!allowedChecks.has(item.checklistId) || !String(item.description||'').trim())) continue
      seq+=1
      const reg=await supabase.from('inspecao_registros').insert({
        inspecao_id:inspectionId,sequencia:seq,conforme,
        observacao:conforme?'Registrado pelo modo chat':String(item.description||'').trim(),
      }).select('id').single()
      if(reg.error || !reg.data) continue
      if(!conforme){
        const processoItemId=allowedItems.has(item.processoItemId)?item.processoItemId:null
        await supabase.from('inspecao_nao_conformidades').insert({
          inspecao_id:inspectionId,
          inspecao_registro_id:reg.data.id,
          processo_item_id:processoItemId,
          checklist_id:item.checklistId,
          descricao:String(item.description||'').trim(),
          severidade:severityForNc(item.severity),
          tipo:'amostragem_chat',
        })
        await supabase.from('inspecao_checklist_resultados').upsert({
          inspecao_id:inspectionId,checklist_id:item.checklistId,resultado:'nao_conforme',
          severidade_confirmada:item.severity || 'grave',observacao:String(item.description||'').trim(),
          registrado_por:userId,registrado_em:new Date().toISOString(),
        },{onConflict:'inspecao_id,checklist_id'})
      }
    }
    const rows=await supabase.from('inspecao_registros').select('conforme').eq('inspecao_id',inspectionId)
    if(!rows.error){
      const total=(rows.data ?? []).length
      const nc=(rows.data ?? []).filter((x:any)=>x.conforme===false).length
      await supabase.from('inspecoes').update({
        total_inspecionado:total,total_conforme:total-nc,total_nao_conforme:nc,
      }).eq('id',inspectionId)
    }
  }

  async function applyTestUpdates(items:any[]){
    const valid=new Set((detail?.tests ?? []).map((x:any)=>x.id))
    for(const item of items ?? []){
      if(!valid.has(item.testId)) continue
      await supabase.from('inspecao_testes_resultados').upsert({
        inspecao_id:inspectionId,teste_id:item.testId,resultado:item.result,
        registrado_por:userId,registrado_em:new Date().toISOString(),
      },{onConflict:'inspecao_id,teste_id'})
    }
  }

  async function applyDimensionMeasurements(items:any[]){
    const validParams=new Map((detail?.params ?? []).map((x:any)=>[x.id,x]))
    const validProcessItems=new Set((detail?.items ?? []).map((x:any)=>x.processo_itens?.id).filter(Boolean))
    const existing=[...(detail?.dimResults ?? [])]
    for(const item of items ?? []){
      if(!validParams.has(item.parametroId) || !validProcessItems.has(item.processoItemId)) continue
      const cfg=(detail?.dimConfigs ?? []).find((x:any)=>x.processo_item_id===item.processoItemId && x.parametro_id===item.parametroId)
      if(cfg?.nao_aplicavel) continue
      const used=existing.filter((x:any)=>x.processo_item_id===item.processoItemId && x.parametro_id===item.parametroId).map((x:any)=>Number(x.sequencia_amostra))
      const seq=Array.from({length:10},(_,i)=>i+1).find((n)=>!used.includes(n))
      if(!seq) continue
      const value=Number(item.value)
      if(!Number.isFinite(value)) continue
      const min=cfg?.minimo_aceitavel==null?null:Number(cfg.minimo_aceitavel)
      const max=cfg?.maximo_aceitavel==null?null:Number(cfg.maximo_aceitavel)
      const conforme=min==null&&max==null?null:(min==null||value>=min)&&(max==null||value<=max)
      const up=await supabase.from('inspecao_dimensionais').upsert({
        inspecao_id:inspectionId,processo_item_id:item.processoItemId,parametro_id:item.parametroId,
        sequencia_amostra:seq,valor:value,unidade:cfg?.unidade || item.unit || validParams.get(item.parametroId)?.unidade || null,conforme,
      },{onConflict:'inspecao_id,processo_item_id,parametro_id,sequencia_amostra'}).select('*').single()
      if(up.data) existing.push(up.data)
    }
  }

  async function send(){
    const text=draft.trim()
    if(!text || sending || detail?.status==='concluida') return
    setDraft('')
    setSending(true)
    setNotice('')
    try{
      const mine=await supabase.from('inspecao_chat_mensagens').insert({
        inspecao_id:inspectionId,autor:'inspetor',texto:text,metadata:{}
      }).select('*').single()
      if(mine.error || !mine.data) throw mine.error || new Error('Falha ao salvar mensagem.')
      setMessages((x)=>[...x,mine.data as ChatMessage])

      const {data,error}=await supabase.functions.invoke('sgq-inspecao-chat',{
        body:{message:text,context:buildContext()}
      })
      const parsed=error ? {
        reply:'Mensagem registrada. A IA não respondeu agora; os dados podem ser preenchidos pelo modo tradicional.',
        finishRequested:false,checklistUpdates:[],sampleResults:[],testUpdates:[],dimensionMeasurements:[],degraded:true
      } : data

      await applyChecklistUpdates(parsed?.checklistUpdates ?? [])
      await applySampleResults(parsed?.sampleResults ?? [])
      await applyTestUpdates(parsed?.testUpdates ?? [])
      await applyDimensionMeasurements(parsed?.dimensionMeasurements ?? [])

      const answer=await supabase.from('inspecao_chat_mensagens').insert({
        inspecao_id:inspectionId,
        autor:'assistente',
        texto:String(parsed?.reply || 'Registro interpretado.'),
        metadata:{
          checklistUpdates:parsed?.checklistUpdates ?? [],
          sampleResults:parsed?.sampleResults ?? [],
          testUpdates:parsed?.testUpdates ?? [],
          dimensionMeasurements:parsed?.dimensionMeasurements ?? [],
          finishRequested:Boolean(parsed?.finishRequested),
          degraded:Boolean(parsed?.degraded),
        }
      }).select('*').single()
      if(answer.data) setMessages((x)=>[...x,answer.data as ChatMessage])
      await onChanged()
      if(parsed?.finishRequested) setNotice('Para concluir, feche o chat e use a etapa final. As fotos são adicionadas lá, antes do resultado.')
    }catch(e:any){
      setNotice(e?.message || 'Não foi possível registrar a mensagem.')
    }finally{
      setSending(false)
    }
  }

  function startVoice(){
    const Ctor=(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if(!Ctor){
      setNotice('Ditado por voz não está disponível neste navegador.')
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
      if(heard) setDraft((x)=>x?x+' '+heard:heard)
    }
    rec.start()
  }

  return (
    <div className="full-chat-backdrop">
      <section className="full-chat-shell">
        <header className="full-chat-header">
          <button className="full-chat-back" onClick={onClose}><ArrowLeft size={20}/></button>
          <div>
            <span>FULL · MODO CHAT OPCIONAL</span>
            <strong>{detail?.numero} · {detail?.grupos_inspecao?.nome}</strong>
          </div>
          <Sparkles size={20}/>
        </header>

        <div className="full-chat-stats">
          <span><b>{stats.inspected}/{stats.sample}</b> amostras</span>
          <span><b>{stats.ncs}</b> NC</span>
          <span><b>{stats.checklistDone}/{stats.checklistTotal}</b> verificações</span>
          {!!stats.testsTotal && <span><b>{stats.testsDone}/{stats.testsTotal}</b> testes</span>}
        </div>

        <div className="full-chat-photo-rule">
          <ClipboardCheck size={17}/>
          <span>Durante o chat, registre os fatos. <b>As fotos ficam para o final</b>, na galeria normal da inspeção.</span>
        </div>

        {notice && <div className="full-chat-notice">{notice}</div>}

        <div className="full-chat-messages">
          {loading && <div className="full-chat-loading"><Loader2 className="spin" size={18}/> Carregando conversa…</div>}
          {messages.map((m)=>(
            <div className={'full-chat-row '+m.autor} key={m.id}>
              <div className="full-chat-bubble">
                <p>{m.texto}</p>
                {m.autor==='assistente' && (
                  <div className="full-chat-tags">
                    {(m.metadata?.checklistUpdates ?? []).map((x:any)=><span key={'c'+x.checklistId}>Checklist · {x.result}</span>)}
                    {(m.metadata?.sampleResults ?? []).map((x:any,i:number)=><span key={'s'+i}>{x.conforme?'Unidade C':'Unidade NC'}</span>)}
                    {(m.metadata?.testUpdates ?? []).map((x:any)=><span key={'t'+x.testId}>Teste · {x.result}</span>)}
                    {(m.metadata?.dimensionMeasurements ?? []).map((x:any,i:number)=><span key={'d'+i}>Medição · {x.value}{x.unit?' '+x.unit:''}</span>)}
                  </div>
                )}
                <small>{new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(m.criado_em))}</small>
              </div>
            </div>
          ))}
          {sending && <div className="full-chat-row assistente"><div className="full-chat-bubble full-chat-thinking"><Loader2 className="spin" size={16}/> Interpretando e registrando…</div></div>}
          <div ref={bottomRef}/>
        </div>

        <footer className="full-chat-composer">
          <button className={listening?'active':''} onClick={startVoice} title="Ditar">{listening?<MicOff size={20}/>:<Mic size={20}/>}</button>
          <textarea
            rows={1}
            value={draft}
            onChange={(e)=>setDraft(e.target.value)}
            placeholder="Ex.: unidade 4 conforme; item 3 NC, tampa com rebarba…"
            disabled={detail?.status==='concluida'}
            onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}}
          />
          <button className="send" onClick={()=>void send()} disabled={sending||!draft.trim()||detail?.status==='concluida'}><Send size={19}/></button>
        </footer>

        {detail?.status==='concluida' && <div className="full-chat-closed"><CheckCircle2 size={18}/> Inspeção concluída. O chat fica disponível apenas para consulta.</div>}
      </section>
    </div>
  )
}
