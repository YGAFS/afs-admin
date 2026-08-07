"""Pipeline integration tests. Uses synthetic PDFs generated on the fly
(via PyMuPDF) instead of committing real bill PDFs to the repo, and a
FakeRepository instead of a live Supabase connection.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pymupdf as fitz
import pytest

from app.config import Settings
from app.pipeline import Pipeline

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures.fake_repository import FakeRepository


def make_pdf(path: Path, text: str) -> Path:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), text, fontsize=10)
    doc.save(str(path))
    doc.close()
    return path


TELUS_BILL_TEXT = (
    "Your TELUS bill July 01, 2026\n"
    "Account number: 6070393200\n"
    "Balance forward from your last bill $0.00\n"
    "Total new charges $95.20\n"
    "Total if received by July 21, 2026\n"
    "Total due $95.20\n"
)


def _settings(tmp_path: Path, *, dry_run: bool) -> Settings:
    data_dir = tmp_path / "data"
    return Settings(
        supabase_url="", supabase_service_role_key="",
        inbox_dir=tmp_path / "inbox", archive_root=tmp_path / "archive",
        data_dir=data_dir, processing_dir=data_dir / "processing",
        review_dir=data_dir / "review", failed_dir=data_dir / "failed",
        logs_dir=data_dir / "logs", enable_ocr=False, dry_run=dry_run,
        stability_window_seconds=1, amount_tolerance=0.05,
    )


def _telus_vendor_row():
    return {"id": "vendor-telus-afs", "name": "Telus", "company_id": "afs", "location_id": "loc-surrey"}


@pytest.fixture(autouse=True)
def _make_dirs(tmp_path):
    for sub in ("inbox", "archive", "data/processing", "data/review", "data/failed", "data/logs"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)


def test_clean_bill_completes_and_is_archived(tmp_path):
    settings = _settings(tmp_path, dry_run=False)
    repo = FakeRepository(
        dry_run=False,
        vendors={("afs", "telus"): _telus_vendor_row()},
        locations={("afs", "surrey office"): {"id": "loc-surrey", "name": "Surrey Office"}},
    )
    pipeline = Pipeline(settings, repo)

    pdf_path = make_pdf(tmp_path / "raw.pdf", TELUS_BILL_TEXT)
    result = pipeline.process_file(pdf_path, original_filename="download (1).pdf")

    assert result.status == "completed"
    assert len(repo.inserted_bills) == 1
    assert repo.inserted_bills[0]["provider"] == "Telus"
    assert repo.inserted_bills[0]["company_id"] == "afs"
    assert result.destination is not None
    assert result.destination.exists()
    assert "AFS" in str(result.destination)


def test_dry_run_never_writes_to_repository(tmp_path):
    settings = _settings(tmp_path, dry_run=True)
    repo = FakeRepository(
        dry_run=True,
        vendors={("afs", "telus"): _telus_vendor_row()},
        locations={("afs", "surrey office"): {"id": "loc-surrey", "name": "Surrey Office"}},
    )
    pipeline = Pipeline(settings, repo)

    pdf_path = make_pdf(tmp_path / "raw.pdf", TELUS_BILL_TEXT)
    result = pipeline.process_file(pdf_path, original_filename="download.pdf")

    assert result.status == "completed"
    assert repo.inserted_bills == []
    assert repo.inserted_imports == []
    # Dry-run still simulates the move so operators can see where it *would* go.
    assert result.destination is not None


def test_duplicate_file_hash_is_not_reprocessed(tmp_path):
    settings = _settings(tmp_path, dry_run=False)
    repo = FakeRepository(
        dry_run=False,
        vendors={("afs", "telus"): _telus_vendor_row()},
        locations={("afs", "surrey office"): {"id": "loc-surrey", "name": "Surrey Office"}},
    )
    pipeline = Pipeline(settings, repo)

    first = make_pdf(tmp_path / "raw1.pdf", TELUS_BILL_TEXT)
    result1 = pipeline.process_file(first, original_filename="a.pdf")
    assert result1.status == "completed"
    assert len(repo.inserted_bills) == 1

    # Byte-for-byte copy (not a second fitz.save(), which may embed a fresh
    # timestamp/ID and produce a different hash for visually-identical
    # content) so the file-hash duplicate path is exercised deterministically.
    second = tmp_path / "raw2.pdf"
    shutil.copyfile(result1.destination, second)
    result2 = pipeline.process_file(second, original_filename="a-copy.pdf")

    assert result2.status == "duplicate"
    # No second bill inserted.
    assert len(repo.inserted_bills) == 1


def test_corrupt_pdf_is_marked_failed_and_file_is_preserved(tmp_path):
    settings = _settings(tmp_path, dry_run=False)
    repo = FakeRepository(dry_run=False)
    pipeline = Pipeline(settings, repo)

    bad_path = tmp_path / "not_a_real_pdf.pdf"
    bad_path.write_bytes(b"this is definitely not a pdf file")

    result = pipeline.process_file(bad_path, original_filename="not_a_real_pdf.pdf")

    assert result.status == "failed"
    assert not bad_path.exists()  # moved, not deleted
    assert result.destination is not None
    assert result.destination.exists()
    assert result.destination.parent == settings.failed_dir
    assert len(repo.inserted_imports) == 1
    assert repo.inserted_imports[0]["status"] == "failed"


def test_unrecognized_vendor_goes_to_review_without_db_write(tmp_path):
    settings = _settings(tmp_path, dry_run=False)
    repo = FakeRepository(dry_run=False)
    pipeline = Pipeline(settings, repo)

    text = "Some Random Utility Co\nAccount Number: 999888777\nTotal Amount Due: $42.00\n"
    pdf_path = make_pdf(tmp_path / "unknown.pdf", text)
    result = pipeline.process_file(pdf_path, original_filename="unknown.pdf")

    assert result.status == "needs_review"
    assert repo.inserted_bills == []
    assert result.destination is not None
    assert result.destination.parent == settings.review_dir
