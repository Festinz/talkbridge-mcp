import re


_CJK_SENTENCE_ENDINGS = "。！？"
_LATIN_SENTENCE_ENDINGS = ".!?"
_CLOSING_MARKS = "\"'”’」』】）》〉"
_SOFT_ENDINGS = ";；"
_URL_PATTERN = re.compile(r"(?:https?://|www\.)[^\s<>{}\[\]()]+", re.IGNORECASE)
_EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_MENTION_PATTERN = re.compile(r"(?<![\w.+-])[@#][\w.-]+", re.UNICODE)
_NUMBER_PATTERN = re.compile(r"(?<!\w)\d+(?:[.:/-]\d+)*(?!\w)")
_TRAILING_URL_PUNCTUATION = ".,!?;:。，！？；："


def _is_emoji(character):
    codepoint = ord(character)
    return (
        0x1F1E6 <= codepoint <= 0x1F1FF
        or 0x1F300 <= codepoint <= 0x1FAFF
        or 0x2600 <= codepoint <= 0x27BF
    )


def _consume_emoji_sequence(text, start):
    index = start
    found = False
    while index < len(text):
        character = text[index]
        codepoint = ord(character)
        if _is_emoji(character) or character == "\u200d" or codepoint == 0xFE0F or 0x1F3FB <= codepoint <= 0x1F3FF:
            found = found or _is_emoji(character)
            index += 1
            continue
        break
    return index if found else start


def _content_length(text):
    return sum(1 for character in text if character.isalnum())


def _append_clause(clauses, candidate):
    candidate = candidate.strip()
    if not candidate:
        return
    if _content_length(candidate) < 2 and clauses:
        clauses[-1] = f"{clauses[-1]} {candidate}".strip()
        return
    clauses.append(candidate)


def split_chat_clauses(text, max_segments=6):
    """Split chat text only at high-confidence sentence or emoji boundaries."""
    normalized = str(text or "").strip()
    if not normalized or max_segments < 2:
        return [normalized] if normalized else []

    clauses = []
    start = 0
    index = 0
    while index < len(normalized):
        boundary_end = None
        character = normalized[index]

        if character in _CJK_SENTENCE_ENDINGS + _LATIN_SENTENCE_ENDINGS:
            cursor = index + 1
            while cursor < len(normalized) and normalized[cursor] in (
                _CJK_SENTENCE_ENDINGS + _LATIN_SENTENCE_ENDINGS + _CLOSING_MARKS
            ):
                cursor += 1
            is_cjk_boundary = character in _CJK_SENTENCE_ENDINGS
            if is_cjk_boundary or cursor == len(normalized) or normalized[cursor].isspace():
                boundary_end = cursor
        elif character in _SOFT_ENDINGS:
            cursor = index + 1
            if cursor == len(normalized) or normalized[cursor].isspace():
                boundary_end = cursor
        elif _is_emoji(character):
            cursor = _consume_emoji_sequence(normalized, index)
            if cursor < len(normalized) and normalized[cursor].isspace():
                boundary_end = cursor
            index = max(index, cursor - 1)

        if boundary_end is not None and boundary_end < len(normalized):
            cursor = boundary_end
            while cursor < len(normalized) and normalized[cursor].isspace():
                cursor += 1
            _append_clause(clauses, normalized[start:boundary_end])
            start = cursor
            index = cursor - 1
            if len(clauses) >= max_segments - 1:
                break

        index += 1

    _append_clause(clauses, normalized[start:])
    return clauses if len(clauses) > 1 else [normalized]


def _extract_emoji_sequences(text):
    tokens = []
    index = 0
    while index < len(text):
        if not _is_emoji(text[index]):
            index += 1
            continue
        end = _consume_emoji_sequence(text, index)
        tokens.append(text[index:end])
        index = end
    return tokens


def extract_opaque_tokens(text):
    tokens = []
    for match in _URL_PATTERN.finditer(text):
        token = match.group(0).rstrip(_TRAILING_URL_PUNCTUATION)
        if token:
            tokens.append(token)
    tokens.extend(match.group(0) for match in _EMAIL_PATTERN.finditer(text))
    tokens.extend(match.group(0) for match in _MENTION_PATTERN.finditer(text))
    tokens.extend(_extract_emoji_sequences(text))
    return list(dict.fromkeys(tokens))


def extract_critical_tokens(text):
    return list(dict.fromkeys([*extract_opaque_tokens(text), *(_NUMBER_PATTERN.findall(text))]))


def restore_opaque_tokens(source, translated):
    translated = str(translated or "").strip()
    missing = [token for token in extract_opaque_tokens(source) if token.casefold() not in translated.casefold()]
    if not translated or not missing:
        return translated

    ending = ""
    if translated[-1] in _CJK_SENTENCE_ENDINGS + _LATIN_SENTENCE_ENDINGS:
        ending = translated[-1]
        translated = translated[:-1].rstrip()
    return f"{translated} {' '.join(missing)}{ending}".strip()


def prefer_segmented_translation(source, full_translation, segment_translations):
    if len(segment_translations) < 2 or any(not item.strip() for item in segment_translations):
        return False

    segmented_translation = " ".join(item.strip() for item in segment_translations)
    full_length = _content_length(full_translation)
    segmented_length = _content_length(segmented_translation)
    if full_length == 0 or segmented_length == 0:
        return segmented_length > full_length

    critical_tokens = extract_critical_tokens(source)
    full_folded = full_translation.casefold()
    segmented_folded = segmented_translation.casefold()
    full_preserved = sum(token.casefold() in full_folded for token in critical_tokens)
    segmented_preserved = sum(token.casefold() in segmented_folded for token in critical_tokens)
    if segmented_preserved > full_preserved:
        return True

    # A materially shorter full result is a strong signal that one chat clause vanished.
    threshold = 0.78 if len(segment_translations) >= 3 else 0.72
    return full_length < segmented_length * threshold
