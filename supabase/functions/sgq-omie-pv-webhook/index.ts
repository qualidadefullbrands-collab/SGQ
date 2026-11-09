import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const APP_HASH = "full-qq4aej8";
const ALLOWED = new Set(["VendaProduto.Incluida", "VendaProduto.Alterada", "VendaProduto.Cancelada"]);
const ORDER_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";
const CLIENT_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
const response = (value: unknown, code = 200) => Response.json(value, { status: code, headers: { "Cache-Control": "no-store" } });

async function secret(name: string): Promise<string> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv.trim();
  const { data, error } = await admin.rpc("edge_get_integration_secret", { p_name: name });
  if (error) throw new Error("Não foi possível ler a credencial de integração: " + name);
  return data ? String(data).trim() : "";
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
function secureEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
async function omie(url: string, call: string, param: Record<string, unknown>, key: string, sec: string): Promise<any> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12500);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: abort.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key: key, app_secret: sec, param: [param] })
    });
    const result = await r.json();
    if (!r.ok || result?.faultstring || result?.faultcode) throw new Error("Omie: " + (result?.faultcode || r.status));
    return result;
  } finally { clearTimeout(timer); }
}
function getOrder(value: any): any | null {
  const raw = value?.pedido_venda_produto;
  const data = Array.isArray(raw) ? raw[0] : raw;
  return data && typeof data === "object" ? data : (value?.cabecalho ? value : null);
}
function extractItems(order: any): Array<{ sku: string; descricao: string; quantidade: number }> {
  const grouped = new Map<string, { sku: string; descricao: string; quantidade: number }>();
  for (const row of Array.isArray(order?.det) ? order.det : []) {
    const p = row?.produto || {};
    const sku = String(p.codigo || "").trim().toUpperCase();
    const descricao = String(p.descricao || "").trim();
    const quantidade = Number(p.quantidade);
    if (!sku || !Number.isFinite(quantidade) || quantidade < 0) continue;
    const existing = grouped.get(sku);
    if (existing) existing.quantidade += quantidade;
    else grouped.set(sku, { sku, descricao, quantidade });
  }
  return [...grouped.values()];
}
function extractFst(order: any): string | null {
  // Somente referência explícita ao FST, nunca deduzir pelo cliente ou SKU.
  const info = order?.informacoes_adicionais || {};
  const fields = [info.numero_pedido_cliente, info.dados_adicionais_nf,
    info.outros_detalhes, order?.observacoes?.obs_venda, order?.cabecalho?.codigo_pedido_integracao];
  const seen = new Set<string>();
  for (const value of fields) {
    const matches = [...String(value ?? "").toUpperCase().matchAll(/\bFST[\s-]?(\d{4,9}(?:-[A-Z])?)\b/g)];
    for (const match of matches) seen.add("FST" + match[1]);
  }
  return seen.size === 1 ? [...seen][0] : null;
}
function orderNumber(event: any): number {
  for (const value of [event?.codigo_pedido, event?.codigo_pedido_omie, event?.nCodPed,
    event?.codigoPedido, event?.pedido?.codigo_pedido, event?.pedido_venda?.codigo_pedido]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}
async function markEvent(messageId: string, status: string, error: string | null = null) {
  await admin.from("sgq_omie_eventos").update({
    status, erro: error?.slice(0, 500) ?? null,
    processado_em: status === "processado" ? new Date().toISOString() : null
  }).eq("message_id", messageId);
}
async function processEvent(messageId: string, topic: string, body: any): Promise<void> {
  try {
    const event = body.event || {};
    const key = await secret("OMIE_APP_KEY");
    const sec = await secret("OMIE_APP_SECRET");
    if (!key || !sec) throw new Error("Credenciais do Omie não configuradas.");
    const initialId = orderNumber(event);
    let raw: any;
    if (initialId) raw = await omie(ORDER_URL, "ConsultarPedido", { codigo_pedido: initialId }, key, sec);
    else if (event?.numero_pedido) raw = await omie(ORDER_URL, "ConsultarPedido", { numero_pedido: String(event.numero_pedido) }, key, sec);
    else throw new Error("Webhook sem identificador consultável de pedido.");
    const order = getOrder(raw);
    if (!order && topic !== "VendaProduto.Cancelada") throw new Error("Consulta do pedido não retornou dados.");
    const pedidoId = Number(order?.cabecalho?.codigo_pedido || initialId);
    if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) throw new Error("Identificador de pedido inválido.");
    const cab = order?.cabecalho || {};
    const clientId = Number(cab.codigo_cliente || event?.codigo_cliente || 0);
    let cliente: string | null = null;
    if (clientId > 0) {
      try {
        const c = await omie(CLIENT_URL, "ConsultarCliente", { codigo_cliente_omie: clientId }, key, sec);
        cliente = String(c?.nome_fantasia || c?.razao_social || "").trim() || null;
      } catch (e) { console.warn("Falha ao obter cliente do PV", pedidoId, String(e)); }
    }
    const info = order?.informacoes_adicionais || {};
    const projeto = Number(info.codProj || 0);
    const number = String(cab.numero_pedido || event?.numero_pedido || pedidoId);
    const items = extractItems(order);
    const status = topic === "VendaProduto.Cancelada" ? "cancelado" :
      topic === "VendaProduto.Incluida" ? "novo" : "alterado";
    const { error } = await admin.from("sgq_omie_pedidos").upsert({
      app_hash: APP_HASH, omie_codigo_pedido: pedidoId, numero_pedido: number,
      codigo_cliente_omie: clientId || null, cliente, codigo_projeto_omie: projeto || null,
      fst_referencia: extractFst(order), status, itens: items, numero_itens: items.length,
      origem_omie: String(cab.origem_pedido || ""), ultimo_evento: topic,
      atualizado_em: new Date().toISOString(), erro: null
    }, { onConflict: "omie_codigo_pedido" });
    if (error) throw new Error("Persistência do pedido: " + error.code);
    await markEvent(messageId, "processado");
  } catch (error) {
    console.error("Erro ao processar evento de pedido Omie", messageId, String(error));
    await markEvent(messageId, "erro", String(error));
  }
}

Deno.serve(async request => {
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!token || token.length < 36 || token.length > 160) return response({ error: "unauthorized" }, 401);
    const { data, error } = await admin.from("sgq_omie_webhook_config")
      .select("token_sha256").eq("app_hash", APP_HASH).single();
    if (error || !data || !secureEqual(await sha256(token), data.token_sha256))
      return response({ error: "unauthorized" }, 401);
    const body = await request.json();
    if (!body || body.appHash !== APP_HASH) return response({ error: "invalid_app" }, 403);
    const topic = String(body.topic || "");
    if (!ALLOWED.has(topic)) return response({ accepted: true, ignored: true });
    const messageId = String(body.messageId || "");
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(messageId)) return response({ error: "invalid_message_id" }, 400);
    const { error: insertError } = await admin.from("sgq_omie_eventos").insert({
      message_id: messageId, app_hash: APP_HASH, topic,
      omie_codigo_pedido: orderNumber(body.event) || null,
      payload: body, status: "recebido"
    });
    if (insertError) {
      if (insertError.code === "23505") return response({ accepted: true, duplicate: true }, 202);
      throw new Error("Falha no armazenamento do evento: " + insertError.code);
    }
    // Omie exige resposta rápida. O evento fica persistido antes da confirmação.
    EdgeRuntime.waitUntil(processEvent(messageId, topic, body));
    return response({ accepted: true }, 202);
  } catch (error) {
    console.error("Webhook de PV não armazenado", String(error));
    return response({ error: "temporarily_unavailable" }, 503);
  }
});
