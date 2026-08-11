"""End-to-end processing of a single PDF: hash -> dedupe check -> extract
(+ OCR fallback) -> classify -> validate -> upsert -> rename -> archive ->
log. One file's failure never raises past process_file() — callers (the
watcher loop, process-all) can call this in a tight loop safely.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import asdict
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.classifier import classify
from app.config import Settings, load_site_config, load_vendor_config
from app.extractors import GENERIC_EXTRACTOR, pick_extractor
from app.extractors.base import ParsedBill
from app.filename_builder import build_filename, resolve_collision, safe_original_name
from app.graph_client import GraphClient
from app.logging_config import get_logger, mask_account
from app.normalizer import normalize_account_number
from app.ocr import ocr_available, ocr_pdf_text
from app.pdf_reader import PdfCorruptError, PdfEncryptedError, read_pdf_text
from app.repository import Repository, bill_payload_from_parsed
from app.validator import DuplicateInfo, validate

log = get_logger()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, date):
        return obj.isoformat()
    return str(obj)


class PipelineResult:
    def __init__(self, status: str, message: str, destination: Path | None = None):
        self.status = status
        self.message = message
        self.destination = destination


class Pipeline:
    def __init__(
        self,
        settings: Settings,
        repository: Repository | None = None,
        graph_client: GraphClient | None = None,
    ):
        self.settings = settings
        self.repo = repository or Repository(settings)
        self.graph = graph_client or GraphClient(settings)
        self.vendors = load_vendor_config()
        self.sites = load_site_config()

    # ── Public entry point ──────────────────────────────────────────────

    def process_file(self, path: Path, *, original_filename: str | None = None) -> PipelineResult:
        start = time.monotonic()
        original_filename = original_filename or path.name
        log.info("processing start: %s", original_filename)

        # NOTE: file moves/DB writes below are deliberately done *outside*
        # every `except` block that touches `path`, not inside it. Some
        # native libraries (observed with PyMuPDF on a failed open) leave
        # an OS-level handle on the file referenced by the exception object
        # itself; as long as that exception is still bound (which CPython
        # keeps true for the whole duration of a `return expr` evaluated
        # inside the except clause), a same-file move can hang/fail with
        # WinError 32 on Windows. Capturing the error as a plain string and
        # acting after the except block exits avoids this entirely.
        hash_error: str | None = None
        try:
            file_hash = sha256_file(path)
        except OSError as exc:
            hash_error = str(exc)
        if hash_error is not None:
            log.error("could not read file %s: %s", original_filename, hash_error)
            return self._to_failed(path, original_filename, file_hash=None, error=hash_error)

        existing_import = self.repo.find_import_by_hash(file_hash)
        # Only a previously-*completed* or already-confirmed-*duplicate* file
        # short-circuits here — those outcomes are final (the bill is either
        # already registered, or already known to duplicate one that is).
        # 'needs_review' and 'failed' do NOT short-circuit: dropping the same
        # file back into the inbox after fixing an extractor/config issue is
        # the documented way to retry it, and it should actually re-run.
        if existing_import and existing_import.get("status") in ("completed", "duplicate"):
            log.info("duplicate file (hash already processed): %s", original_filename)
            dest = self._move_duplicate(path, original_filename)
            self._write_import_record(
                original_filename=original_filename,
                normalized_filename=None,
                file_hash=file_hash,
                source_path=str(path),
                archived_path=str(dest) if dest else None,
                status="duplicate",
                detected_vendor=existing_import.get("detected_vendor"),
                detected_company_id=existing_import.get("detected_company_id"),
                detected_site=existing_import.get("detected_site"),
                parsed_data=None,
                confidence=None,
                warnings=["exact duplicate of a previously processed file"],
                error_message=None,
                utility_bill_id=None,
            )
            elapsed = time.monotonic() - start
            log.info("processing done (%.2fs): %s -> duplicate", elapsed, original_filename)
            return PipelineResult("duplicate", "exact duplicate file", dest)

        read_error: str | None = None
        pdf_result = None
        try:
            pdf_result = read_pdf_text(path)
        except (PdfEncryptedError, PdfCorruptError) as exc:
            read_error = str(exc)
        if read_error is not None:
            return self._to_failed(path, original_filename, file_hash, read_error)
        assert pdf_result is not None  # guaranteed by the read_error check above

        text = pdf_result.text
        ocr_warning = None
        if pdf_result.looks_scanned:
            if self.settings.enable_ocr:
                if ocr_available():
                    log.info("PDF looks scanned, running OCR: %s", original_filename)
                    try:
                        text = ocr_pdf_text(path) or text
                    except Exception as exc:
                        ocr_warning = f"OCR failed: {exc}"
                        log.warning("%s: %s", original_filename, ocr_warning)
                else:
                    ocr_warning = "PDF looks scanned but OCR toolchain is not installed"
                    log.warning("%s: %s", original_filename, ocr_warning)
            else:
                ocr_warning = "PDF looks scanned and OCR is disabled (ENABLE_OCR=false)"

        extractor, confidence = pick_extractor(text)
        is_generic = extractor.vendor_key == GENERIC_EXTRACTOR.vendor_key
        parsed = None
        extraction_error: str | None = None
        primary_error: str | None = None
        try:
            parsed = extractor.extract(text)
        except Exception as exc:
            primary_error = str(exc)
        if primary_error is not None:
            log.warning(
                "extractor %s failed on %s (%s) — falling back to generic",
                extractor.vendor_key, original_filename, primary_error,
            )
            is_generic = True
            try:
                parsed = GENERIC_EXTRACTOR.extract(text)
            except Exception as exc2:
                extraction_error = f"all extraction failed: {exc2}"
            if extraction_error is None:
                assert parsed is not None  # set by the successful GENERIC_EXTRACTOR.extract() above
                parsed.warnings.append(f"primary extractor '{extractor.vendor_key}' raised: {primary_error}")
        if extraction_error is not None:
            return self._to_failed(path, original_filename, file_hash, extraction_error)
        assert parsed is not None  # guaranteed by the extraction_error check above

        if ocr_warning:
            parsed.warnings.append(ocr_warning)

        classification = classify(parsed, text, self.vendors, self.sites)

        vendor_row = None
        location_row = None
        service_account_row = None
        provider = parsed.vendor_name
        utility_name = None
        if classification.vendor_cfg:
            vcfg = classification.vendor_cfg
            provider = vcfg.db_name
            utility_name = vcfg.utility_name
            vendor_row = self.repo.resolve_vendor(vcfg.company_id, vcfg.db_name)
            if vendor_row is None:
                classification.warnings.append(
                    f"vendors.yaml entry '{vcfg.key}' has no matching utility_vendors row "
                    f"(company_id={vcfg.company_id}, name={vcfg.db_name!r})"
                )
            else:
                site_cfg = self.sites.get(vcfg.company_id, None)
                site_entry = site_cfg.sites.get(vcfg.site_code) if (site_cfg and vcfg.site_code) else None
                if site_entry:
                    location_row = self.repo.resolve_location(vcfg.company_id, site_entry.db_location_name)
                if parsed.account_number:
                    service_account_row = self.repo.resolve_service_account(
                        vendor_row["id"], normalize_account_number(parsed.account_number)
                    )

        duplicate = self._check_duplicates(provider, parsed)

        result = validate(
            parsed,
            classification,
            duplicate,
            is_generic=is_generic,
            amount_tolerance=Decimal(str(self.settings.amount_tolerance)),
        )

        outcome = self._apply_outcome(
            path=path,
            original_filename=original_filename,
            file_hash=file_hash,
            parsed=parsed,
            classification=classification,
            provider=provider,
            utility_name=utility_name,
            vendor_row=vendor_row,
            location_row=location_row,
            service_account_row=service_account_row,
            validation=result,
            confidence=confidence,
        )

        elapsed = time.monotonic() - start
        log.info(
            "processing done (%.2fs): %s -> %s (vendor=%s account=%s)",
            elapsed, original_filename, outcome.status,
            classification.vendor_key, mask_account(parsed.account_number),
        )
        return outcome

    # ── Duplicate detection against utility_bills (beyond file hash) ────

    def _check_duplicates(self, provider: str | None, parsed: ParsedBill) -> DuplicateInfo:
        if not provider or not self.repo.has_client:
            return DuplicateInfo()

        existing = None
        matched_by = None
        if parsed.bill_number:
            existing = self.repo.find_bill_by_bill_number(provider, parsed.account_number, parsed.bill_number)
            matched_by = "bill_number"
        elif parsed.billing_year and parsed.billing_month:
            existing = self.repo.find_bill_by_period(
                provider, parsed.account_number, parsed.billing_year, parsed.billing_month
            )
            matched_by = "billing_period"

        if not existing:
            return DuplicateInfo()

        amount_differs = False
        new_total = parsed.total_due if parsed.total_due is not None else parsed.current_charges
        existing_total = existing.get("total_due") if existing.get("total_due") is not None else existing.get("amount")
        if new_total is not None and existing_total is not None:
            amount_differs = abs(Decimal(str(existing_total)) - new_total) > Decimal(
                str(self.settings.amount_tolerance)
            )

        date_differs = bool(
            parsed.due_date and existing.get("due_date") and str(parsed.due_date) != existing["due_date"]
        )

        return DuplicateInfo(
            matched_bill_id=existing["id"],
            matched_by=matched_by,
            amount_differs=amount_differs,
            date_differs=date_differs,
        )

    # ── Outcome application (DB write + file move + import log) ─────────

    def _apply_outcome(
        self, *, path: Path, original_filename: str, file_hash: str, parsed: ParsedBill,
        classification, provider, utility_name, vendor_row, location_row, service_account_row,
        validation, confidence: float,
    ) -> PipelineResult:
        parsed_json = json.dumps(asdict(parsed), default=_json_default)

        if validation.status == "completed":
            payload = bill_payload_from_parsed(
                company_id=classification.company_id,
                utility_name=utility_name or "",
                provider=provider or "",
                parsed=parsed,
                location_id=(location_row or {}).get("id"),
                service_account_id=(service_account_row or {}).get("id"),
                auto_pay=bool(classification.vendor_cfg and classification.vendor_cfg.auto_pay),
            )
            bill_id = self.repo.insert_bill(payload)

            filename = build_filename(
                site_code=classification.site_code,
                company_id=classification.company_id,
                vendor_db_name=(classification.vendor_cfg.folder_name if classification.vendor_cfg else provider),
                issue_date=parsed.issue_date,
                bill_number=parsed.bill_number,
                billing_period_start=parsed.billing_period_start,
                billing_period_end=parsed.billing_period_end,
                account_number=parsed.account_number,
                original_filename=original_filename,
            )
            dest_dir = self._archive_dir(classification)
            dest = self._safe_move(path, dest_dir, filename)

            if bill_id and dest is not None:
                self._attach_onedrive_link(bill_id, dest)

            self._write_import_record(
                original_filename=original_filename, normalized_filename=filename,
                file_hash=file_hash, source_path=str(path), archived_path=str(dest) if dest else None,
                status="completed", detected_vendor=classification.vendor_key,
                detected_company_id=classification.company_id, detected_site=classification.site_code,
                parsed_data=parsed_json, confidence=confidence, warnings=validation.warnings,
                error_message=None, utility_bill_id=bill_id,
            )
            return PipelineResult("completed", "registered", dest)

        if validation.status == "duplicate":
            dest = self._move_duplicate(path, original_filename)
            self._write_import_record(
                original_filename=original_filename, normalized_filename=None, file_hash=file_hash,
                source_path=str(path), archived_path=str(dest) if dest else None, status="duplicate",
                detected_vendor=classification.vendor_key, detected_company_id=classification.company_id,
                detected_site=classification.site_code, parsed_data=parsed_json, confidence=confidence,
                warnings=validation.warnings, error_message=None, utility_bill_id=None,
            )
            return PipelineResult("duplicate", "duplicate", dest)

        # needs_review
        filename = build_filename(
            site_code=classification.site_code, company_id=classification.company_id,
            vendor_db_name=(classification.vendor_cfg.folder_name if classification.vendor_cfg else None),
            issue_date=parsed.issue_date, bill_number=parsed.bill_number,
            billing_period_start=parsed.billing_period_start, billing_period_end=parsed.billing_period_end,
            account_number=parsed.account_number, original_filename=original_filename,
        )
        dest = self._safe_move(path, self.settings.review_dir, filename)
        self._write_import_record(
            original_filename=original_filename, normalized_filename=filename, file_hash=file_hash,
            source_path=str(path), archived_path=str(dest) if dest else None, status="needs_review",
            detected_vendor=classification.vendor_key, detected_company_id=classification.company_id,
            detected_site=classification.site_code, parsed_data=parsed_json, confidence=confidence,
            warnings=validation.warnings + validation.errors, error_message=None, utility_bill_id=None,
        )
        return PipelineResult("needs_review", "; ".join(validation.errors + validation.warnings) or "needs review", dest)

    def _attach_onedrive_link(self, bill_id: str, archived_path: Path) -> None:
        """Best-effort: never let a Graph API problem affect the bill that
        was already successfully registered and archived above."""
        if self.settings.dry_run or not self.graph.enabled:
            return
        try:
            link = self.graph.create_sharing_link(archived_path)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
            log.warning("unexpected error creating OneDrive link for %s: %s", archived_path, exc)
            return
        if link:
            self.repo.update_bill(bill_id, {"onedrive_file_url": link})

    def _archive_dir(self, classification) -> Path:
        company_upper = (classification.company_id or "UNKNOWN").upper()
        vendor_folder = classification.vendor_cfg.folder_name if classification.vendor_cfg else "Unknown"
        base = self.settings.archive_root / company_upper / vendor_folder
        if classification.vendor_cfg and classification.vendor_cfg.flat_archive:
            return base
        company_cfg = self.sites.get(classification.company_id) if classification.company_id else None
        if company_cfg and company_cfg.multi_site and classification.site_code:
            return base / classification.site_code.title()
        return base

    def _safe_move(self, src: Path, dest_dir: Path, filename: str) -> Path | None:
        dest_dir.mkdir(parents=True, exist_ok=True)
        final_name = resolve_collision(dest_dir, filename)
        dest = dest_dir / final_name
        if self.settings.dry_run:
            log.info("[DRY-RUN] would move %s -> %s", src, dest)
            return dest

        # Retry with backoff: on Windows, a file that just failed to parse
        # (e.g. a corrupt/non-PDF), was just written by a browser download,
        # or that OneDrive is still syncing can briefly hold an OS-level
        # lock (antivirus real-time scanning is a common culprit too).
        delays = (0.3, 0.6, 1.2, 2.0, 3.0)
        last_exc: OSError | None = None
        for attempt, delay in enumerate((*delays, None)):
            try:
                shutil.move(str(src), str(dest))
                return dest
            except OSError as exc:
                last_exc = exc
                if delay is not None:
                    time.sleep(delay)
        log.error(
            "failed to move %s to %s/%s: %s (original file left in place)",
            src, dest_dir, filename, last_exc,
        )
        return None

    def _move_duplicate(self, src: Path, original_filename: str) -> Path | None:
        dest_dir = self.settings.review_dir / "duplicates"
        return self._safe_move(src, dest_dir, safe_original_name(original_filename) + ".pdf")

    def _to_failed(self, path: Path, original_filename: str, file_hash: str | None, error: str) -> PipelineResult:
        log.error("failed: %s — %s", original_filename, error)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = self._safe_move(path, self.settings.failed_dir, f"{ts}_{safe_original_name(original_filename)}.pdf")
        self._write_import_record(
            original_filename=original_filename, normalized_filename=None,
            file_hash=file_hash or "unknown", source_path=str(path), archived_path=str(dest) if dest else None,
            status="failed", detected_vendor=None, detected_company_id=None, detected_site=None,
            parsed_data=None, confidence=None, warnings=[], error_message=error, utility_bill_id=None,
        )
        return PipelineResult("failed", error, dest)

    def _write_import_record(
        self, *, original_filename: str, normalized_filename: str | None, file_hash: str,
        source_path: str, archived_path: str | None, status: str, detected_vendor: str | None,
        detected_company_id: str | None, detected_site: str | None, parsed_data: str | None,
        confidence: float | None, warnings: list[str], error_message: str | None,
        utility_bill_id: str | None,
    ) -> None:
        payload = {
            "original_filename": original_filename,
            "normalized_filename": normalized_filename,
            "source_file_hash": file_hash,
            "source_path": source_path,
            "archived_path": archived_path,
            "status": status,
            "detected_vendor": detected_vendor,
            "detected_company_id": detected_company_id,
            "detected_site": detected_site,
            "parsed_data": json.loads(parsed_data) if parsed_data else None,
            "confidence": round(confidence, 3) if confidence is not None else None,
            "warnings": warnings or None,
            "error_message": error_message,
            "utility_bill_id": utility_bill_id,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        # source_file_hash is unique — on a retry (needs_review/failed file
        # dropped back into the inbox) a row for this hash already exists,
        # so update it in place instead of inserting a second one.
        existing = self.repo.find_import_by_hash(file_hash)
        if existing:
            self.repo.update_import_record(existing["id"], payload)
        else:
            self.repo.insert_import_record(payload)
