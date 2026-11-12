"""Offline, bounded English spelling suggestions for project plans."""

import re
from functools import lru_cache

from spellchecker import SpellChecker

WORD = re.compile(r"(?<![\w@])(?:[A-Za-z]{3,48})(?![\w@])")
PRIVATE_TOKENS = re.compile(r"https?://\S+|\S+@\S+|\w+(?:[._/\-]\w+)+")


@lru_cache(maxsize=1)
def checker():
    """Load the packaged English dictionary once per API process."""
    return SpellChecker(language="en", distance=1)


def suggestions(text):
    """Return a bounded list of suggestions with Unicode code-point offsets."""
    blocked = [match.span() for match in PRIVATE_TOKENS.finditer(text)]
    results = []
    spell = checker()
    checked = 0
    for match in WORD.finditer(text):
        word = match.group()
        if word.isupper() or any(
            start <= match.start() < end for start, end in blocked
        ):
            continue
        if not spell.unknown([word]):
            continue
        checked += 1
        candidates = sorted(
            (
                item
                for item in (spell.candidates(word) or ())
                if item.isascii() and item.isalpha() and len(item) <= 48
            ),
            key=lambda candidate: (-spell.word_usage_frequency(candidate), candidate),
        )[:3]
        if word[0].isupper():
            candidates = [candidate.capitalize() for candidate in candidates]
        if candidates:
            results.append(
                {
                    "word": word,
                    "start": match.start(),
                    "end": match.end(),
                    "candidates": candidates,
                }
            )
        if len(results) >= 30 or checked >= 60:
            break
    return results
