"""Drive real Supabase Auth / PostgREST / Storage + .NET + Word locally.

The Supabase CLI stack is started separately in a disposable GitHub runner.
This runner refuses any externally hosted API/DB. Test data and login users are
created fresh and can never be written to a cloud project.
"""
from __future__ import annotations
from io import BytesIO
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen
import httpx
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
LOGS=ROOT/"sgq-qc-full-local-logs"
LOGS.mkdir(exist_ok=True)
WORD_URL="http://127.0.0.1:18872"
API_URL="http://127.0.0.1:18873"
processes=[]
logs=[]

def require_local(key):
    value=os.environ.get(key,"")
    if not value:
        raise RuntimeError(f"Missing isolated local setting: {key}")
    u=urlparse(value)
    if u.hostname not in {"localhost","127.0.0.1"}:
        raise RuntimeError(f"QC forbids non-local endpoint in {key}")
    return value

def start(name,cmd,env):
    stream=open(LOGS/f"{name}.log","w",encoding="utf-8")
    p=subprocess.Popen(cmd,stdout=stream,stderr=subprocess.STDOUT,cwd=ROOT,env=env)
    logs.append(stream)
    processes.append((name,p))
    return p

def ready(name, url, proc):
    deadline=time.monotonic()+60
    while time.monotonic()<deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"{name} stopped before readiness")
        try:
            with urlopen(url,timeout=2) as r:
                if r.status==200:
                    print("SGQ_FULL_LOCAL_READY:",name,flush=True)
                    return
        except Exception:
            time.sleep(.4)
    raise RuntimeError(f"{name} did not become ready")

def redact(message):
    return re.sub(r"Bearer\s+[A-Za-z0-9._~+/-]{15,}",
                  "Bearer [REDACTED]",message)

def main():
    db=require_local("SGQ_QC_DB_URL")
    supabase=require_local("SGQ_QC_API_URL")
    anon=os.environ["SGQ_QC_ANON_KEY"]
    service=os.environ["SGQ_QC_SERVICE_KEY"]
    assert "http://" in supabase and "127.0.0.1" in WORD_URL
    env=os.environ.copy()
    env.update({
        "SUPABASE_URL":supabase,
        "SUPABASE_PUBLISHABLE_KEY":anon,
        "AUDIT_DOCS_URL":WORD_URL,
        "ASPNETCORE_URLS":API_URL,
        "DOTNET_NOLOGO":"1",
        "DOTNET_CLI_TELEMETRY_OPTOUT":"1",
        "SGQ_QC_WORD_URL":WORD_URL,
        "SGQ_QC_DOTNET_URL":API_URL,
    })
    # User creation/seed is performed by the Python unittest setup, so each
    # test checks real Auth and PostgREST from the same local Supabase stack.
    word=start("word-real",[
        sys.executable,"-m","uvicorn","server.app:app",
        "--host","127.0.0.1","--port","18872","--no-access-log"],env)
    ready("FastAPI Word",WORD_URL+"/health",word)
    api=start("dotnet-real",[
        "dotnet","run","--project","backend/Sgq.Api/Sgq.Api.csproj",
        "--configuration","Release","--no-build","--no-launch-profile"],env)
    ready("ASP.NET Core 10",API_URL+"/health",api)
    print("SGQ_QC_FULL_LOCAL_START: real Auth + real PostgREST + real Storage + real API + real Word",flush=True)
    res=subprocess.run([
        sys.executable,"-m","unittest","discover",
        "-s","tests/integration/full_local","-p","test_*.py","-v"
    ],cwd=ROOT,env=env,check=False)
    if res.returncode==0:
        print("SGQ_QC_FULL_LOCAL_PASS",flush=True)
    return res.returncode

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
                    p.wait(timeout=5)
        for stream in logs:stream.close()
        if code!=0:
            print("SGQ_QC_FULL_LOCAL_FAIL: sanitized service output",flush=True)
            for name,_ in processes:
                path=LOGS/f"{name}.log"
                if path.exists():
                    print("===== "+name+" =====",flush=True)
                    print(redact("\n".join(path.read_text(errors="replace").splitlines()[-45:])),flush=True)
    sys.exit(code)
