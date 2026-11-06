from __future__ import annotations
import os, base64, urllib.parse, re, unicodedata
from io import BytesIO
from docx import Document
from pathlib import Path
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .docx_generator import generate, file_name, generate_inspection, inspection_file_name, append_subprocess_appendix

SUPABASE_URL=os.environ.get("SUPABASE_URL","").rstrip("/")
SUPABASE_KEY=os.environ.get("SUPABASE_PUBLISHABLE_KEY","")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY são obrigatórios")

app=FastAPI(title="SGQ Document Service",version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://app-sgq.onrender.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition","X-SGQ-Storage-Path","X-SGQ-File-Name"],
)

def auth_headers(token:str):
    return {"apikey":SUPABASE_KEY,"Authorization":f"Bearer {token}"}

def rest_headers(token:str):
    return {**auth_headers(token),"Content-Type":"application/json","Accept":"application/json"}

async def verify_user(client:httpx.AsyncClient,token:str):
    r=await client.get(f"{SUPABASE_URL}/auth/v1/user",headers=auth_headers(token))
    if r.status_code!=200:
        raise HTTPException(status_code=401,detail="Sessão inválida ou expirada.")
    return r.json()

async def table_rows(client,token,table,params):
    r=await client.get(f"{SUPABASE_URL}/rest/v1/{table}",headers=rest_headers(token),params=params)
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao consultar {table}: {r.text[:300]}")
    return r.json()

async def storage_download(client,token,bucket,path):
    encoded="/".join(urllib.parse.quote(x,safe="") for x in str(path).split("/"))
    r=await client.get(f"{SUPABASE_URL}/storage/v1/object/authenticated/{bucket}/{encoded}",headers=auth_headers(token))
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao ler arquivo {path}: {r.text[:240]}")
    return r.content

async def storage_upload(client,token,bucket,path,data,content_type):
    encoded="/".join(urllib.parse.quote(x,safe="") for x in str(path).split("/"))
    headers={**auth_headers(token),"Content-Type":content_type,"x-upsert":"true"}
    r=await client.post(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{encoded}",headers=headers,content=data)
    if r.status_code>=300:
        print(f"[storage_upload] bucket={bucket} path={path} status={r.status_code} body={r.text[:300]}")
        status=r.status_code if 400 <= r.status_code < 500 else 502
        raise HTTPException(status_code=status,detail=f"Falha ao salvar relatório: {r.text[:300]}")
    return r.json()

def storage_safe_filename(name:str|None, fallback:str="documento.docx")->str:
    raw=str(name or fallback).strip()
    suffix=Path(raw).suffix.lower()
    if suffix not in {".docx",".pdf"}:
        suffix=Path(fallback).suffix.lower() or ".docx"
    base=raw[:-len(Path(raw).suffix)] if Path(raw).suffix else raw
    base=unicodedata.normalize("NFKD",base).encode("ascii","ignore").decode("ascii")
    base=re.sub(r"[^A-Za-z0-9._-]+","-",base).strip(" .-_")
    if not base:
        base=Path(fallback).stem or "documento"
    return f"{base[:160]}{suffix}"

TEMPLATE_DIR=Path(__file__).resolve().parent / "templates"

def it_template_key(code:str|None)->str:
    digits="".join(re.findall(r"\d+",str(code or "")))
    if not digits: return ""
    return f"IT{int(digits):03d}"

def bundled_it_template(code:str|None)->bytes|None:
    key=it_template_key(code)
    if not key: return None
    path=TEMPLATE_DIR / f"{key}.docx"
    return path.read_bytes() if path.exists() else None

async def patch_it_version(client,token,version_id,payload):
    r=await client.patch(
        f"{SUPABASE_URL}/rest/v1/it_versoes",
        headers={**rest_headers(token),"Prefer":"return=minimal"},
        params={"id":f"eq.{version_id}"},
        json=payload,
    )
    return r.status_code<300

async def patch_execution(client,token,execution_id,payload):
    h={**rest_headers(token),"Prefer":"return=representation"}
    r=await client.patch(
        f"{SUPABASE_URL}/rest/v1/auditoria_execucoes",
        headers=h,
        params={"id":f"eq.{execution_id}"},
        json=payload,
    )
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao atualizar auditoria: {r.text[:240]}")
    return r.json()

@app.get("/ready")
async def ready():
    return {"status":"ok","service":"sgq-docs"}

@app.get("/health")
async def health():
    bundled=sorted(TEMPLATE_DIR.glob("IT*.docx")) if TEMPLATE_DIR.exists() else []
    return {
        "status":"ok",
        "service":"sgq-docs",
        "template_count":len(bundled),
        "inspection_templates":[p.stem for p in bundled],
    }

@app.get("/self-test")
async def self_test():
    bundled=sorted(TEMPLATE_DIR.glob("IT*.docx")) if TEMPLATE_DIR.exists() else []
    template_tests={}
    from PIL import Image
    from io import BytesIO
    from docx.shared import Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    sample_photos=[]
    for width,height in ((1200,500),(500,1200)):
        img=Image.new("RGB",(width,height),(80,110,140))
        buf=BytesIO()
        img.save(buf,format="PNG")
        sample_photos.append({"bytes":buf.getvalue(),"caption":f"Legenda de teste {len(sample_photos)+1}"})
    minimal={
        "inspection":{"numero":"SELF-TEST","status":"concluida","resultado":"aprovado",
            "nivel_inspecao":"II","tamanho_lote":1025,"tamanho_amostra":32,
            "total_inspecionado":32,"total_nao_conforme":0,
            "codigo_amostragem":"J","caixas_recebidas":1,"caixas_avaliar":1},
        "process":{"codigo":"26169-A","cliente":"Teste técnico"},
        "items":[{"id":"selftest-item","produto":{"sku":"SKU1234","nome":"PRODUTO TESTE"},
                  "quantidade":1025.0,"quantidade_por_caixa":1000.0,
                  "caixas_recebidas":1.0,"capacidade":"8,5 g"}],
        "checklist":[],
        "check_results":[],
        "dim_params":[],
        "dim_configs":[],
        "dim_results":[],
        "tests":[],
        "test_results":[],
        "photos":sample_photos,
        "inspector_name":"SGQ",
    }
    for path in bundled:
        try:
            generated=generate_inspection(path.read_bytes(),minimal)
            # Abre novamente o resultado para validar que o pacote DOCX gerado é íntegro.
            from docx import Document
            from docx.oxml.ns import qn
            from io import BytesIO
            word=Document(BytesIO(generated))
            cells=[cell for table in word.tables for row in table.rows for cell in row.cells]
            rendered_text=[cell.text for cell in cells]
            markers=sum(1 for cell in cells
                if cell._tc.get_or_add_tcPr().find(qn("w:shd")) is not None
                and cell._tc.get_or_add_tcPr().find(qn("w:shd")).get(qn("w:fill")) in ("DDEBF7","BED9EF"))
            value_cells=[cell for cell in cells if cell.text in ("FST26169-A","SKU1234")]
            strong_navy=all(any(run.bold and run.font.color.rgb is not None
                for par in cell.paragraphs for run in par.runs) for cell in value_cells)
            def selected(t):
                return sum(1 for row in t.rows for cell in row.cells
                    if cell._tc.get_or_add_tcPr().find(qn("w:shd")) is not None
                    and cell._tc.get_or_add_tcPr().find(qn("w:shd")).get(qn("w:fill")) in ("DDEBF7","BED9EF"))
            sampling_marks=0
            box_marks=0
            box_tables=0
            for table in word.tables:
                content=" ".join(cell.text.lower() for row in table.rows for cell in row.cells)
                if "tamanho do lote" in content or "tamanho lote" in content:
                    sampling_marks+=selected(table)
                if ("caixas" in content or "cx " in content) and (
                    "avaliar" in content or "avaliadas" in content or "avaliad" in content):
                    box_tables+=1
                    box_marks+=selected(table)
            sample_shapes=[p for p in word.inline_shapes if
                p.width==Inches(1.75) and p.height==Inches(1.25)]
            centered_captions=sum(1 for c in cells for p in c.paragraphs
                if "Legenda de teste" in p.text and p.alignment==WD_ALIGN_PARAGRAPH.CENTER)
            template_tests[path.stem]={
                "ok":True,"bytes":len(generated),"fst":("FST26169-A" in rendered_text),
                "sku":("SKU1234" in rendered_text),"navy_bold":strong_navy,
                "selected_sampling_cells":markers,
                "lot_marks":sampling_marks,"box_marks":box_marks,"box_tables":box_tables,
                "photos_uniformes":len(sample_shapes)>=2,
                "legendas_centralizadas":centered_captions>=2
            }
        except Exception as exc:
            template_tests[path.stem]={"ok":False,"error":str(exc)}
    safe_example=storage_safe_filename("498206 - INS-2026-7AF23981 - Laudo de Inspeção.docx","laudo-inspecao.docx")
    storage_key_ok=bool(re.fullmatch(r"[A-Za-z0-9._-]+",safe_example))
    ok=len(bundled)==8 and all(x.get("ok") for x in template_tests.values()) and storage_key_ok
    return {
        "status":"ok" if ok else "degraded",
        "service":"sgq-docs",
        "inspection_templates":[p.stem for p in bundled],
        "template_count":len(bundled),
        "template_tests":template_tests,
        "storage_key_test":{"ok":storage_key_ok,"example":safe_example},
        "generator_ok":ok,
    }

@app.get("/generate/{execution_id}")
async def generate_document(execution_id:str,authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=45.0) as client:
        user=await verify_user(client,token)
        executions=await table_rows(client,token,"auditoria_execucoes",{"id":f"eq.{execution_id}","select":"*","limit":"1"})
        if not executions: raise HTTPException(status_code=404,detail="Auditoria não encontrada.")
        ex=executions[0]
        rq=ex["rq_code"]

        templates=await table_rows(client,token,"auditoria_templates",{"rq_code":f"eq.{rq}","ativo":"eq.true","select":"*","limit":"1"})
        if not templates or not templates[0].get("storage_path"):
            raise HTTPException(status_code=409,detail=f"Modelo oficial {rq} ainda não foi enviado no cadastro de modelos.")
        template=templates[0]
        template_bytes=await storage_download(client,token,"auditoria-modelos",template["storage_path"])

        answers,findings,objects,messages=await __import__("asyncio").gather(
            table_rows(client,token,"auditoria_respostas",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
            table_rows(client,token,"auditoria_achados",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
            table_rows(client,token,"auditoria_objetos",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
            table_rows(client,token,"auditoria_mensagens",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
        )

        photos=[]
        seen=set()
        for m in messages:
            path=m.get("foto_path")
            if not path or path in seen: continue
            seen.add(path)
            try:
                data=await storage_download(client,token,"auditoria-evidencias",path)
                photos.append({"bytes":data,"caption":m.get("texto") or ""})
            except HTTPException:
                pass

        payload={
            "execution":ex,
            "answers":answers,
            "findings":findings,
            "objects":objects,
            "messages":messages,
            "photos":photos,
            "previous":[],
        }
        docx=generate(template_bytes,payload)
        filename=file_name(rq,ex["data_avaliacao"])
        uid=user.get("id") or "user"
        storage_path=f"{uid}/{execution_id}/{storage_safe_filename(filename,'auditoria.docx')}"
        await storage_upload(
            client,token,"auditoria-relatorios",storage_path,docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        now=datetime.now(timezone.utc).isoformat()
        await patch_execution(client,token,execution_id,{
            "documento_storage_path":storage_path,
            "documento_nome":filename,
            "documento_gerado_em":now,
            "power_automate_status":"documento_pronto",
            "atualizado_em":now,
        })

        safe_name=urllib.parse.quote(filename)
        return Response(
            content=docx,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition":f"attachment; filename*=UTF-8''{safe_name}",
                "X-SGQ-Storage-Path":storage_path,
                "X-SGQ-File-Name":filename,
            },
        )


@app.get("/generate-inspection/{inspection_id}")
async def generate_inspection_document(inspection_id:str,nome_conjunto:str|None=None,authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=60.0) as client:
        user=await verify_user(client,token)
        rows=await table_rows(
            client,token,"inspecoes",
            {
                "id":f"eq.{inspection_id}",
                "select":"*,grupos_inspecao(*,processos(*)),it_versoes(*,instrucoes_trabalho(codigo,titulo))",
                "limit":"1"
            }
        )
        if not rows: raise HTTPException(status_code=404,detail="Inspeção não encontrada.")
        inspection=rows[0]
        group_id=inspection.get("grupo_inspecao_id")
        version_id=inspection.get("it_versao_id")
        if not group_id:
            raise HTTPException(status_code=409,detail="Esta inspeção não possui grupo vinculado e não pode gerar o Word.")
        if not version_id:
            raise HTTPException(status_code=409,detail="Esta inspeção não possui IT vinculada. Vincule uma IT para gerar o Word no modelo oficial.")

        group=inspection.get("grupos_inspecao") or {}
        if not group:
            raise HTTPException(status_code=409,detail="Grupo da inspeção não encontrado.")
        process=group.get("processos") or {}

        version=inspection.get("it_versoes") or {}
        if not version:
            raise HTTPException(status_code=409,detail="Versão da IT vinculada não encontrada.")
        instruction=version.get("instrucoes_trabalho") or {}
        it_code=instruction.get("codigo") or ""
        # A versão publicada no SGQ é a fonte oficial. O modelo embarcado fica apenas como fallback técnico.
        template_bytes=None
        version_storage_path=version.get("arquivo_storage_path")
        version_file_name=str(version.get("arquivo_nome") or "")
        version_mime=str(version.get("arquivo_mime") or "")
        version_is_docx=(
            version_file_name.lower().endswith(".docx")
            or "officedocument.wordprocessingml.document" in version_mime.lower()
        )
        if version_storage_path and version_is_docx:
            try:
                template_bytes=await storage_download(client,token,"it-documentos",version_storage_path)
            except HTTPException as exc:
                print(f"[generate-inspection] falha ao ler modelo publicado {version_storage_path}: {exc.detail}")
                template_bytes=None
        if not template_bytes:
            template_bytes=bundled_it_template(it_code)
        if not template_bytes:
            raise HTTPException(status_code=409,detail=f"Modelo Word oficial da {it_code or 'IT'} não está disponível.")

        links=await table_rows(
            client,token,"grupo_inspecao_itens",
            {
                "grupo_inspecao_id":f"eq.{group_id}",
                "select":"processo_item_id,unidades_por_conjunto,processo_itens(*,produtos(*))"
            }
        )
        items=[]
        product_photo_refs=[]
        for link in links:
            raw_item=link.get("processo_itens") or {}
            if not raw_item: continue
            item=dict(raw_item)
            product=item.pop("produtos",{}) or {}
            item["produto"]=product
            item["unidades_por_conjunto"]=link.get("unidades_por_conjunto")
            items.append(item)
            photo_path=product.get("foto_principal_path")
            if photo_path:
                product_photo_refs.append((photo_path,f"Foto principal - {product.get('sku') or ''} {product.get('nome') or ''}".strip()))

        checklist,check_results,dim_params,dim_configs,dim_results,tests,test_results,photo_rows=await __import__("asyncio").gather(
            table_rows(client,token,"it_checklist",{"it_versao_id":f"eq.{version_id}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
            table_rows(client,token,"inspecao_checklist_resultados",{"inspecao_id":f"eq.{inspection_id}","select":"*"}),
            table_rows(client,token,"it_parametros_dimensionais",{"it_versao_id":f"eq.{version_id}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
            table_rows(client,token,"inspecao_dimensional_configuracoes",{"inspecao_id":f"eq.{inspection_id}","select":"*"}),
            table_rows(client,token,"inspecao_dimensionais",{"inspecao_id":f"eq.{inspection_id}","select":"*","order":"sequencia_amostra.asc"}),
            table_rows(client,token,"it_testes_especiais",{"it_versao_id":f"eq.{version_id}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
            table_rows(client,token,"inspecao_testes_resultados",{"inspecao_id":f"eq.{inspection_id}","select":"*"}),
            table_rows(client,token,"inspecao_fotos",{"inspecao_id":f"eq.{inspection_id}","select":"*","order":"criado_em.asc"}),
        )

        inspector_name=""
        if inspection.get("responsavel_id"):
            pr=await table_rows(client,token,"profiles",{"id":f"eq.{inspection.get('responsavel_id')}","select":"nome","limit":"1"})
            if pr: inspector_name=pr[0].get("nome") or ""

        photos=[]
        seen=set()
        for p in photo_rows:
            path=p.get("storage_path")
            if not path or path in seen: continue
            seen.add(path)
            try:
                data=await storage_download(client,token,"inspecao-fotos",path)
                photos.append({"bytes":data,"caption":p.get("legenda") or ""})
            except HTTPException as exc:
                # Never deliver an apparently complete report with missing evidence.
                raise HTTPException(status_code=503,detail="Não foi possível incluir todas as fotos da inspeção. Confira os arquivos e tente novamente.") from exc
        if not photos and product_photo_refs:
            jobs=[storage_download(client,token,"produto-fotos",path) for path,_ in product_photo_refs]
            downloaded=await __import__("asyncio").gather(*jobs,return_exceptions=True)
            for data,(_,caption) in zip(downloaded,product_photo_refs):
                if isinstance(data,(bytes,bytearray)):
                    photos.append({"bytes":bytes(data),"caption":caption})

        payload={
            "inspection":inspection,
            "process":process,
            "group":group,
            "items":items,
            "checklist":checklist,
            "check_results":check_results,
            "dim_params":dim_params,
            "dim_configs":dim_configs,
            "dim_results":dim_results,
            "tests":tests,
            "test_results":test_results,
            "photos":photos,
            "inspector_name":inspector_name,
        }
        docx=generate_inspection(template_bytes,payload)
        first_product=(items[0].get("produto") or {}) if items else {}
        distinct_skus={str((item.get("produto") or {}).get("sku") or item.get("codigo_cliente") or "").strip()
                       for item in items}
        collection_name=(nome_conjunto or "").strip() if len(distinct_skus)>1 else None
        if collection_name and len(collection_name)>100:
            raise HTTPException(status_code=422,detail="O nome do conjunto deve ter até 100 caracteres.")
        filename=inspection_file_name(process.get("codigo"),first_product.get("sku"),
                                      first_product.get("nome"),collection_name=collection_name or (
                                          "Componentes" if len(distinct_skus)>1 else None))
        # Download only: document is assembled from the official IT and returned
        # directly. No Storage object key, upload or laudos DB write is required.
        safe_name=urllib.parse.quote(filename,safe="")
        print(f"[generate-inspection] inspection={inspection_id} it={it_code} generated_bytes={len(docx)}")

        return Response(
            content=docx,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition":f"attachment; filename*=UTF-8''{safe_name}",
                "X-SGQ-File-Name":safe_name,
                "Cache-Control":"no-store",
            },
        )

@app.get("/generate-process/{process_id}")
async def generate_process_document(process_id:str,authorization:str|None=Header(default=None)):
    """Laudo único do FST com a IT oficial uma vez e anexos para A, B, C..."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=75.0) as client:
        await verify_user(client,token)
        parents=await table_rows(client,token,"processos",{"id":f"eq.{process_id}","select":"id,codigo,it_versao_id,excluido_em","limit":"1"})
        if not parents or parents[0].get("excluido_em"):
            raise HTTPException(status_code=404,detail="FST não encontrado ou arquivado.")
        parent=parents[0]
        groups=await table_rows(client,token,"grupos_inspecao",{
            "processo_id":f"eq.{process_id}",
            "select":"id,codigo,subprocesso_codigo,nota_fiscal,nome",
            "order":"subprocesso_codigo.asc,codigo.asc",
        })
        if not groups:
            raise HTTPException(status_code=409,detail="Este FST não possui subprocessos.")
        group_ids=",".join(g["id"] for g in groups)
        inspections=await table_rows(client,token,"inspecoes",{
            "grupo_inspecao_id":f"in.({group_ids})",
            "excluido_em":"is.null",
            "select":"id,numero,status,resultado,grupo_inspecao_id,it_versao_id,data_inspecao,tamanho_lote,tamanho_amostra,nivel_inspecao",
            "order":"criado_em.asc"
        })
        by_group={row["grupo_inspecao_id"]:row for row in inspections}
        missing=[(g.get("subprocesso_codigo") or g.get("codigo")) for g in groups if g["id"] not in by_group]
        pending=[(g.get("subprocesso_codigo") or g.get("codigo")) for g in groups
                 if g["id"] in by_group and by_group[g["id"]].get("status")!="concluida"]
        if missing or pending:
            raise HTTPException(status_code=409,detail=
                "Conclua todos os subprocessos antes de gerar o laudo único. "+
                ("Sem inspeção: "+", ".join(missing)+". " if missing else "")+
                ("Pendentes: "+", ".join(pending)+"." if pending else ""))
        versions={row.get("it_versao_id") for row in inspections if row.get("it_versao_id")}
        parent_version=parent.get("it_versao_id")
        if (len(versions)>1 or (parent_version and versions!={parent_version})):
            raise HTTPException(status_code=409,detail="As ITs dos subprocessos não correspondem à IT única do FST.")
        first=by_group[groups[0]["id"]]
        primary=await generate_inspection_document(first["id"],authorization=authorization)
        if not isinstance(primary,Response) or not getattr(primary,"body",None):
            raise HTTPException(status_code=502,detail="Falha ao montar o documento principal.")
        doc=Document(BytesIO(primary.body))
        # Etiqueta de identificação antes do formulário preenchido do primeiro subprocesso.
        label=doc.add_paragraph()
        label.add_run(f"FST {str(parent.get('codigo') or '').removeprefix('FST')} — LAUDO CONSOLIDADO").bold=True
        label.add_run(f" | Subprocesso {groups[0].get('subprocesso_codigo') or groups[0].get('codigo')}")
        doc._element.body.remove(label._p)
        doc._element.body.insert(0,label._p)

        for group in groups[1:]:
            row=by_group[group["id"]]
            gid=group["id"]
            links,checks,check_results,params,dimensionals,tests,test_results,photo_rows=await __import__("asyncio").gather(
                table_rows(client,token,"grupo_inspecao_itens",{"grupo_inspecao_id":f"eq.{gid}","select":"processo_itens(*,produtos(*))"}),
                table_rows(client,token,"it_checklist",{"it_versao_id":f"eq.{row['it_versao_id']}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
                table_rows(client,token,"inspecao_checklist_resultados",{"inspecao_id":f"eq.{row['id']}","select":"*"}),
                table_rows(client,token,"it_parametros_dimensionais",{"it_versao_id":f"eq.{row['it_versao_id']}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
                table_rows(client,token,"inspecao_dimensionais",{"inspecao_id":f"eq.{row['id']}","select":"*","order":"sequencia_amostra.asc"}),
                table_rows(client,token,"it_testes_especiais",{"it_versao_id":f"eq.{row['it_versao_id']}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
                table_rows(client,token,"inspecao_testes_resultados",{"inspecao_id":f"eq.{row['id']}","select":"*"}),
                table_rows(client,token,"inspecao_fotos",{"inspecao_id":f"eq.{row['id']}","select":"*","order":"criado_em.asc"}),
            )
            items=[]
            for link in links:
                item=dict(link.get("processo_itens") or {})
                if item:
                    item["produto"]=item.pop("produtos",{}) or {}
                    items.append(item)
            photos=[]
            seen=set()
            for photo in photo_rows:
                path=photo.get("storage_path")
                if not path or path in seen:continue
                seen.add(path)
                try:
                    binary=await storage_download(client,token,"inspecao-fotos",path)
                except HTTPException as exc:
                    raise HTTPException(status_code=503,detail=f"Foto indisponível no subprocesso {group.get('subprocesso_codigo') or group.get('codigo')}.") from exc
                photos.append({"bytes":binary,"caption":photo.get("legenda") or ""})
            append_subprocess_appendix(doc,{
                "inspection":row,"group":group,"items":items,
                "checklist":checks,"check_results":check_results,
                "dim_params":params,"dim_results":dimensionals,
                "tests":tests,"test_results":test_results,"photos":photos,
            })
        out=BytesIO()
        doc.save(out)
        filename=f"FST{str(parent.get('codigo') or '').removeprefix('FST')} - Laudo consolidado.docx"
        clean=re.sub(r'[\\/:*?"<>|]+'," ",filename)
        encoded=urllib.parse.quote(clean,safe="")
        return Response(content=out.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition":f"attachment; filename*=UTF-8''{encoded}",
                     "X-SGQ-File-Name":encoded,"Cache-Control":"no-store"})


@app.get("/template-status")
async def template_status(authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=20.0) as client:
        await verify_user(client,token)
        rows=await table_rows(client,token,"auditoria_templates",{"select":"rq_code,rq_version,arquivo_nome,storage_path,ativo","order":"rq_code.asc"})
        return {"templates":rows}
