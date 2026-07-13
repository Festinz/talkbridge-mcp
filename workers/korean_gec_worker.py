import json
import os
import sys
import traceback

MODEL_ID = os.environ.get("CHATPOLISH_GEC_MODEL", "Soyoung97/gec_kr")
DEVICE = os.environ.get("CHATPOLISH_GEC_DEVICE", "cpu")

tokenizer = None
model = None
torch = None


def load_model():
    global tokenizer, model, torch
    if model is not None and tokenizer is not None:
        return

    import torch as torch_module
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    torch = torch_module
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
    model.to(DEVICE)
    model.eval()


def correct_text(text):
    load_model()
    encoded = tokenizer.encode(text)

    if tokenizer.bos_token_id is not None and tokenizer.eos_token_id is not None:
        input_ids = [tokenizer.bos_token_id] + encoded + [tokenizer.eos_token_id]
        tensor = torch.tensor([input_ids], device=DEVICE)
    else:
        tensor = tokenizer(text, return_tensors="pt").input_ids.to(DEVICE)

    with torch.no_grad():
        output_ids = model.generate(
            tensor,
            max_length=int(os.environ.get("CHATPOLISH_GEC_MAX_LENGTH", "160")),
            num_beams=int(os.environ.get("CHATPOLISH_GEC_NUM_BEAMS", "4")),
            early_stopping=True,
            repetition_penalty=float(os.environ.get("CHATPOLISH_GEC_REPETITION_PENALTY", "2.0")),
        )

    return tokenizer.decode(output_ids.squeeze().tolist(), skip_special_tokens=True).strip()


def write_response(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("id")
        method = request.get("method")

        if method != "correct":
            write_response({"id": request_id, "ok": False, "error": "Unsupported method."})
            continue

        text = str(request.get("text") or "")
        write_response(
            {
                "id": request_id,
                "ok": True,
                "corrected": correct_text(text),
                "model": MODEL_ID,
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
