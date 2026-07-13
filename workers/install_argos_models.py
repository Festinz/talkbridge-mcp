import os

import argostranslate.package


DEFAULT_PAIRS = "en-ko,ko-en,en-ja,ja-en,en-zh,zh-en,en-es,es-en"


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
    argostranslate.package.install_from_path(package.download())
