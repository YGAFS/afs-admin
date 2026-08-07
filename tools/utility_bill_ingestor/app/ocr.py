"""Optional Tesseract OCR fallback for scanned (image-only) PDFs.

Tesseract + poppler are NOT required for normal operation — if they aren't
installed, `ocr_available()` returns False and the pipeline routes the file
to needs_review instead of crashing. See README.md for install steps.
"""
from __future__ import annotations

from pathlib import Path

from app.logging_config import get_logger

log = get_logger()


def ocr_available() -> bool:
    try:
        import pytesseract
        from pdf2image import convert_from_path  # noqa: F401
    except ImportError:
        return False
    try:
        pytesseract.get_tesseract_version()
    except Exception:
        return False
    return True


def ocr_pdf_text(path: Path, *, dpi: int = 300) -> str:
    """Render each page to an image and OCR it. Raises RuntimeError if the
    OCR toolchain isn't available — callers must check ocr_available() first
    (or catch this and fall back to needs_review)."""
    if not ocr_available():
        raise RuntimeError("OCR toolchain (tesseract/poppler) is not available")

    import pytesseract
    from pdf2image import convert_from_path

    images = convert_from_path(str(path), dpi=dpi)
    parts: list[str] = []
    for i, image in enumerate(images):
        try:
            parts.append(pytesseract.image_to_string(image))
        except Exception as exc:
            log.warning("OCR failed on page %d of %s: %s", i + 1, path.name, exc)
    return "\n".join(parts)
