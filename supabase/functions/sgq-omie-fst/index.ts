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
const receiptsUrl="https://app.omie.com.br/api/v1/produtos/recebimentonfe/";
const receiptCache=new Map<number,{timestamp:number;result:any}>();
const receiptPageSize=100;
const receiptLimitPages=25;

// Incoming supplier NF-e: only an explicit Omie project association can
// automatically populate a legal document number. SKU/client similarity is unsafe.
function receiptsForProject(rows:any[],projectId:number){
  const byKey=new Map<string,{numero:string;serie:string;chave:string;recebId:number}>();
  for(const row of rows){
    if(Number(row?.infoAdicionais?.nIdProjeto)!==projectId)continue;
    const status=row?.infoCadastro||{};
    if(status.cCancelada==="S"||status.cDenegado==="S"||status.cDevolvido==="S"||status.cDevolvidoParc==="S")continue;
    const head=row?.cabec||{};
    const raw=String(head.cNumeroNFe||"").trim();
    if(!/^\d{1,12}$/.test(raw))continue;
    const numero=raw.replace(/^0+(?=\d)/,"");
    const serie=String(head.cSerieNFe||"").trim();
    const chave=String(head.cChaveNfe||"").trim();
    const recebId=Number(head.nIdReceb||0);
    const key=chave.length===44?chave:serie+"/"+numero+"/"+recebId;
    byKey.set(key,{numero,serie,chave,recebId});
  }
  return [...byKey.values()];
}
async function lookupIncomingNfe(projectId:number,appKey:string,appSecret:string){
  const previous=receiptCache.get(projectId);
  if(previous && Date.now()-previous.timestamp<120000)return previous.result;
  // Two-year horizon, evaluated independently from the SKU lookup so this
  // paginated operation never delays opening the inspection or product popup.
  const since=new Date(Date.now()-730*24*3600*1000);
  const formatted=[String(since.getUTCDate()).padStart(2,"0"),String(since.getUTCMonth()+1).padStart(2,"0"),since.getUTCFullYear()].join("/");
  const payload=(page:number)=>({
    nPagina:page,nRegistrosPorPagina:receiptPageSize,cExibirDetalhes:"S",dtEmissaoDe:formatted
  });
  const first=await omie(receiptsUrl,"ListarRecebimentos",payload(1),appKey,appSecret);
  if(!first)return {status:"unavailable",numeroNota:null};
  const pages=Number(first.nTotalPaginas||1);
  if(!Number.isInteger(pages)||pages<1||pages>receiptLimitPages)
    return {status:"incomplete",numeroNota:null};
  let matches=receiptsForProject(Array.isArray(first.recebimentos)?first.recebimentos:[],projectId);
  let complete=true;
  // Keep Omie request concurrency bounded, and stop if multiple distinct NF-es match.
  for(let page=2;page<=pages;page+=4){
    const batch=Array.from({length:Math.min(4,pages-page+1)},(_,i)=>page+i);
    const responses=await Promise.all(batch.map(n=>omie(receiptsUrl,"ListarRecebimentos",payload(n),appKey,appSecret)));
    for(const response of responses){
      if(!response){complete=false;continue}
      matches.push(...receiptsForProject(Array.isArray(response.recebimentos)?response.recebimentos:[],projectId))
    }
    if(matches.length>1)break;
  }
  const unique=new Map(matches.map(item=>[item.chave||item.serie+"/"+item.numero+"/"+item.recebId,item]));
  matches=[...unique.values()];
  const result=!complete?{status:"incomplete",numeroNota:null}:
    matches.length===1?{status:"matched",numeroNota:matches[0].numero,serie:matches[0].serie,source:"recebimento_nfe"}:
    {status:matches.length>1?"multiple":"not_found",numeroNota:null};
  receiptCache.set(projectId,{timestamp:Date.now(),result});
  return result;
}

// ConsultarPedido returns { pedido_venda_produto: { cabecalho, det } } in Omie's official contract.
function unwrapOmiePedido(response:any):any|null{
  const nested=response?.pedido_venda_produto;
  const order=Array.isArray(nested)?nested[0]:nested;
  return order&&typeof order==="object"?order:(response?.cabecalho?response:null);
}
type OmieItem={sku:string;descricao:string;quantidade:number};
function extractItems(order:any):OmieItem[]{
  const items=Array.isArray(order?.det)?order.det:[];
  const bySku=new Map<string,OmieItem>();
  for(const row of items){
    const p=row?.produto;
    const sku=String(p?.codigo||"").trim().toUpperCase();
    const descricao=String(p?.descricao||"").trim();
    const qty=Number(p?.quantidade);
    if(!sku||!descricao||!Number.isFinite(qty)||qty<0)continue;
    const old=bySku.get(sku);
    if(old)old.quantidade+=qty;
    else bySku.set(sku,{sku,descricao,quantidade:qty});
  }
  return [...bySku.values()];
}


Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({found:false,error:"method"},405);
  try{
    const authorization=req.headers.get("Authorization")||"";
    const jwt=authorization.startsWith("Bearer ")?authorization.slice(7):"";
    const {data:{user}}=await admin.auth.getUser(jwt);
    if(!user)return reply({found:false,error:"unauthorized"},401);
    const {codigo,codigoPedido:pedidoSolicitado,modo}=await req.json();
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
      if(modo==="nfe"){
        const nf=await lookupIncomingNfe(projectId,appKey,appSecret);
        return reply({found:true,matchedCode:project.nome,projectId,...nf});
      }
      // The project catalog does not contain a client. A sales order associated
      // with the exact project is an auditable relationship to the customer.
      const orders=await omie(ordersUrl,"ListarPedidos",{
        pagina:1,registros_por_pagina:50,filtrar_por_projeto:projectId,apenas_resumo:"S"
      },appKey,appSecret);
      if(!orders)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,reason:"orders_unavailable",projectId});
      const orderRows=Array.isArray(orders.pedido_venda_produto)?orders.pedido_venda_produto:[];
      const linkedOrders=orderRows.map((row:any)=>({
        codigoPedido:Number(row?.cabecalho?.codigo_pedido),
        numeroPedido:String(row?.cabecalho?.numero_pedido||""),
        codigoCliente:Number(row?.cabecalho?.codigo_cliente),
        quantidadeItens:Number(row?.cabecalho?.quantidade_itens||0)
      })).filter((o:any)=>Number.isFinite(o.codigoPedido)&&o.codigoPedido>0);
      const clientes=new Set<number>();
      for(const row of linkedOrders)if(Number.isFinite(row.codigoCliente)&&row.codigoCliente>0)clientes.add(row.codigoCliente);
      const clients=clientes;
      const totalPages=Number(orders.total_de_paginas||1);
      if(totalPages>1)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,
          reason:"multiple_order_pages",projectId,pedidos:[]});
      const requested=pedidoSolicitado===undefined||pedidoSolicitado===null?0:Number(pedidoSolicitado);
      if(requested && (!Number.isInteger(requested)||!linkedOrders.some((o:any)=>o.codigoPedido===requested)))
        return reply({found:false,error:"pedido_not_linked"},400);
      const chosen=linkedOrders.find((o:any)=>o.codigoPedido===requested)
        || (linkedOrders.length===1?linkedOrders[0]:null);
      const pedidos=linkedOrders.map((o:any)=>({
        codigoPedido:o.codigoPedido,numeroPedido:o.numeroPedido,quantidadeItens:o.quantidadeItens
      }));
      if(!chosen && linkedOrders.length>1)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,
          reason:"multiple_orders",projectId,pedidos});
      if(clients.size!==1 && !chosen)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,
          reason:clients.size?"multiple_clients":"no_linked_sales_order",projectId,pedidos});
      const clientCode=chosen?.codigoCliente||[...clients][0];
      if(!Number.isFinite(clientCode)||clientCode<=0)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,
          reason:"invalid_customer",projectId,pedidos});
      // Separate detailed lookup: ListarPedidos with apenas_resumo:S does not contain det[].
      const [customer,orderDetail]=await Promise.all([
        omie(customersUrl,"ConsultarCliente",{codigo_cliente_omie:clientCode},appKey,appSecret),
        chosen?omie(ordersUrl,"ConsultarPedido",{codigo_pedido:chosen.codigoPedido},appKey,appSecret):Promise.resolve(null)
      ]);
      const name=String(customer?.nome_fantasia||customer?.razao_social||"").trim();
      if(!name)
        return reply({found:true,cliente:null,source:"omie_projeto",matchedCode:project.nome,
          reason:"customer_unavailable",projectId,pedidos});
      // Resolve the official Omie envelope before reading cabecalho and det.
      const resolvedOrder=unwrapOmiePedido(orderDetail);
      // Verify the detailed record belongs to the selected project order/customer.
      const detailMatches=chosen && Number(resolvedOrder?.cabecalho?.codigo_pedido)===chosen.codigoPedido
          && Number(resolvedOrder?.cabecalho?.codigo_cliente)===clientCode;
      const itens=detailMatches?extractItems(resolvedOrder):[];
      const itemLookupFailed=!!chosen&&!detailMatches;
      return reply({found:true,cliente:name,source:"omie_projeto_pedido",matchedCode:project.nome,
        projectId,clientCode,pedidos,numeroPedido:chosen?.numeroPedido||null,
        codigoPedido:chosen?.codigoPedido||null,itens,
        itensDisponiveis:!itemLookupFailed,reason:itemLookupFailed?"order_details_unavailable":null});
    }

    // Keep compatibility with legacy installations that use the FST itself as
    // the sales order integration code instead of a project.
    for(const code of [expected,key]){
      const order=unwrapOmiePedido(await omie(ordersUrl,"ConsultarPedido",{codigo_pedido_integracao:code},appKey,appSecret));
      const clientCode=Number(order?.cabecalho?.codigo_cliente);
      if(!Number.isFinite(clientCode)||clientCode<=0)continue;
      const customer=await omie(customersUrl,"ConsultarCliente",{codigo_cliente_omie:clientCode},appKey,appSecret);
      const name=String(customer?.nome_fantasia||customer?.razao_social||"").trim();
      if(name)return reply({found:true,cliente:name,source:"omie_pedido",matchedCode:code,clientCode,
        numeroPedido:String(order?.cabecalho?.numero_pedido||""),codigoPedido:Number(order?.cabecalho?.codigo_pedido||0),
        itens:extractItems(order),itensDisponiveis:true,pedidos:[]});
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
