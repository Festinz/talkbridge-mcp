import json
import sys
import traceback

import argostranslate.translate


def write_response(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("id")
        if request.get("method") != "translate":
            write_response({"id": request_id, "ok": False, "error": "Unsupported method."})
            continue

        text = str(request.get("text") or "").strip()
        source = str(request.get("source") or "").strip().lower()
        target = str(request.get("target") or "").strip().lower()
        if not text or not source or not target:
            write_response({"id": request_id, "ok": False, "error": "text, source, and target are required."})
            continue

        translated = argostranslate.translate.translate(text, source, target)
        write_response(
            {
                "id": request_id,
                "ok": True,
                "translatedText": translated,
                "model": "argos-translate",
            }
        )
    except Exception as exc:
        request_id = None
        try:
            request_id = json.loads(line).get("id")
        except Exception:
            pass
        write_response(
            {
                "id": request_id,
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
