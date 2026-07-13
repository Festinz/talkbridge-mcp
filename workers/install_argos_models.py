import os
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import argostranslate.package


DEFAULT_PAIRS = "en-ko,ko-en,en-ja,ja-en,en-zh,zh-en,en-es,es-en"
DOWNLOAD_DIR = Path(os.environ.get("CHATPOLISH_ARGOS_DOWNLOAD_DIR", "/tmp/argos-models"))


def requested_pairs():
    value = os.environ.get("CHATPOLISH_ARGOS_MODEL_PAIRS", DEFAULT_PAIRS)
    pairs = []
    for item in value.split(","):
        parts = item.strip().lower().split("-")
        if len(parts) == 2 and all(parts):
            pairs.append((parts[0], parts[1]))
    return pairs


argostranslate.package.update_package_index()
available = argostranslate.package.get_available_packages()
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def candidate_urls(package):
    urls = []
    for link in package.links:
        if link.startswith("https://"):
            urls.append(link)
        elif link.startswith("ipfs://"):
            cid = link.removeprefix("ipfs://")
            urls.extend([
                f"https://ipfs.io/ipfs/{cid}",
                f"https://cloudflare-ipfs.com/ipfs/{cid}",
            ])
    return urls


def download_with_resume(package):
    destination = DOWNLOAD_DIR / f"{package.code}-{package.package_version}.argosmodel"
    errors = []
    for url in candidate_urls(package):
        for attempt in range(1, 6):
            existing = destination.stat().st_size if destination.exists() else 0
            headers = {
                "User-Agent": "curl/8.0",
                "Accept": "application/zip,application/octet-stream;q=0.9,*/*;q=0.8",
            }
            if existing:
                headers["Range"] = f"bytes={existing}-"
            request = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    append = existing > 0 and response.status == 206
                    if existing > 0 and not append:
                        existing = 0
                    mode = "ab" if append else "wb"
                    with destination.open(mode) as output:
                        while chunk := response.read(1024 * 1024):
                            output.write(chunk)
                if zipfile.is_zipfile(destination):
                    return destination
                errors.append(f"invalid archive from {url}")
            except (OSError, urllib.error.URLError) as error:
                errors.append(f"{url} attempt {attempt}: {error}")
            wait_seconds = min(4 * attempt, 20)
            print(f"Retrying {package.code} in {wait_seconds}s", flush=True)
            time.sleep(wait_seconds)
    raise RuntimeError(f"Argos model download failed for {package.code}: {' | '.join(errors[-5:])}")

for source, target in requested_pairs():
    candidates = [
        package
        for package in available
        if package.from_code == source and package.to_code == target
    ]
    if not candidates:
        raise RuntimeError(f"Argos model is unavailable: {source}-{target}")
    package = candidates[-1]
    print(f"Installing Argos model {source}-{target}", flush=True)
    argostranslate.package.install_from_path(download_with_resume(package))
