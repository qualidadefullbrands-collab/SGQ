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

type Filter = { type:'eq'|'is'|'in'; column:string; value:any }
type QueryState = {
  table:string
  operation:'select'|'insert'|'update'|'upsert'|'delete'
  select?:string
  filters:Filter[]
  order?:{column:string;ascending:boolean}
  limit?:number
  head?:boolean
  count?:string
  onConflict?:string
  body?:any
}

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

class ApiQueryBuilder implements PromiseLike<any> {
  private state:QueryState

  constructor(table:string) {
    this.state={table,operation:'select',filters:[]}
  }

  select(columns='*', options?:{count?:string;head?:boolean}) {
    this.state.select=columns
    if (options?.count) this.state.count=options.count
    if (options?.head) this.state.head=true
    return this
  }

  insert(body:any) {
    this.state.operation='insert'
    this.state.body=body
    return this
  }

  update(body:any) {
    this.state.operation='update'
    this.state.body=body
    return this
  }

  upsert(body:any, options?:{onConflict?:string}) {
    this.state.operation='upsert'
    this.state.body=body
    if (options?.onConflict) this.state.onConflict=options.onConflict
    return this
  }

  delete() {
    this.state.operation='delete'
    return this
  }

  eq(column:string,value:any) {
    this.state.filters.push({type:'eq',column,value})
    return this
  }

  is(column:string,value:any) {
    this.state.filters.push({type:'is',column,value})
    return this
  }

  in(column:string,value:any[]) {
    this.state.filters.push({type:'in',column,value})
    return this
  }

  order(column:string, options?:{ascending?:boolean}) {
    this.state.order={column,ascending:options?.ascending !== false}
    return this
  }

  limit(value:number) {
    this.state.limit=value
    return this
  }

  private async execute() {
    return apiRequest('/api/data/query',{
      method:'POST',
      body:JSON.stringify(this.state),
    })
  }

  async single() {
    const result=await this.execute()
    if (result.error) return result
    const rows=Array.isArray(result.data)?result.data:[]
    if (rows.length !== 1) {
      return {data:null,error:{message:rows.length===0?'Registro não encontrado.':'Mais de um registro encontrado.',details:''},count:result.count}
    }
    return {...result,data:rows[0]}
  }

  async maybeSingle() {
    const result=await this.execute()
    if (result.error) return result
    const rows=Array.isArray(result.data)?result.data:[]
    if (rows.length > 1) {
      return {data:null,error:{message:'Mais de um registro encontrado.',details:''},count:result.count}
    }
    return {...result,data:rows[0] ?? null}
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value:any)=>TResult1|PromiseLike<TResult1>)|null,
    onrejected?: ((reason:any)=>TResult2|PromiseLike<TResult2>)|null,
  ):PromiseLike<TResult1|TResult2> {
    return this.execute().then(onfulfilled as any,onrejected as any)
  }
}

function storageBucket(bucket:string) {
  return {
    async createSignedUrl(path:string,expiresIn:number) {
      return apiRequest('/api/storage/'+encodeURIComponent(bucket)+'/signed-url',{
        method:'POST',
        body:JSON.stringify({path,expiresIn}),
      })
    },
    async createSignedUrls(paths:string[],expiresIn:number) {
      return apiRequest('/api/storage/'+encodeURIComponent(bucket)+'/signed-urls',{
        method:'POST',
        body:JSON.stringify({paths,expiresIn}),
      })
    },
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
  from(table:string) {
    return new ApiQueryBuilder(table)
  },
  storage: {
    from(bucket:string) {
      return storageBucket(bucket)
    },
  },
  functions: {
    async invoke(name:string,options?:{body?:any}) {
      return apiRequest('/api/functions/'+encodeURIComponent(name),{
        method:'POST',
        body:JSON.stringify(options?.body ?? {}),
      })
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
