"""Synthetic Supabase HTTP double for SGQ API→real Word integration tests.

Only runs on 127.0.0.1 and never carries production credentials or records.
The .NET API and Python Word generator run as *real* HTTP services while
Supabase Auth/PostgREST/Storage are intentionally simulated and observable.
"""
from __future__ import annotations
from io import BytesIO
from urllib.parse import unquote
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from PIL import Image

app = FastAPI(title="SGQ synthetic Supabase — test only")
PROCESS="11111111-1111-4111-8111-111111111111"
GROUP_A="22222222-2222-4222-8222-222222222222"
GROUP_B="33333333-3333-4333-8333-333333333333"
INSP_A="44444444-4444-4444-8444-444444444444"
INSP_B="55555555-5555-4555-8555-555555555555"
VERSION="66666666-6666-4666-8666-666666666666"
USER="77777777-7777-4777-8777-777777777777"
ITEM_A="88888888-8888-4888-8888-888888888888"
ITEM_B="99999999-9999-4999-8999-999999999999"
PATH_A=f"{USER}/{INSP_A}/evidence-a.png"
PATH_B=f"{USER}/{INSP_B}/evidence-b.png"

parent={"id":PROCESS,"codigo":"FST99999","cliente":"CLIENTE SINTETICO SGQ",
        "it_versao_id":VERSION,"excluido_em":None}
groups=[
    {"id":GROUP_A,"codigo":"FST99999-A","subprocesso_codigo":"A","processo_id":PROCESS,
     "nome":"Componente A","nota_fiscal":"QA-NF-001","origem":"Teste sintético",
     "transporte":"Rodoviário","chegada_cd":"2026-11-13"},
    {"id":GROUP_B,"codigo":"FST99999-B","subprocesso_codigo":"B","processo_id":PROCESS,
     "nome":"Componente B","nota_fiscal":"QA-NF-002","origem":"Teste sintético",
     "transporte":"Rodoviário","chegada_cd":"2026-11-13"},
]
def inspection(n, gid, sku):
    return {
        "id":n,"numero":"INS-QA-"+sku,"grupo_inspecao_id":gid,
        "status":"concluida","resultado":"aprovado","it_versao_id":VERSION,
        "data_inspecao":"2026-11-14","responsavel_id":USER,
        "nivel_inspecao":"II","tamanho_lote":40,"tamanho_amostra":5,
        "total_inspecionado":5,"total_nao_conforme":0,"limite_rejeicao":1,
        "dimensionais_finalizados":True,"testes_finalizados":True,
        "observacoes":"INSPECAO INTEGRADA SINTETICA","excluido_em":None,
        "codigo_amostragem":"D","caixas_recebidas":1,"caixas_avaliar":1
    }
inspections=[inspection(INSP_A,GROUP_A,"A"),inspection(INSP_B,GROUP_B,"B")]
links=[
    {"grupo_inspecao_id":GROUP_A,"processo_item_id":ITEM_A,"unidades_por_conjunto":None,
     "processo_itens":{"id":ITEM_A,"quantidade":40,"caixas_recebidas":1,
       "caixas_inspecionadas":1,"quantidade_por_caixa":40,
       "produtos":{"sku":"QA-SKU-A","nome":"COMPONENTE A SINTETICO",
                   "codigo":"QA-SKU-A"}}},
    {"grupo_inspecao_id":GROUP_B,"processo_item_id":ITEM_B,"unidades_por_conjunto":None,
     "processo_itens":{"id":ITEM_B,"quantidade":40,"caixas_recebidas":1,
       "caixas_inspecionadas":1,"quantidade_por_caixa":40,
       "produtos":{"sku":"QA-SKU-B","nome":"COMPONENTE B SINTETICO",
                   "codigo":"QA-SKU-B"}}}
]
photos=[
    {"inspecao_id":INSP_A,"storage_path":PATH_A,"legenda":"FOTO QA A"},
    {"inspecao_id":INSP_B,"storage_path":PATH_B,"legenda":"FOTO QA B"},
]
version={"id":VERSION,"versao":1,"arquivo_storage_path":None,
         "arquivo_nome":None,"arquivo_mime":None,
         "instrucoes_trabalho":{"codigo":"IT001","titulo":"Modelo sintético"}}
photo_bytes=BytesIO()
Image.new("RGB",(240,160),(32,110,140)).save(photo_bytes,format="PNG")
PNG=photo_bytes.getvalue()
seen=[]

def authorize(authorization):
    if authorization not in ("Bearer qc-ready","Bearer qc-pending","Bearer qc-missing-photo"):
        raise HTTPException(status_code=401,detail="Sessão sintética inválida")
    return authorization.split(" ",1)[1]

@app.get("/health")
async def health():
    return {"status":"ok","synthetic":True}

@app.get("/auth/v1/user")
async def user(authorization: str | None=Header(default=None)):
    authorize(authorization)
    return {"id":USER,"email":"sgq-qc@example.invalid"}

@app.get("/rest/v1/{table}")
async def rest(table:str,request:Request,authorization:str|None=Header(default=None)):
    token=authorize(authorization)
    query=request.query_params
    seen.append({"table":table,"query":str(request.url.query),"method":"GET"})
    if table=="processos":
        values=[dict(parent)]
    elif table=="grupos_inspecao":
        values=[dict(g) for g in groups]
    elif table=="inspecoes":
        values=[]
        for i in inspections:
            entry=dict(i)
            g=next(g for g in groups if g["id"]==entry["grupo_inspecao_id"])
            entry["grupos_inspecao"]={**g,"processos":parent}
            entry["it_versoes"]=version
            values.append(entry)
    elif table=="grupo_inspecao_itens":
        values=[dict(x) for x in links]
    elif table=="inspecao_fotos":
        values=[dict(x) for x in photos if not (
            token=="qc-pending" and x["inspecao_id"]==INSP_A)]
    elif table=="it_versoes":
        values=[dict(version)]
    elif table=="profiles":
        values=[{"id":USER,"nome":"INSPETOR SINTETICO QA","perfil":"gestor","ativo":True}]
    elif table in (
        "it_checklist","inspecao_checklist_resultados",
        "it_parametros_dimensionais","inspecao_dimensional_configuracoes",
        "inspecao_dimensionais","it_testes_especiais",
        "inspecao_testes_resultados",
    ):
        values=[]
    else:
        raise HTTPException(status_code=404,detail="Tabela fora do escopo de QA")
    for field in ["id","grupo_inspecao_id","processo_id","it_versao_id","inspecao_id"]:
        v=query.get(field)
        if v and v.startswith("eq."):
            values=[x for x in values if str(x.get(field))==v[3:]]
        elif v and v.startswith("in.(") and v.endswith(")"):
            selected=set(v[4:-1].split(","))
            values=[x for x in values if str(x.get(field)) in selected]
    if query.get("limit"):
        values=values[:int(query["limit"])]
    return values

@app.get("/storage/v1/object/authenticated/{bucket}/{path:path}")
async def storage(bucket:str,path:str,authorization:str|None=Header(default=None)):
    token=authorize(authorization)
    seen.append({"bucket":bucket,"path":path,"method":"GET"})
    if bucket!="inspecao-fotos" or unquote(path) not in {PATH_A,PATH_B}:
        raise HTTPException(status_code=404,detail="Foto não cadastrada no teste")
    if token=="qc-missing-photo" and unquote(path)==PATH_A:
        raise HTTPException(status_code=404,detail="Evidência sintética ausente")
    return Response(PNG,media_type="image/png")

@app.get("/qa/observations")
async def observations():
    return {"requests":seen,"reads":len(seen),"writes":0}

@app.api_route("/{path:path}",methods=["POST","PATCH","PUT","DELETE"])
async def no_writes(path:str):
    raise HTTPException(status_code=405,detail="QC bloqueia gravações no backend sintético")
