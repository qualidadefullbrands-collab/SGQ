import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react'
import { apiGet, apiPost } from '../lib/supabase'
import './inspection-chat.css'

type Props = {
  inspectionId:string
  detail:any
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

export default function InspectionChat({inspectionId,detail,onClose,onChanged}:Props) {
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
    const q=await apiGet<ChatMessage[]>(`/api/inspecoes/${inspectionId}/chat`)
    if(q.error){
      setNotice(q.error.message)
      setLoading(false)
      return
    }
    setMessages((q.data ?? []) as ChatMessage[])
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

  async function send(){
    const text=draft.trim()
    if(!text || sending || detail?.status==='concluida') return
    setDraft('')
    setSending(true)
    setNotice('')
    try{
      const result=await apiPost<any>(`/api/inspecoes/${inspectionId}/chat`,{
        message:text,
        context:buildContext(),
      })
      if(result.error) throw new Error(result.error.message || 'Falha ao processar mensagem.')

      const mine=result.data?.inspectorMessage
      const answer=result.data?.assistantMessage
      if(mine) setMessages((x)=>[...x,mine as ChatMessage])
      if(answer) setMessages((x)=>[...x,answer as ChatMessage])

      await onChanged()
      if(result.data?.finishRequested) {
        setNotice('Para concluir, feche o chat e use a etapa final. As fotos são adicionadas lá, antes do resultado.')
      }
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
