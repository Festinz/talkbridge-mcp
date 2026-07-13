import hashlib
import os
import shutil
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


MODEL_URL = os.environ.get(
    "CHATPOLISH_NLLB_MODEL_URL",
    "https://pretrained-nmt-models.s3.us-west-004.backblazeb2.com/"
    "CTranslate2/nllb/nllb-200_600M_int8_ct2.zip",
)
SENTENCEPIECE_URL = os.environ.get(
    "CHATPOLISH_NLLB_SENTENCEPIECE_URL",
    "https://pretrained-nmt-models.s3.us-west-004.backblazeb2.com/"
    "CTranslate2/nllb/flores200_sacrebleu_tokenizer_spm.model",
)
EXPECTED_SHA256 = os.environ.get(
    "CHATPOLISH_NLLB_MODEL_SHA256",
    "a1dede18a91665b4670fd1e18942317226f3a3a8a1f96fca7099551f065ce224",
).strip().lower()
DOWNLOAD_DIR = Path(os.environ.get("CHATPOLISH_NLLB_DOWNLOAD_DIR", "/tmp/nllb-download"))
INSTALL_ROOT = Path(os.environ.get("CHATPOLISH_NLLB_INSTALL_ROOT", "/opt/nllb"))
MODEL_DIR = INSTALL_ROOT / "model"
ARCHIVE_PATH = DOWNLOAD_DIR / "nllb-200_600M_int8_ct2.zip"


def download_with_resume(url, destination, minimum_bytes):
    destination.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    for attempt in range(1, 7):
        existing = destination.stat().st_size if destination.exists() else 0
        headers = {"User-Agent": "TalkBridge/1.0", "Accept": "*/*"}
        if existing:
            headers["Range"] = f"bytes={existing}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                append = existing > 0 and response.status == 206
                mode = "ab" if append else "wb"
                with destination.open(mode) as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
            if destination.stat().st_size >= minimum_bytes:
                return destination
            errors.append(f"downloaded file is too small: {destination.stat().st_size}")
        except (OSError, urllib.error.URLError) as error:
            errors.append(str(error))
        wait_seconds = min(attempt * 4, 20)
        print(f"Retrying NLLB download in {wait_seconds}s", flush=True)
        time.sleep(wait_seconds)
    raise RuntimeError(f"NLLB download failed: {' | '.join(errors[-5:])}")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


if not (MODEL_DIR / "model.bin").is_file():
    print("Downloading NLLB-200 distilled 600M INT8 model", flush=True)
    download_with_resume(MODEL_URL, ARCHIVE_PATH, 500_000_000)
    if EXPECTED_SHA256:
        actual = sha256(ARCHIVE_PATH)
        if actual != EXPECTED_SHA256:
            raise RuntimeError(f"NLLB archive checksum mismatch: {actual}")
    if not zipfile.is_zipfile(ARCHIVE_PATH):
        raise RuntimeError("NLLB archive is not a valid zip file.")

    extract_root = DOWNLOAD_DIR / "extracted"
    shutil.rmtree(extract_root, ignore_errors=True)
    extract_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE_PATH) as archive:
        resolved_extract_root = extract_root.resolve()
        for member in archive.infolist():
            target = (extract_root / member.filename).resolve()
            if not target.is_relative_to(resolved_extract_root):
                raise RuntimeError(f"Unsafe path in NLLB archive: {member.filename}")
            archive.extract(member, extract_root)
    model_files = list(extract_root.rglob("model.bin"))
    if len(model_files) != 1:
        raise RuntimeError(f"Expected one NLLB model.bin, found {len(model_files)}")
    shutil.rmtree(MODEL_DIR, ignore_errors=True)
    shutil.copytree(model_files[0].parent, MODEL_DIR)

INSTALL_ROOT.mkdir(parents=True, exist_ok=True)
sentencepiece_path = INSTALL_ROOT / "sentencepiece.bpe.model"
if not sentencepiece_path.is_file():
    print("Downloading NLLB SentencePiece model", flush=True)
    download_with_resume(SENTENCEPIECE_URL, sentencepiece_path, 1_000_000)

if not (MODEL_DIR / "model.bin").is_file() or not sentencepiece_path.is_file():
    raise RuntimeError("NLLB installation did not produce the required files.")

print(f"NLLB model installed at {MODEL_DIR}", flush=True)
