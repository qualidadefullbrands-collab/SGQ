"""End-to-end SGQ, with REAL local Auth, PostgREST, Storage, .NET and Word.

The SQL schema and RLS policy are synthetic fixtures, not production schemas.
A single request JWT travels through the real .NET and FastAPI services to
PostgREST/Storage, and two actual documents are parsed with python-docx.
"""
from __future__ import annotations
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote
import os
import subprocess
import unittest
import uuid
import httpx
from docx import Document
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
PROCESS="11111111-1111-4111-8111-111111111111"
INSP_A="44444444-4444-4444-8444-444444444444"
INSP_B="55555555-5555-4555-8555-555555555555"
REPORT_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
INV_OPEN="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
INV_CLOSED="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
INV_ITEM="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
INV_CLOSED_ITEM="dddddddd-dddd-4ddd-8ddd-dddddddddddd"

def local_url(key):
    from urllib.parse import urlparse
    value=os.environ[key]
    if urlparse(value).hostname not in ("localhost","127.0.0.1"):
        raise ValueError(f"Remote endpoints forbidden: {key}")
    return value.rstrip("/")

def fail_text(response):
    # Only include HTTP response status, never echo bearer credentials.
    return f"HTTP {response.status_code}: {response.text[:450]}"

class FullLocalIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db=local_url("SGQ_QC_DB_URL")
        cls.sb=local_url("SGQ_QC_API_URL")
        cls.api=local_url("SGQ_QC_DOTNET_URL")
        cls.word=local_url("SGQ_QC_WORD_URL")
        cls.anon=os.environ["SGQ_QC_ANON_KEY"]
        cls.service=os.environ["SGQ_QC_SERVICE_KEY"]
        cls.http=httpx.Client(timeout=95,follow_redirects=False)
        cls.owner,cls.owner_token=cls.create_user("owner")
        cls.inv_path=f"{cls.owner}/{INV_OPEN}/{INV_ITEM}/00000000-0000-4000-8000-000000000099.png"
        cls.other,cls.other_token=cls.create_user("other")
        fixture=(ROOT/"tests/integration/full_local/fixture.sql").read_text()
        assert fixture.count("__OWNER_UUID__")>10
        sql=fixture.replace("__OWNER_UUID__",cls.owner)+"\n"+(ROOT/"supabase/sql/sgq_reclassificar_inspecao.sql").read_text()
        p=subprocess.run(["psql","-X","-v","ON_ERROR_STOP=1",cls.db],
                         input=sql,text=True,capture_output=True,check=False)
        if p.returncode:
            raise RuntimeError("Local-only SQL setup failed: "+p.stderr[-1700:])

        # These files are genuine images created in-memory and stored by HTTP
        # through the user's JWT, with SQL policy enforced by Supabase Storage.
        buf=BytesIO()
        Image.new("RGB",(240,160),(60,130,175)).save(buf,format="PNG")
        cls.image=buf.getvalue()
        cls.path_a=f"{cls.owner}/{INSP_A}/evidence-a.png"
        cls.path_b=f"{cls.owner}/{INSP_B}/evidence-b.png"
        for path in (cls.path_a,cls.path_b):
            url=cls.sb+"/storage/v1/object/inspecao-fotos/"+path
            response=cls.http.post(url,headers={
                **cls.headers(cls.owner_token),
                "Content-Type":"image/png","x-upsert":"false",
            },content=cls.image)
            if response.status_code not in (200,201):
                raise RuntimeError("Real Storage upload rejected: "+fail_text(response))
        print("SGQ_QC_SEED_OK: 2 real JWTs; PostgREST rows with owner RLS; 2 Storage images")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls,"http"):cls.http.close()

    @classmethod
    def headers(cls,token):
        return {"apikey":cls.anon,"Authorization":"Bearer "+token}

    @classmethod
    def create_user(cls,kind):
        email=f"qa-sgq-full-local-{kind}@example.invalid"
        r=cls.http.post(cls.sb+"/auth/v1/admin/users",
            headers={"apikey":cls.service,
                     "Authorization":"Bearer "+cls.service},
            json={"email":email,"password":"QcSynthetic#2026!","email_confirm":True})
        if r.status_code not in (200,201):
            raise RuntimeError("Local GoTrue createUser failed: "+fail_text(r))
        uid=r.json()["id"]
        assert str(uuid.UUID(uid))==uid
        login=cls.http.post(cls.sb+"/auth/v1/token",
            params={"grant_type":"password"},
            headers={"apikey":cls.anon,"Content-Type":"application/json"},
            json={"email":email,"password":"QcSynthetic#2026!"})
        if login.status_code!=200:
            raise RuntimeError("Local GoTrue password login failed: "+fail_text(login))
        return uid,login.json()["access_token"]

    @classmethod
    def run_sql(cls,statement):
        p=subprocess.run(["psql","-X","-v","ON_ERROR_STOP=1",cls.db],
            input=statement,capture_output=True,text=True,check=False)
        if p.returncode:
            raise RuntimeError("Synthetic LOCAL-only update failed: "+p.stderr[-700:])

    def parse_docx(self, response):
        self.assertEqual(response.status_code,200,fail_text(response))
        self.assertIn(REPORT_MIME,response.headers.get("content-type",""))
        self.assertTrue(response.content.startswith(b"PK"))
        self.assertGreater(len(response.content),2500)
        doc=Document(BytesIO(response.content))
        texts=" ".join(
            [p.text for p in doc.paragraphs]+
            [c.text for t in doc.tables for row in t.rows for c in row.cells]
        )
        return doc,texts

    def test_01_all_services_healthy_word_templates_real(self):
        self.assertEqual(self.http.get(self.api+"/health").json()["service"],"sgq-api")
        r=self.http.get(self.api+"/health/word")
        self.assertEqual(r.status_code,200,fail_text(r))
        data=r.json()
        self.assertEqual(data["service"],"sgq-docs")
        self.assertTrue(data["generator_ok"],str(data)[:900])
        self.assertEqual(data["template_count"],8)

    def test_02_gotrue_real_jwt_and_identity(self):
        r=self.http.get(self.sb+"/auth/v1/user",headers=self.headers(self.owner_token))
        self.assertEqual(r.status_code,200,fail_text(r))
        self.assertEqual(r.json()["id"],self.owner)

    def test_03_postgrest_real_foreign_key_embeds_and_rls(self):
        q={"select":"id,grupos_inspecao(id,processos(id)),it_versoes(id,instrucoes_trabalho(codigo))",
           "id":f"eq.{INSP_A}"}
        r=self.http.get(self.sb+"/rest/v1/inspecoes",params=q,
                        headers=self.headers(self.owner_token))
        self.assertEqual(r.status_code,200,fail_text(r))
        self.assertEqual(r.json()[0]["grupos_inspecao"]["processos"]["id"],PROCESS)
        self.assertEqual(r.json()[0]["it_versoes"]["instrucoes_trabalho"]["codigo"],"IT001")
        intruder=self.http.get(self.sb+"/rest/v1/inspecoes",params=q,
                        headers=self.headers(self.other_token))
        self.assertEqual(intruder.status_code,200,fail_text(intruder))
        self.assertEqual(intruder.json(),[],"RLS must not leak other users' inspection")

    def test_04_storage_real_private_and_user_scoped(self):
        url=self.sb+"/storage/v1/object/authenticated/inspecao-fotos/"+self.path_a
        allowed=self.http.get(url,headers=self.headers(self.owner_token))
        self.assertEqual(allowed.status_code,200,fail_text(allowed))
        self.assertEqual(allowed.content,self.image)
        denied=self.http.get(url,headers=self.headers(self.other_token))
        self.assertNotEqual(denied.status_code,200,"Other user must not read photo")
        self.assertIn(denied.status_code,(400,401,403,404))
        unauthorized_path=f"{self.owner}/{INSP_A}/intruder.png"
        denied_write=self.http.post(
            self.sb+"/storage/v1/object/inspecao-fotos/"+unauthorized_path,
            headers={**self.headers(self.other_token),"Content-Type":"image/png"},
            content=self.image)
        self.assertIn(denied_write.status_code,(400,401,403),
            "Other user must not upload to owner path")

    def test_05_api_denies_missing_and_invalid_bearer(self):
        endpoint=self.api+f"/api/processos/{PROCESS}/laudo"
        without=self.http.post(endpoint)
        self.assertEqual(without.status_code,401,fail_text(without))
        expired=self.http.post(endpoint,headers=self.headers("not-a-valid-jwt"))
        self.assertEqual(expired.status_code,401,fail_text(expired))

    def test_06_api_recomputes_document_readiness_from_real_postgrest(self):
        r=self.http.get(self.api+f"/api/processos/{PROCESS}/laudo-status",
                        headers=self.headers(self.owner_token))
        self.assertEqual(r.status_code,200,fail_text(r))
        data=r.json()["data"]
        self.assertTrue(data["ready"],str(data))
        self.assertEqual(data["completed"],2)
        self.assertEqual(data["subprocesses"],2)
        self.assertEqual(data["pending"],[])

    def test_07_api_generates_real_combined_word_from_storage_photos(self):
        r=self.http.post(self.api+f"/api/processos/{PROCESS}/laudo",
                        headers=self.headers(self.owner_token))
        doc,words=self.parse_docx(r)
        for expected in ("FST99999-A","FST99999-B","QA-SKU-A","QA-SKU-B"):
            self.assertIn(expected,words)
        self.assertGreaterEqual(len(doc.inline_shapes),2)
        self.assertIn("IT001",unquote(r.headers["content-disposition"]))
        self.assertIn("FST99999",unquote(r.headers["content-disposition"]))

    def test_08_api_individual_report_isolated_to_sku_a(self):
        r=self.http.post(self.api+f"/api/inspecoes/{INSP_A}/laudo",
                        headers=self.headers(self.owner_token),
                        params={"individual":"1"})
        doc,words=self.parse_docx(r)
        self.assertIn("QA-SKU-A",words)
        self.assertNotIn("QA-SKU-B",words)
        self.assertGreaterEqual(len(doc.inline_shapes),1)

    def test_09_second_real_user_cannot_read_another_owners_report(self):
        r=self.http.post(self.api+f"/api/processos/{PROCESS}/laudo",
                        headers=self.headers(self.other_token))
        self.assertNotEqual(r.status_code,200,fail_text(r))
        self.assertFalse(r.content.startswith(b"PK"))
        self.assertNotIn(REPORT_MIME,r.headers.get("content-type",""))

    def test_09a_batch_registration_is_atomic_when_one_photo_is_missing(self):
        good=f"{INSP_A}/gerais/{uuid.uuid4()}-valid.png"
        missing=f"{INSP_A}/gerais/{uuid.uuid4()}-missing.png"
        uploaded=self.http.post(
            self.sb+"/storage/v1/object/inspecao-fotos/"+good,
            headers={**self.headers(self.owner_token),"Content-Type":"image/png"},
            content=self.image)
        self.assertIn(uploaded.status_code,(200,201),fail_text(uploaded))
        result=self.http.post(
            self.api+f"/api/inspecoes/{INSP_A}/fotos/registrar",
            headers=self.headers(self.owner_token),
            json={"fotos":[{"storagePath":good,"legenda":"Upload real"},
                           {"storagePath":missing,"legenda":"Ausente"}]})
        self.assertEqual(result.status_code,409,fail_text(result))
        # Even the existing object must not be registered if another is
        # missing: the UI can retry safely after the upload completes.
        check=self.http.get(self.sb+"/rest/v1/inspecao_fotos",
            headers=self.headers(self.owner_token),
            params={"select":"id,storage_path","storage_path":f"eq.{good}"})
        self.assertEqual(check.status_code,200,fail_text(check))
        self.assertEqual(check.json(),[])

    def test_09b_real_photo_registration_is_idempotent(self):
        path=f"{INSP_A}/gerais/{uuid.uuid4()}-real.png"
        uploaded=self.http.post(
            self.sb+"/storage/v1/object/inspecao-fotos/"+path,
            headers={**self.headers(self.owner_token),"Content-Type":"image/png"},
            content=self.image)
        self.assertIn(uploaded.status_code,(200,201),fail_text(uploaded))
        body={"fotos":[{"storagePath":path,"legenda":"Evidência válida"}]}
        for _ in range(2):
            res=self.http.post(
                self.api+f"/api/inspecoes/{INSP_A}/fotos/registrar",
                headers=self.headers(self.owner_token),json=body)
            self.assertEqual(res.status_code,200,fail_text(res))
            self.assertEqual(res.json()["data"]["salvas"],1)
        check=self.http.get(self.sb+"/rest/v1/inspecao_fotos",
            headers=self.headers(self.owner_token),
            params={"select":"id","storage_path":f"eq.{path}"})
        self.assertEqual(check.status_code,200,fail_text(check))
        self.assertEqual(len(check.json()),1,"retries must not duplicate photo rows")

    def test_09c_missing_replacement_never_archives_original(self):
        original="33333333-4444-4555-8666-777777777777"
        missing=f"{INSP_A}/gerais/{uuid.uuid4()}-not-uploaded.png"
        res=self.http.post(
            self.api+f"/api/inspecoes/{INSP_A}/fotos/{original}/substituir",
            headers=self.headers(self.owner_token),
            json={"storagePath":missing,"legenda":"Não existente"})
        self.assertEqual(res.status_code,409,fail_text(res))
        old=self.http.get(self.sb+"/rest/v1/inspecao_fotos",
            headers=self.headers(self.owner_token),
            params={"select":"id,excluido_em","id":f"eq.{original}"})
        self.assertEqual(old.status_code,200,fail_text(old))
        self.assertEqual(old.json()[0]["excluido_em"],None,
            "Missing file must never archive the old evidence")

    def test_09d_real_replacement_archives_original_and_audits(self):
        original="33333333-4444-4555-8666-777777777777"
        path=f"{INSP_A}/gerais/{uuid.uuid4()}-replacement.png"
        upload=self.http.post(
            self.sb+"/storage/v1/object/inspecao-fotos/"+path,
            headers={**self.headers(self.owner_token),"Content-Type":"image/png"},
            content=self.image)
        self.assertIn(upload.status_code,(200,201),fail_text(upload))
        res=self.http.post(
            self.api+f"/api/inspecoes/{INSP_A}/fotos/{original}/substituir",
            headers=self.headers(self.owner_token),
            json={"storagePath":path,"legenda":"Imagem substituta"})
        self.assertEqual(res.status_code,200,fail_text(res))
        self.assertTrue(res.json()["data"]["ok"])
        check=self.http.get(self.sb+"/rest/v1/inspecao_fotos",
            headers=self.headers(self.owner_token),
            params={"select":"id,excluido_em,substituida_por,storage_path",
                    "inspecao_id":f"eq.{INSP_A}"})
        self.assertEqual(check.status_code,200,fail_text(check))
        rows=check.json()
        old=next(x for x in rows if x["id"]==original)
        new=next(x for x in rows if x["storage_path"]==path)
        self.assertIsNotNone(old["excluido_em"])
        self.assertEqual(old["substituida_por"],new["id"])
        self.assertIsNone(new["excluido_em"])
        audit=self.http.get(self.sb+"/rest/v1/audit_log",
            headers=self.headers(self.owner_token),
            params={"select":"acao","entidade_id":f"eq.{original}"})
        self.assertEqual(audit.status_code,200,fail_text(audit))
        self.assertTrue(any(x["acao"]=="substituicao_foto" for x in audit.json()),
            "photo replacement must persist its audit event")

    def test_09e_inventory_missing_photo_does_not_mutate_physical_count(self):
        endpoint=self.api+f"/api/inventario/cego/itens/{INV_ITEM}/foto/registrar"
        r=self.http.post(endpoint,headers=self.headers(self.owner_token),
                         json={"storagePath":self.inv_path})
        self.assertEqual(r.status_code,409,fail_text(r))
        check=self.http.get(self.sb+"/rest/v1/sgq_inventario_cego_imagens",
            headers=self.headers(self.owner_token),params={"select":"id","item_id":f"eq.{INV_ITEM}"})
        self.assertEqual(check.status_code,200,fail_text(check))
        self.assertEqual(check.json(),[],"Missing Storage object cannot create evidence")
        count=self.http.get(self.sb+"/rest/v1/sgq_inventario_cego_itens",
            headers=self.headers(self.owner_token),params={"select":"quantidade_contada","id":f"eq.{INV_ITEM}"})
        self.assertEqual(count.status_code,200,fail_text(count))
        self.assertEqual(int(count.json()[0]["quantidade_contada"]),37)

    def test_09f_inventory_retry_same_upload_path_is_idempotent(self):
        # Same path from prior rejected HEAD; no second physical count.
        path=self.inv_path
        upload=self.http.post(
            self.sb+"/storage/v1/object/sgq-inventario-cego/"+path,
            headers={**self.headers(self.owner_token),"Content-Type":"image/png"},
            content=self.image)
        self.assertIn(upload.status_code,(200,201),fail_text(upload))
        endpoint=self.api+f"/api/inventario/cego/itens/{INV_ITEM}/foto/registrar"
        ids=[]
        for attempt in range(2):
            r=self.http.post(endpoint,headers=self.headers(self.owner_token),
                json={"storagePath":path})
            self.assertEqual(r.status_code,200,fail_text(r))
            ids.append(r.json()["data"]["id"])
            self.assertEqual(r.json()["data"]["alreadyRegistered"],bool(attempt))
        self.assertEqual(ids[0],ids[1])
        photo=self.http.get(self.sb+"/rest/v1/sgq_inventario_cego_imagens",
            headers=self.headers(self.owner_token),params={"select":"id,storage_path,item_id",
                 "item_id":f"eq.{INV_ITEM}"})
        self.assertEqual(photo.status_code,200,fail_text(photo))
        self.assertEqual(len(photo.json()),1)
        self.assertEqual(photo.json()[0]["storage_path"],path)
        count=self.http.get(self.sb+"/rest/v1/sgq_inventario_cego_itens",
            headers=self.headers(self.owner_token),params={"select":"quantidade_contada",
                "id":f"eq.{INV_ITEM}"})
        self.assertEqual(count.status_code,200,fail_text(count))
        self.assertEqual(int(count.json()[0]["quantidade_contada"]),37)

    def test_09g_inventory_profile_and_owner_enforced(self):
        endpoint=self.api+f"/api/inventario/cego/itens/{INV_ITEM}/foto/registrar"
        another=self.http.post(endpoint,headers=self.headers(self.other_token),
            json={"storagePath":self.inv_path})
        self.assertEqual(another.status_code,403,fail_text(another))
        wrong=self.http.post(endpoint,headers=self.headers(self.owner_token),
            json={"storagePath":f"{self.other}/{INV_OPEN}/{INV_ITEM}/00000000-0000-4000-8000-000000000098.png"})
        self.assertEqual(wrong.status_code,400,fail_text(wrong))

    def test_09h_inventory_closed_session_does_not_accept_new_photo(self):
        closed=f"{self.owner}/{INV_CLOSED}/{INV_CLOSED_ITEM}/00000000-0000-4000-8000-000000000097.png"
        endpoint=self.api+f"/api/inventario/cego/itens/{INV_CLOSED_ITEM}/foto/registrar"
        r=self.http.post(endpoint,headers=self.headers(self.owner_token),
            json={"storagePath":closed})
        self.assertEqual(r.status_code,409,fail_text(r))
        check=self.http.get(self.sb+"/rest/v1/sgq_inventario_cego_imagens",
            headers=self.headers(self.owner_token),params={"select":"id","item_id":f"eq.{INV_CLOSED_ITEM}"})
        self.assertEqual(check.status_code,200,fail_text(check))
        self.assertEqual(check.json(),[])

    def test_09i_inventory_second_file_cannot_replace_first(self):
        newpath=f"{self.owner}/{INV_OPEN}/{INV_ITEM}/00000000-0000-4000-8000-000000000096.png"
        r=self.http.post(self.api+f"/api/inventario/cego/itens/{INV_ITEM}/foto/registrar",
             headers=self.headers(self.owner_token),json={"storagePath":newpath})
        self.assertEqual(r.status_code,409,fail_text(r))
        photo=self.http.get(self.sb+"/rest/v1/sgq_inventario_cego_imagens",
            headers=self.headers(self.owner_token),params={"select":"storage_path",
                "item_id":f"eq.{INV_ITEM}"})
        self.assertEqual(photo.status_code,200,fail_text(photo))
        self.assertEqual(photo.json(),[{"storage_path":self.inv_path}])

    def test_10_another_user_cannot_mutate_evidence(self):
        r=self.http.patch(self.sb+"/rest/v1/inspecao_fotos",
              params={"inspecao_id":f"eq.{INSP_A}"},
              headers={**self.headers(self.other_token),
                       "Content-Type":"application/json","Prefer":"return=representation"},
              json={"storage_path":"tampered.png"})
        # PostgREST may return 200 with zero rows for an UPDATE filtered by
        # RLS; that is still a denied mutation. Verify the stored value.
        self.assertIn(r.status_code,(200,204,401,403),fail_text(r))
        if r.status_code==200:
            self.assertEqual(r.json(),[],"cross-user PATCH affected rows")
        check=self.http.get(self.sb+"/rest/v1/inspecao_fotos",
                        params={"id":"eq.33333333-4444-4555-8666-777777777777",
                                "select":"storage_path"},
                        headers=self.headers(self.owner_token))
        self.assertEqual(check.status_code,200,fail_text(check))
        self.assertEqual(check.json()[0]["storage_path"],self.path_a)

    def test_11_real_storage_missing_evidence_never_delivers_valid_word(self):
        # There can be several active/archived photos after real replacement.
        # Each synthetic missing path must be unique to respect the actual
        # (inspection_id,storage_path) constraint.
        self.run_sql(
            "update public.inspecao_fotos set storage_path='"+
            self.owner+"/"+INSP_A+"/missing-' || id::text || '.png' "+
            "where inspecao_id='"+INSP_A+"';")
        r=self.http.post(self.api+f"/api/inspecoes/{INSP_A}/laudo",
              params={"individual":"1"},headers=self.headers(self.owner_token))
        self.assertEqual(r.status_code,503,fail_text(r))
        self.assertFalse(r.content.startswith(b"PK"))
        self.assertNotIn(REPORT_MIME,r.headers.get("content-type",""))

    def test_12_no_photo_row_prevents_readiness_and_combined_word(self):
        self.run_sql("delete from public.inspecao_fotos where inspecao_id='"+INSP_A+"';")
        status=self.http.get(self.api+f"/api/processos/{PROCESS}/laudo-status",
                         headers=self.headers(self.owner_token))
        self.assertEqual(status.status_code,200,fail_text(status))
        pending=status.json()["data"]
        self.assertFalse(pending["ready"])
        self.assertTrue(any("fotograf" in p.lower() for p in pending["pending"]),str(pending))
        result=self.http.post(self.api+f"/api/processos/{PROCESS}/laudo",
                         headers=self.headers(self.owner_token))
        self.assertEqual(result.status_code,409,fail_text(result))
        self.assertFalse(result.content.startswith(b"PK"))
        print("SGQ_FULL_LOCAL_ASSERT_PASS: real GoTrue, PostgREST RLS, Storage, ASP.NET, Word, and fail-safe evidence")

    def test_13_independent_batch_creates_separate_inspections_and_one_caderno(self):
        body={"codigo":"FST99997","cliente":"Cliente QA", "notaFiscal":"QA-777",
              "origem":"Brasil","transporte":"Rodoviario","chegadaCd":"2026-11-20",
              "dataInspecao":"2026-11-21","itVersionId":"66666666-6666-4666-8666-666666666666",
              "inspectionLevel":"II","requestId":str(uuid.uuid4()),"criarIndependentes":True,
              "ehConjunto":False,"iniciar":True,"itens":[
                  {"sku":"QA-BATCH-A","nome":"Produto independente A","quantidade":40,"quantidadePorCaixa":40,"caixasRecebidas":1,"caixasInspecionadas":1},
                  {"sku":"QA-BATCH-B","nome":"Produto independente B","quantidade":300,"quantidadePorCaixa":100,"caixasRecebidas":3,"caixasInspecionadas":1}
              ]}
        endpoint=self.api+"/api/inspecoes/criar"
        headers=self.headers(self.owner_token)
        invalid=self.http.post(endpoint,headers=headers,json={**body,"codigo":"FST-QA-BATCH"})
        self.assertEqual(invalid.status_code,400,fail_text(invalid))
        first=self.http.post(endpoint,headers=headers,json=body)
        self.assertEqual(first.status_code,200,fail_text(first))
        data=first.json()["data"]
        self.assertEqual(data["quantidade"],2)
        rows=data["inspecoes"]
        self.assertNotEqual(rows[0]["id"],rows[1]["id"])
        self.assertEqual(rows[0]["processo_id"],rows[1]["processo_id"])
        self.assertEqual([x["status"] for x in rows],["em_andamento","aberta"])
        self.assertEqual([x["plano"]["lote"] for x in rows],[40,300])
        retry=self.http.post(endpoint,headers=headers,json=body)
        self.assertEqual(retry.status_code,200,fail_text(retry))
        self.assertEqual([x["id"] for x in retry.json()["data"]["inspecoes"]],[x["id"] for x in rows])
        changed={**body,"notaFiscal":"QA-ALTERADA"}
        conflict=self.http.post(endpoint,headers=headers,json=changed)
        self.assertEqual(conflict.status_code,409,fail_text(conflict))
        for index,row in enumerate(rows):
            group=row["grupo_inspecao_id"]
            query=self.http.get(self.sb+"/rest/v1/grupos_inspecao",headers=headers,
                params={"id":"eq."+group,"select":"tipo,subprocesso_codigo,grupo_inspecao_itens(processo_itens(produtos(sku)))"})
            self.assertEqual(query.status_code,200,fail_text(query))
            stored=query.json()[0]
            self.assertEqual(stored["tipo"],"individual")
            self.assertEqual(stored["subprocesso_codigo"],["A","B"][index])
            self.assertEqual([x["processo_itens"]["produtos"]["sku"] for x in stored["grupo_inspecao_itens"]],[body["itens"][index]["sku"]])
            # Mark synthetic outcomes and attach distinct real Storage evidence.
            # Production completion logic is not bypassed; this is a disposable local fixture.
            ident=str(uuid.UUID(row["id"]))
            result=["aprovado","reprovado"][index]
            self.run_sql("update public.inspecoes set status='concluida',resultado='"+result+
                         "',total_inspecionado=tamanho_amostra,total_nao_conforme="+str(index)+
                         ",dimensionais_finalizados=true,testes_finalizados=true where id='"+ident+"';")
            path=f"{self.owner}/{ident}/batch-{index}.png"
            upload=self.http.post(self.sb+"/storage/v1/object/inspecao-fotos/"+path,headers={
                **headers,"Content-Type":"image/png","x-upsert":"false"},content=self.image)
            self.assertIn(upload.status_code,(200,201),fail_text(upload))
            photo=self.http.post(self.sb+"/rest/v1/inspecao_fotos",headers=headers,
                json={"inspecao_id":ident,"storage_path":path,"legenda":f"EVIDENCIA BATCH {index}"})
            self.assertIn(photo.status_code,(200,201),fail_text(photo))
        doc,words=self.parse_docx(self.http.post(self.api+"/api/processos/"+rows[0]["processo_id"]+"/laudo",headers=headers))
        for expected in ("FST99997-A","FST99997-B","QA-BATCH-A","QA-BATCH-B","EVIDENCIA BATCH 0","EVIDENCIA BATCH 1","APROVADO","REPROVADO"):
            self.assertIn(expected,words)
        self.assertGreaterEqual(len(doc.inline_shapes),2)

    def test_14_confirmed_kit_creates_one_inspection_and_two_component_links(self):
        body={"codigo":"FST99996","cliente":"Cliente QA","notaFiscal":"QA-888",
              "origem":"Brasil","transporte":"Rodoviario","chegadaCd":"2026-11-20",
              "dataInspecao":"2026-11-21","itVersionId":"66666666-6666-4666-8666-666666666666",
              "inspectionLevel":"II","requestId":str(uuid.uuid4()),"ehConjunto":True,"iniciar":False,
              "itens":[{"sku":"QA-KIT-BASE","nome":"Base","quantidade":100,"unidadesPorConjunto":1,"caixasRecebidas":1,"caixasInspecionadas":1},
                       {"sku":"QA-KIT-PECA","nome":"Peça","quantidade":200,"unidadesPorConjunto":2,"caixasRecebidas":2,"caixasInspecionadas":1}]}
        headers=self.headers(self.owner_token)
        bad=self.http.post(self.api+"/api/inspecoes/criar",headers=headers,json={**body,"ehConjunto":False})
        self.assertEqual(bad.status_code,400,fail_text(bad))
        result=self.http.post(self.api+"/api/inspecoes/criar",headers=headers,json=body)
        self.assertEqual(result.status_code,200,fail_text(result))
        row=result.json()["data"]
        self.assertEqual(row["plano"]["lote"],100)
        query=self.http.get(self.sb+"/rest/v1/grupos_inspecao",headers=headers,
            params={"id":"eq."+row["grupo_inspecao_id"],"select":"tipo,grupo_inspecao_itens(unidades_por_conjunto,processo_itens(produtos(sku)))"})
        self.assertEqual(query.status_code,200,fail_text(query))
        stored=query.json()[0]
        self.assertEqual(stored["tipo"],"kit_componentes")
        self.assertEqual({x["processo_itens"]["produtos"]["sku"]:x["unidades_por_conjunto"] for x in stored["grupo_inspecao_itens"]},{"QA-KIT-BASE":1,"QA-KIT-PECA":2})

    def test_15_reclassify_split_merge_atomic_and_word(self):
        headers=self.headers(self.owner_token)
        body={"codigo":"FST99995","cliente":"Cliente QA","notaFiscal":"QA-RECLASS",
              "origem":"Brasil","transporte":"Rodoviario","chegadaCd":"2026-11-20",
              "dataInspecao":"2026-11-21","itVersionId":"66666666-6666-4666-8666-666666666666",
              "inspectionLevel":"II","requestId":str(uuid.uuid4()),"ehConjunto":True,"iniciar":False,
              "itens":[{"sku":"QA-RECLASS-A","nome":"Base","quantidade":100,"unidadesPorConjunto":1,"caixasRecebidas":1,"caixasInspecionadas":1},
                       {"sku":"QA-RECLASS-B","nome":"Peça","quantidade":200,"unidadesPorConjunto":2,"caixasRecebidas":2,"caixasInspecionadas":1}]}
        created=self.http.post(self.api+"/api/inspecoes/criar",headers=headers,json=body)
        self.assertEqual(created.status_code,200,fail_text(created))
        original=created.json()["data"]
        pid=original["processo_id"]
        endpoint=self.api+"/api/inspecoes/"+original["id"]+"/reclassificar"
        def active():
            groups=self.http.get(self.sb+"/rest/v1/grupos_inspecao",headers=headers,
                params={"processo_id":"eq."+pid,"select":"id,tipo,subprocesso_codigo,reclassificado_em,grupo_inspecao_itens(id,processo_item_id,unidades_por_conjunto,processo_itens(produtos(sku))),inspecoes(id,status,excluido_em,tamanho_lote,tamanho_amostra)"}).json()
            return [(g,i) for g in groups for i in g["inspecoes"] if i["excluido_em"] is None]
        before=active()
        ids={x["processo_item_id"] for x in before[0][0]["grupo_inspecao_itens"]}
        self.assertEqual(len(before),1)
        ctx=self.http.post(endpoint,headers=headers,json={"modo":"contexto"})
        self.assertEqual(ctx.status_code,200,fail_text(ctx))
        self.assertEqual(ctx.json()["data"]["tipo"],"kit_componentes")
        unauthorized=self.http.post(endpoint,headers=self.headers(self.other_token),json={"modo":"separar"})
        self.assertIn(unauthorized.status_code,(403,404),fail_text(unauthorized))
        split={"modo":"separar"}
        pre=self.http.post(endpoint,headers=headers,json=split)
        self.assertEqual(pre.status_code,200,fail_text(pre))
        preview=pre.json()["data"]
        self.assertEqual([x["plano"]["lote"] for x in preview["destinos"]],[100,200])
        for target in preview["destinos"]:
            plan=self.http.get(self.api+"/api/amostragem/plano",params={"lote":target["plano"]["lote"],"nivel":target["nivel"]})
            self.assertEqual(plan.status_code,200,fail_text(plan))
            plan_data=plan.json().get("data",plan.json())
            self.assertEqual(target["plano"]["amostra"],plan_data["amostra"])
        self.assertEqual(len(active()),1,"Preview must not change data")
        bad=self.http.post(endpoint,headers=headers,json={**split,"confirmacao":"invalid","motivo":"Teste"})
        self.assertEqual(bad.status_code,409,fail_text(bad))
        self.assertEqual(len(active()),1)
        payload={**split,"confirmacao":preview["confirmacao"],"motivo":"Classificação incorreta no teste"}
        result=self.http.post(endpoint,headers=headers,json=payload)
        self.assertEqual(result.status_code,200,fail_text(result))
        data=result.json()["data"]
        self.assertEqual(len(data["novas"]),2)
        now=active()
        self.assertEqual(len(now),2)
        self.assertEqual({g["tipo"] for g,i in now},{"individual"})
        self.assertEqual({x["processo_item_id"] for g,i in now for x in g["grupo_inspecao_itens"]},ids)
        self.assertEqual({i["tamanho_lote"] for g,i in now},{100,200})
        self.assertEqual(self.http.post(endpoint,headers=headers,json=payload).json()["data"]["novas"],data["novas"])
        stale=self.http.post(self.api+"/api/inspecoes/criar",headers=headers,json=body)
        self.assertEqual(stale.status_code,409,fail_text(stale))
        # Merge again without manually reentering common data.
        merge_url=self.api+"/api/inspecoes/"+data["novas"][0]+"/reclassificar"
        merge={"modo":"agrupar","selecionadas":data["novas"],"unidades":{"QA-RECLASS-A":1,"QA-RECLASS-B":2}}
        pre=self.http.post(merge_url,headers=headers,json=merge)
        self.assertEqual(pre.status_code,200,fail_text(pre))
        mp=pre.json()["data"]
        self.assertEqual(len(mp["destinos"]),1)
        self.assertEqual(mp["destinos"][0]["plano"]["lote"],100)
        merged=self.http.post(merge_url,headers=headers,json={**merge,"confirmacao":mp["confirmacao"],"motivo":"Corrigir para conjunto"})
        self.assertEqual(merged.status_code,200,fail_text(merged))
        final_id=merged.json()["data"]["novas"][0]
        now=active()
        self.assertEqual(len(now),1)
        group,inspection=now[0]
        self.assertEqual(group["tipo"],"kit_componentes")
        self.assertEqual(inspection["id"],final_id)
        self.assertEqual({x["processo_item_id"] for x in group["grupo_inspecao_itens"]},ids)
        self.assertEqual({x["processo_itens"]["produtos"]["sku"]:x["unidades_por_conjunto"] for x in group["grupo_inspecao_itens"]},{"QA-RECLASS-A":1,"QA-RECLASS-B":2})
        history=self.http.get(self.sb+"/rest/v1/audit_log",headers=headers,params={"entidade_id":"eq."+pid,"acao":"eq.reclassificacao_skus","select":"dados"})
        self.assertEqual(history.status_code,200,fail_text(history))
        self.assertEqual(len(history.json()),2)
        self.assertEqual(len(history.json()[0]["dados"]["antes"]["vinculos"]),2)
        # Add actual evidence after preview. The stale correction must fail and
        # retain the original record and evidence, not redistribute or delete them.
        final_url=self.api+"/api/inspecoes/"+final_id+"/reclassificar"
        preview2=self.http.post(final_url,headers=headers,json=split).json()["data"]
        path=f"{self.owner}/{final_id}/reclass-evidence.png"
        upload=self.http.post(self.sb+"/storage/v1/object/inspecao-fotos/"+path,headers={**headers,"Content-Type":"image/png","x-upsert":"false"},content=self.image)
        self.assertIn(upload.status_code,(200,201),fail_text(upload))
        photo=self.http.post(self.sb+"/rest/v1/inspecao_fotos",headers=headers,json={"inspecao_id":final_id,"storage_path":path,"legenda":"EVIDENCIA RECLASS"})
        self.assertIn(photo.status_code,(200,201),fail_text(photo))
        blocked=self.http.post(final_url,headers=headers,json={**split,"confirmacao":preview2["confirmacao"],"motivo":"Não deve modificar"})
        self.assertEqual(blocked.status_code,409,fail_text(blocked))
        self.assertEqual(len(active()),1)
        ctx=self.http.post(final_url,headers=headers,json={"modo":"contexto"}).json()["data"]
        self.assertTrue(ctx["entradas"][0]["bloqueio"])
        # In the isolated fixture only, finish the kit to test the actual single Word.
        self.run_sql("update public.inspecoes set status='concluida',resultado='aprovado',total_inspecionado=tamanho_amostra,total_nao_conforme=0,dimensionais_finalizados=true,testes_finalizados=true where id='"+str(uuid.UUID(final_id))+"';")
        status=self.http.get(self.api+"/api/processos/"+pid+"/laudo-status",headers=headers)
        self.assertEqual(status.status_code,200,fail_text(status))
        self.assertEqual(status.json()["data"]["subprocesses"],1)
        doc,words=self.parse_docx(self.http.post(self.api+"/api/processos/"+pid+"/laudo",headers=headers))
        for expected in ("QA-RECLASS-A","QA-RECLASS-B","EVIDENCIA RECLASS","APROVADO"):
            self.assertIn(expected,words)

if __name__=="__main__":unittest.main()
