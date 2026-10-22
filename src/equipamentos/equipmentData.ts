import {useEffect,useState} from 'react'
import {authClient} from '../lib/supabase'

export type Equipment = {
  id:string; codigo:string; nome:string; tipo:string; fabricante:string|null; modelo:string|null;
  numero_serie:string|null; patrimonio:string|null; setor:string|null; localizacao:string|null;
  responsavel:string|null; unidade:string|null; faixa_medicao:string|null; resolucao:string|null;
  tolerancia:string|null; aplicacoes:string[]; requer_calibracao:boolean; ultima_calibracao:string|null;
  proxima_calibracao:string|null; certificado_calibracao:string|null; laboratorio_calibracao:string|null;
  periodicidade_calibracao_meses:number|null; proxima_verificacao:string|null; proxima_manutencao:string|null;
  estado:'ativo'|'em_manutencao'|'interditado'|'inativo'; observacoes:string|null; dados_origem:Record<string,unknown>
}

export function equipmentFit(e:Equipment,paramName:string,unit?:string|null) {
  if(e.estado!=='ativo') return false
  if(e.requer_calibracao && (!e.proxima_calibracao || e.proxima_calibracao<new Date().toISOString().slice(0,10))) return false
  if(e.tipo!=='instrumento' && e.tipo!=='dimensional') return false
  const name=(paramName||'').toLowerCase()
  const u=(unit||'').toLowerCase()
  const kind=/(altura|height)/.test(name)?'altura':/(diametr|diâmetr)/.test(name)?'diametro':/(largura|width)/.test(name)?'largura':/(espess|thickness)/.test(name)?'espessura':/(compriment|length)/.test(name)?'comprimento':/(peso|massa|weight)/.test(name)||['g','kg','mg'].includes(u)?'massa':/(volum|capacity|capacidade)/.test(name)||['ml','l'].includes(u)?'volume':/(temperat|°c)/.test(name)?'temperatura':/(força|force|resistênc)/.test(name)||u==='n'?'forca':/(press)/.test(name)?'pressao':'outros'
  const lengthFamily=['comprimento','diametro','largura','altura','espessura']
  return e.aplicacoes.includes(kind) || (lengthFamily.includes(kind) && e.aplicacoes.includes('comprimento'))
}
export function useEquipmentList() {
  const [equipments,setEquipments]=useState<Equipment[]>([])
  const [busy,setBusy]=useState(false)
  const refresh=async()=>{
    setBusy(true)
    const {data,error}=await authClient.from('sgq_equipamentos').select('*').order('nome')
    if(!error && data) setEquipments(data as Equipment[])
    setBusy(false)
    return error
  }
  useEffect(()=>{void refresh()},[])
  return {equipments,setEquipments,busy,refresh}
}
