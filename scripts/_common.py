"""Shared helpers for the patch layer. Every script runs from the repo root and
operates on ./upstream, a fresh clone of DemoJameson/Proxy.Modules."""
import re
from pathlib import Path

SRC = Path("upstream/trakt_simplified_chinese/src")


def read(rel):
    return (SRC / rel).read_text(encoding="utf-8")


def write(rel, text):
    (SRC / rel).write_text(text, encoding="utf-8")


def fail(message):
    raise SystemExit(f"ERROR: {message}")


def insert_before(text, pattern, insertion, label):
    """Insert `insertion` at the start of the first regex match (multiline)."""
    match = re.search(pattern, text, flags=re.MULTILINE)
    if not match:
        fail(f"anchor not found for {label}: {pattern}")
    return text[: match.start()] + insertion + text[match.start():]


def sub_once(text, pattern, repl, label, done_marker):
    """Regex-substitute once. Idempotent via `done_marker`; fails loudly when the
    anchor is gone instead of silently doing nothing."""
    if done_marker in text:
        return text
    new_text, count = re.subn(pattern, repl, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        fail(f"anchor not found for {label}")
    return new_text
