"""Real HTTP integration: ASP.NET Core 10 -> FastAPI Word -> fake Supabase.

The API and the document service are actual repository binaries/processes.
Only Supabase Auth/PostgREST/Storage is synthetic, with no write capabilities.
"""
import io
import re
import unittest
from urllib.parse import unquote

import httpx
from docx import Document

API="http://127.0.0.1:18863"
STUB="http://127.0.0.1:18861"
PROCESS="11111111-1111-4111-8111-111111111111"
INSPECTION_A="44444444-4444-4444-8444-444444444444"
INSPECTION_B="55555555-5555-4555-8555-555555555555"
DOCX_MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document"

def auth(token="qc-ready"):
    return {"Authorization":"Bearer "+token}

def document(response):
    assert response.status_code==200,(response.status_code,response.text[:1000])
    assert response.headers["content-type"].startswith(DOCX_MIME),response.headers
    assert response.content.startswith(b"PK"),"A resposta não contém DOCX/ZIP"
    assert len(response.content)>2500
    assert "attachment" in response.headers.get("content-disposition","")
    doc=Document(io.BytesIO(response.content))
    text=" ".join([
        *(p.text for p in doc.paragraphs),
        *(cell.text for table in doc.tables for row in table.rows for cell in row.cells)
    ])
    return doc,text

class RealApiWordIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=httpx.Client(timeout=90,follow_redirects=False)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def test_01_api_and_word_service_are_real_and_healthy(self):
        health=self.client.get(API+"/health")
        self.assertEqual(health.status_code,200)
        self.assertEqual(health.json().get("service"),"sgq-api")
        word=self.client.get(API+"/health/word")
        self.assertEqual(word.status_code,200,word.text[:700])
        data=word.json()
        self.assertEqual(data.get("service"),"sgq-docs")
        self.assertTrue(data.get("generator_ok"),data)
        self.assertEqual(data.get("template_count"),8)
        self.assertTrue(all(x.get("ok") for x in data["template_tests"].values()))

    def test_02_authentication_required_and_expired_denied(self):
        for url in [f"/api/processos/{PROCESS}/laudo",
                    f"/api/inspecoes/{INSPECTION_A}/laudo"]:
            with self.subTest(url=url):
                without=self.client.post(API+url)
                self.assertEqual(without.status_code,401,without.text)
                expired=self.client.post(API+url,headers=auth("qc-expired"))
                self.assertEqual(expired.status_code,401,expired.text)

    def test_03_invalid_inspection_id_and_overlong_collection_name_rejected(self):
        bad=self.client.post(API+"/api/inspecoes/invalido/laudo",headers=auth())
        self.assertEqual(bad.status_code,400,bad.text)
        too_long=self.client.post(
            API+f"/api/inspecoes/{INSPECTION_A}/laudo",
            params={"nomeConjunto":"X"*101},headers=auth())
        self.assertEqual(too_long.status_code,400,too_long.text)

    def test_04_ready_status_recomputed_by_word_service(self):
        result=self.client.get(
            API+f"/api/processos/{PROCESS}/laudo-status",headers=auth())
        self.assertEqual(result.status_code,200,result.text)
        data=result.json()["data"]
        self.assertTrue(data["ready"],data)
        self.assertEqual(data["subprocesses"],2)
        self.assertEqual(data["completed"],2)
        self.assertEqual(data["pending"],[])

    def test_05_pending_photograph_blocks_status_and_word(self):
        status=self.client.get(
            API+f"/api/processos/{PROCESS}/laudo-status",
            headers=auth("qc-pending"))
        self.assertEqual(status.status_code,200,status.text)
        data=status.json()["data"]
        self.assertFalse(data["ready"])
        self.assertTrue(any("fotograf" in p.lower() for p in data["pending"]),data)
        generated=self.client.post(
            API+f"/api/processos/{PROCESS}/laudo",
            headers=auth("qc-pending"))
        self.assertEqual(generated.status_code,409,generated.text[:1000])
        self.assertNotIn(DOCX_MIME,generated.headers.get("content-type",""))

    def test_06_combined_word_has_both_subprocesses_and_photographs(self):
        result=self.client.post(API+f"/api/processos/{PROCESS}/laudo",
                                headers=auth())
        doc,words=document(result)
        self.assertIn("FST99999-A",words)
        self.assertIn("FST99999-B",words)
        self.assertIn("QA-SKU-A",words)
        self.assertIn("QA-SKU-B",words)
        self.assertGreaterEqual(len(doc.inline_shapes),2)
        self.assertIn("IT001",unquote(result.headers["content-disposition"]))
        self.assertIn("FST99999",unquote(result.headers["content-disposition"]))
        self.assertNotIn("QA-SKU-Z",words)

    def test_07_inspection_defaults_to_consolidated_word(self):
        result=self.client.post(
            API+f"/api/inspecoes/{INSPECTION_A}/laudo",headers=auth())
        doc,words=document(result)
        self.assertIn("FST99999-A",words)
        self.assertIn("FST99999-B",words)
        self.assertGreaterEqual(len(doc.inline_shapes),2)

    def test_08_explicit_individual_word_only_has_selected_sku(self):
        result=self.client.post(
            API+f"/api/inspecoes/{INSPECTION_A}/laudo",
            params={"individual":"1"},headers=auth())
        doc,words=document(result)
        self.assertIn("FST99999-A",words)
        self.assertIn("QA-SKU-A",words)
        self.assertNotIn("QA-SKU-B",words)
        self.assertGreaterEqual(len(doc.inline_shapes),1)

    def test_09_missing_inspection_evidence_never_returns_a_word(self):
        # Word returns 503 for lost photo; .NET retries before returning 503.
        result=self.client.post(
            API+f"/api/inspecoes/{INSPECTION_A}/laudo",
            params={"individual":"1"},headers=auth("qc-missing-photo"))
        self.assertEqual(result.status_code,503,result.text[:700])
        self.assertNotIn(DOCX_MIME,result.headers.get("content-type",""))
        self.assertFalse(result.content.startswith(b"PK"))

    def test_10_queries_are_read_only_and_synthetic(self):
        result=self.client.get(STUB+"/qa/observations")
        self.assertEqual(result.status_code,200)
        events=result.json()
        self.assertGreater(events["reads"],15,events)
        self.assertEqual(events["writes"],0)
        for event in events["requests"]:
            self.assertEqual(event["method"],"GET",event)

if __name__=="__main__":
    unittest.main(verbosity=2)
