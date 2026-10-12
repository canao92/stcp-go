"""Optional authenticated Moovit API client. Credentials stay in Render environment variables."""
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.request

BASE = "https://api.moovitapp.com/services-app/services/EX/API/"
ALLOWED = {"StopSearch", "GetStopBasicInfo", "GetStopLines", "GetStopArrivals",
           "GetLineBasicInfo", "GetLineStops", "GetLineSchedule", "GetLineStopArrivalsEx"}

def configured():
    return bool(os.getenv("MOOVIT_API_KEY") and os.getenv("MOOVIT_SECRET") and
                (os.getenv("MOOVIT_METRO_ID") or os.getenv("MOOVIT_USER_LOC")))

def request(endpoint, payload):
    if endpoint not in ALLOWED:
        raise ValueError("Operação Moovit não permitida")
    if not configured():
        raise RuntimeError("Acesso Moovit por configurar: faltam credenciais ou área geográfica.")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    stamp = str(int(time.time() * 1000))
    nonce = secrets.token_urlsafe(192)[:255]
    signature = hmac.new(os.environ["MOOVIT_SECRET"].encode(),
                         stamp.encode() + b":" + body + b":" + nonce.encode(),
                         hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json", "API_KEY": os.environ["MOOVIT_API_KEY"],
               "Authorization": "hmacauth " + signature + ":" + nonce + ":" + stamp}
    if os.getenv("MOOVIT_METRO_ID"):
        headers["MOOVIT_METRO_ID"] = os.environ["MOOVIT_METRO_ID"]
    else:
        headers["USER_LOC"] = os.environ["MOOVIT_USER_LOC"]
    req = urllib.request.Request(BASE + endpoint, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as response:
        data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise RuntimeError("Resposta Moovit demasiado grande")
        return json.loads(data.decode("utf-8"))
