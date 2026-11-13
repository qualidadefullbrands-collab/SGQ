type ErrorLike={code?:unknown;message?:unknown;details?:unknown;hint?:unknown;error?:unknown;error_description?:unknown;status?:unknown}
const asText=(value:unknown)=>typeof value==='string'?value.trim():''
const fallback='Operação não concluída. Atualize a página e tente novamente.'
/** Translate Supabase/PostgREST objects without rendering "[object Object]" to the operator. */
export function blindInventoryError(error:unknown):string{
 if(typeof error==='string')return error.trim()||fallback
 const e=(error&&typeof error==='object'?error:{} as ErrorLike) as ErrorLike
 const code=asText(e.code)
 const message=asText(e.message)||asText(e.error_description)||asText(e.error)
 const details=asText(e.details)
 const hint=asText(e.hint)
 if(code==='42501'||/row.level security policy|violates row.level security/i.test(message)){
  return 'Registro recusado: esta versão da tela pode estar desatualizada ou faltou confirmar processo e cliente. Atualize o SGQ e confirme esses dados antes de salvar. (Segurança do banco: 42501)'
 }
 if(code==='23505')return 'Já existe uma contagem para este produto, processo e endereço. Atualize a lista para revisar o registro existente.'
 if(code==='23514')return 'Algum campo informado não atende às regras da contagem. Verifique endereço, código do processo, cliente e quantidade.'
 if(code==='23503')return 'O processo ou inventário vinculado não foi localizado no cadastro atual. Consulte novamente.'
 if(message)return [message,details,hint].filter(Boolean).join(' — ').slice(0,850)
 if(details||hint)return [details,hint].filter(Boolean).join(' — ').slice(0,850)
 if(error instanceof Error&&error.message)return error.message
 try{
  const serialized=JSON.stringify(error)
  if(serialized&&serialized!=='{}'&&serialized!=='null')return serialized.slice(0,650)
 }catch{return fallback}
 return fallback
}
