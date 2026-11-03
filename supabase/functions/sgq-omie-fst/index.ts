import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type"};
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});

function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}})}
async function secret(name:string){
  const env=Deno.env.get(name);if(env)return env.trim();
  const {data}=await admin.rpc("edge_get_integration_secret",{p_name:name});
  return data?String(data).trim():"";
}
async function omie(url:string,call:string,parameter:unknown,appKey:string,appSecret:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),14000);
  try{
    const r=await fetch(url,{
      method:"POST",signal:controller.signal,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({call,app_key:appKey,app_secret:appSecret,param:[parameter]})
    });
    const body=await r.json().catch(()=>({}));
    if(!r.ok||body?.faultstring||body?.faultcode){
      console.warn("Omie lookup failure",call,"status",r.status,"fault",String(body?.faultcode||""));
      return null;
    }
    return body;
  }catch(e){console.error("Omie request failed",call,String(e));return null}
  finally{clearTimeout(timer)}
}
// Preserve the suffix: FST26169-A and FST26169-B are distinct projects.
function canonical(value:unknown){
  const raw=String(value??"").trim().toUpperCase().replace(/[–—]/g,"-").replace(/\s+/g,"");
  return raw.replace(/^FST-?/,"");
}
const projectsUrl="https://app.omie.com.br/api/v1/geral/projetos/";
const ordersUrl="https://app.omie.com.br/api/v1/produtos/pedido/";
const customersUrl="https://app.omie.com.br/api/v1/geral/clientes/";

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({found:false,error:"method"},405);
  try{
    const authorization=req.headers.get("Authorization")||"";
    const jwt=authorization.startsWith("Bearer ")?authorization.slice(7):"";
    const {data:{user}}=await admin.auth.getUser(jwt);
    if(!user)return reply({found:false,error:"unauthorized"},401);
    const {codigo}=await req.json();
    const key=canonical(codigo);
    if(!/^\d{1,8}(?:-[A-Z0-9]+)?$/.test(key))
      return reply({found:false,error:"invalid_code"},400);
    const appKey=await secret("OMIE_APP_KEY"),appSecret=await secret("OMIE_APP_SECRET");
    if(!appKey||!appSecret)return reply({found:false,configured:false,error:"omie_not_configured"});

    const expected="FST"+key;
    // Search project records first; Omie allows a substring filter here, so
    // exact comparison is mandatory to avoid treating 26169-B as 26169-A.
    const projectPage=await omie(projectsUrl,"ListarProjetos",{
      pagina:1,registros_por_pagina:50,nome_projeto:expected
    },appKey,appSecret);
    const projects=Array.isArray(projectPage?.cadastro)?projectPage.cadastro:[];
    const project=projects.find((p:any)=>
      canonical(p?.nome)===key && String(p?.inativo||"N").toUpperCase()!=="S"
    );
    if(project){
      const projectId=Number(project.codigo);
      if(!Number.isFinite(projectId)||projectId<=0)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,reason:"project_id_unavailable"});
      // The project catalog does not contain a client. A sales order associated
      // with the exact project is an auditable relationship to the customer.
      const orders=await omie(ordersUrl,"ListarPedidos",{
        pagina:1,registros_por_pagina:50,filtrar_por_projeto:projectId,apenas_resumo:"S"
      },appKey,appSecret);
      if(!orders)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,reason:"orders_unavailable",projectId});
      const clients=new Set<number>();
      for(const row of (Array.isArray(orders.pedido_venda_produto)?orders.pedido_venda_produto:[])){
        const id=Number(row?.cabecalho?.codigo_cliente);
        if(Number.isFinite(id)&&id>0)clients.add(id);
      }
      // Do not autofill a random customer when multiple unrelated orders exist.
      // A second page must be inspected too before claiming a unique customer.
      const totalPages=Number(orders.total_de_paginas||1);
      if(totalPages>1)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,reason:"multiple_order_pages",projectId});
      if(clients.size!==1)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,reason:clients.size?"multiple_clients":"no_linked_sales_order",projectId});
      const clientCode=[...clients][0];
      const customer=await omie(customersUrl,"ConsultarCliente",{codigo_cliente_omie:clientCode},appKey,appSecret);
      const name=String(customer?.nome_fantasia||customer?.razao_social||"").trim();
      if(!name)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,reason:"customer_unavailable",projectId});
      return reply({found:true,cliente:name,source:"omie_projeto_pedido",matchedCode:project.nome,projectId,clientCode});
    }

    // Keep compatibility with legacy installations that use the FST itself as
    // the sales order integration code instead of a project.
    for(const code of [expected,key]){
      const order=await omie(ordersUrl,"ConsultarPedido",{codigo_pedido_integracao:code},appKey,appSecret);
      const clientCode=Number(order?.cabecalho?.codigo_cliente);
      if(!Number.isFinite(clientCode)||clientCode<=0)continue;
      const customer=await omie(customersUrl,"ConsultarCliente",{codigo_cliente_omie:clientCode},appKey,appSecret);
      const name=String(customer?.nome_fantasia||customer?.razao_social||"").trim();
      if(name)return reply({found:true,cliente:name,source:"omie_pedido",matchedCode:code,clientCode});
    }
    // Never claim "not found" when the Omie Projects API failed entirely.
    if(!projectPage)return reply({found:false,error:"omie_projects_unavailable"});
    const variants=projects.filter((p:any)=>canonical(p?.nome).startsWith(key+"-")).map((p:any)=>String(p.nome));
    return reply({found:false,configured:true,reason:"not_found_exact",variants:variants.slice(0,12)});
  }catch(e){
    console.error("sgq-omie-fst failed",String(e));
    return reply({found:false,error:"lookup_unavailable"});
  }
});
