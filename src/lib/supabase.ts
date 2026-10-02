import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const apiUrl = (import.meta.env.VITE_API_URL || 'https://app-sgq-api.onrender.com').replace(/\/$/, '')

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn('Supabase Auth não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.')
}

export const authClient = createClient(
  supabaseUrl || 'https://example.supabase.co',
  supabasePublishableKey || 'placeholder',
)

async function accessToken() {
  const { data } = await authClient.auth.getSession()
  return data.session?.access_token || ''
}

async function apiRequest(path:string, init:RequestInit={}) {
  const token=await accessToken()
  const headers=new Headers(init.headers || {})
  if (token) headers.set('Authorization','Bearer '+token)
  if (!(init.body instanceof FormData) && init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type','application/json')
  }
  try {
    const response=await fetch(apiUrl+path,{...init,headers})
    const text=await response.text()
    let payload:any=null
    try { payload=text?JSON.parse(text):null } catch { payload=text }
    if (!response.ok) {
      const message=payload?.error?.message || payload?.message || payload?.detail || text || ('HTTP '+response.status)
      return {data:null,error:{message:String(message),details:payload?.error?.details || ''},count:null}
    }
    return payload ?? {data:null,error:null,count:null}
  } catch (e:any) {
    return {data:null,error:{message:e?.message || 'Falha de comunicação com a API SGQ.',details:''},count:null}
  }
}

function storageBucket(bucket:string) {
  return {
    async upload(path:string,file:Blob,options?:{contentType?:string;upsert?:boolean}) {
      const form=new FormData()
      const filename=file instanceof File ? file.name : 'upload.bin'
      form.append('file',file,filename)
      return apiRequest(
        '/api/storage/'+encodeURIComponent(bucket)+'/upload?path='+encodeURIComponent(path)+'&upsert='+(options?.upsert?'true':'false'),
        {method:'POST',body:form},
      )
    },
  }
}

export const supabase = {
  auth: authClient.auth,
  storage: {
    from(bucket:string) {
      return storageBucket(bucket)
    },
  },
}

export async function apiPost<T=any>(path:string, body:any):Promise<{data:T|null;error:any;count?:number|null}> {
  return apiRequest(path,{method:'POST',body:JSON.stringify(body)}) as any
}

export async function apiGet<T=any>(path:string):Promise<{data:T|null;error:any;count?:number|null}> {
  return apiRequest(path,{method:'GET'}) as any
}

export async function apiPut<T=any>(path:string, body:any):Promise<{data:T|null;error:any;count?:number|null}> {
  return apiRequest(path,{method:'PUT',body:JSON.stringify(body)}) as any
}

export { apiUrl }
