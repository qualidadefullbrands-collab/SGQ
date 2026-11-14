"""Launch three local HTTP services and execute the API→Word integration suite.

No connection to Supabase cloud or Omie. The only service substitute is the
synthetic read-only Supabase HTTP endpoint on 127.0.0.1.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[3]
MOCK_URL="http://127.0.0.1:18861"
WORD_URL="http://127.0.0.1:18862"
API_URL="http://127.0.0.1:18863"
LOGS=ROOT/"sgq-qc-http-logs"
LOGS.mkdir(parents=True,exist_ok=True)
processes=[]
logfiles=[]

def launch(name,cmd,env):
    log=open(LOGS/f"{name}.log","w",encoding="utf-8")
    proc=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,cwd=ROOT,env=env)
    logfiles.append(log)
    processes.append((name,proc))
    return proc

def wait_health(name,url,proc):
    deadline=time.monotonic()+55
    while time.monotonic()<deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"{name} terminou durante inicialização (exit {proc.returncode})")
        try:
            with urlopen(url,timeout=2) as response:
                if response.status==200:
                    print("SGQ_QC_HTTP_READY:",name,flush=True)
                    return
        except Exception:
            time.sleep(.3)
    raise RuntimeError(f"{name} não iniciou no endereço local esperado: {url}")

def main():
    env=os.environ.copy()
    assert (ROOT/"backend/Sgq.Api/Sgq.Api.csproj").exists()
    assert (ROOT/"server/templates/IT001.docx").exists()
    # Intentionally replace all infrastructure settings even if the runner
    # environment inherited a production-looking value from somewhere.
    env["SUPABASE_URL"]=MOCK_URL
    env["SUPABASE_PUBLISHABLE_KEY"]="sgq-qc-synthetic-only"
    env["AUDIT_DOCS_URL"]=WORD_URL
    env["ASPNETCORE_URLS"]=API_URL
    env["DOTNET_NOLOGO"]="1"
    env["DOTNET_CLI_TELEMETRY_OPTOUT"]="1"
    stub=launch("supabase-mock",[
        sys.executable,"-m","uvicorn","mock_supabase:app",
        "--app-dir","tests/integration/api_word",
        "--host","127.0.0.1","--port","18861","--no-access-log"],env)
    wait_health("Supabase sintético",MOCK_URL+"/health",stub)
    word=launch("word-real",[
        sys.executable,"-m","uvicorn","server.app:app",
        "--host","127.0.0.1","--port","18862","--no-access-log"],env)
    wait_health("Word FastAPI real",WORD_URL+"/health",word)
    api=launch("api-dotnet-real",[
        "dotnet","run","--project","backend/Sgq.Api/Sgq.Api.csproj",
        "--configuration","Release","--no-build","--no-launch-profile"],env)
    wait_health("SGQ .NET real",API_URL+"/health",api)
    print("SGQ_QC_HTTP_START: API .NET -> FastAPI Word -> Supabase read-only synthetic",flush=True)
    result=subprocess.run([
        sys.executable,"-m","unittest","discover",
        "-s","tests/integration/api_word","-p","test_api_word.py","-v"],cwd=ROOT,env=env)
    if result.returncode==0:
        print("SGQ_API_WORD_INTEGRATION_PASS",flush=True)
    return result.returncode

if __name__=="__main__":
    code=1
    try:
        code=main()
    finally:
        for name,p in reversed(processes):
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait(timeout=3)
        for file in logfiles:file.close()
        if code!=0:
            print("SGQ_QC_HTTP_FAILED — exibindo últimas linhas dos serviços:",flush=True)
            for name,_ in processes:
                logfile=LOGS/f"{name}.log"
                if logfile.exists():
                    print(f"===== {name} =====",flush=True)
                    print("\n".join(logfile.read_text(errors="replace").splitlines()[-55:]),flush=True)
    sys.exit(code)
