"""Plain-text extraction from PDF bills.

PyMuPDF (fitz) is the primary extractor. If a page yields suspiciously
little text (likely a scanned image), the caller should fall back to OCR
(see ocr.py) — this module only reports whether that looks necessary.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz


class PdfEncryptedError(Exception):
    pass


class PdfCorruptError(Exception):
    pass


# Below this many non-whitespace characters per page (on average), the PDF is
# treated as "no usable text" and OCR fallback is recommended.
MIN_CHARS_PER_PAGE = 40


@dataclass
class PdfTextResult:
    text: str
    page_count: int
    chars_per_page: float
    looks_scanned: bool


def read_pdf_text(path: Path) -> PdfTextResult:
    """Extract text from a PDF. Raises PdfEncryptedError / PdfCorruptError."""
    try:
        doc = fitz.open(str(path))
    except Exception as exc:  # pragma: no cover - fitz raises varied types
        raise PdfCorruptError(f"Could not open PDF: {exc}") from exc

    try:
        if doc.is_encrypted:
            # Try an empty password first (some "encrypted" PDFs are just
            # permission-locked, not password-protected for reading).
            if not doc.authenticate(""):
                raise PdfEncryptedError("PDF is password-protected")

        page_count = doc.page_count
        if page_count == 0:
            raise PdfCorruptError("PDF has zero pages")

        parts: list[str] = []
        for page_index in range(page_count):
            try:
                page = doc[page_index]
                parts.append(page.get_text("text") or "")
            except Exception as exc:  # pragma: no cover
                raise PdfCorruptError(f"Failed reading page: {exc}") from exc
        text = "\n".join(parts)
    finally:
        doc.close()

    non_ws_chars = len(text.replace(" ", "").replace("\n", "").replace("\t", ""))
    chars_per_page = non_ws_chars / page_count if page_count else 0
    looks_scanned = chars_per_page < MIN_CHARS_PER_PAGE

    return PdfTextResult(
        text=normalize_whitespace(text),
        page_count=page_count,
        chars_per_page=chars_per_page,
        looks_scanned=looks_scanned,
    )


def normalize_whitespace(text: str) -> str:
    import re

    text = text.replace(" ", " ").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()
