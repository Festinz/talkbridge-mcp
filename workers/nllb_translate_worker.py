import json
import os
import sys
import traceback
from pathlib import Path

import ctranslate2
import sentencepiece as spm


LANGUAGE_CATALOG = json.loads(
    Path(__file__).with_name("nllb_languages.json").read_text(encoding="utf-8")
)
LANGUAGE_TAGS = {code: definition["nllb"] for code, definition in LANGUAGE_CATALOG.items()}
KNOWN_TAGS = set(LANGUAGE_TAGS.values())

translator = None
sentencepiece = None


def write_response(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def resolve_language_tag(code):
    value = str(code or "").strip()
    if value in KNOWN_TAGS:
        return value
    return LANGUAGE_TAGS.get(value.lower())


def find_sentencepiece_model(model_path):
    configured = os.environ.get("CHATPOLISH_NLLB_SENTENCEPIECE_PATH")
    candidates = [
        Path(configured) if configured else None,
        model_path / "sentencepiece.bpe.model",
        model_path.parent / "sentencepiece.bpe.model",
        Path("/opt/nllb/sentencepiece.bpe.model"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise FileNotFoundError("NLLB SentencePiece model was not found.")


def ensure_model():
    global translator, sentencepiece
    if translator is not None and sentencepiece is not None:
        return translator, sentencepiece

    model_path = Path(os.environ.get("CHATPOLISH_NLLB_MODEL_PATH", "/opt/nllb/model"))
    if not (model_path / "model.bin").is_file():
        raise FileNotFoundError(f"NLLB CTranslate2 model was not found at {model_path}.")

    sentencepiece_path = find_sentencepiece_model(model_path)
    sentencepiece = spm.SentencePieceProcessor(model_file=str(sentencepiece_path))
    translator = ctranslate2.Translator(
        str(model_path),
        device="cpu",
        compute_type=os.environ.get("CHATPOLISH_NLLB_COMPUTE_TYPE", "int8"),
        inter_threads=int(os.environ.get("CHATPOLISH_NLLB_INTER_THREADS", "1")),
        intra_threads=int(os.environ.get("CHATPOLISH_NLLB_INTRA_THREADS", "0")),
    )
    return translator, sentencepiece


def translate(text, source, target):
    source_tag = resolve_language_tag(source)
    target_tag = resolve_language_tag(target)
    if not source_tag or not target_tag:
        raise ValueError(f"Unsupported NLLB language route: {source}-{target}")

    model, tokenizer = ensure_model()
    source_tokens = [source_tag, *tokenizer.encode(text, out_type=str), "</s>"]
    result = model.translate_batch(
        [source_tokens],
        target_prefix=[[target_tag]],
        beam_size=int(os.environ.get("CHATPOLISH_NLLB_BEAM_SIZE", "2")),
        max_decoding_length=int(os.environ.get("CHATPOLISH_NLLB_MAX_DECODING_LENGTH", "256")),
        repetition_penalty=1.1,
    )[0]
    output_tokens = list(result.hypotheses[0])
    if output_tokens and output_tokens[0] == target_tag:
        output_tokens = output_tokens[1:]
    translated = tokenizer.decode(output_tokens).strip()
    if not translated:
        raise RuntimeError("NLLB returned an empty translation.")
    return translated, source_tag, target_tag


for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        method = request.get("method")
        if method == "languages":
            write_response({"id": request_id, "ok": True, "languages": sorted(LANGUAGE_TAGS)})
            continue
        if method != "translate":
            write_response({"id": request_id, "ok": False, "error": "Unsupported method."})
            continue

        text = str(request.get("text") or "").strip()
        source = str(request.get("source") or "").strip()
        target = str(request.get("target") or "").strip()
        if not text or not source or not target:
            raise ValueError("text, source, and target are required.")

        translated, source_tag, target_tag = translate(text, source, target)
        write_response(
            {
                "id": request_id,
                "ok": True,
                "translatedText": translated,
                "model": "nllb-200-distilled-600M-int8",
                "sourceTag": source_tag,
                "targetTag": target_tag,
            }
        )
    except Exception as exc:
        write_response(
            {
                "id": request_id,
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
