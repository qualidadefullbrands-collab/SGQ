#!/bin/sh
set -e

/opt/sgq-docs/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 10001 &
DOCS_PID=$!

for i in 1 2 3 4 5 6 7 8 9 10; do
  if /opt/sgq-docs/bin/python - <<'PY'
import urllib.request, sys
try:
    urllib.request.urlopen("http://127.0.0.1:10001/health", timeout=1)
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
  then
    break
  fi
  sleep 1
done

exec dotnet Sgq.Api.dll
