"""Validation rules -> a conservative completed / needs_review / failed /
duplicate decision. Pure function of (ParsedBill, ClassificationResult,
DuplicateInfo) — no DB access here (that lives in repository.py); callers
compute DuplicateInfo first via the repository and pass it in.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from app.classifier import ClassificationResult
from app.extractors.base import ParsedBill

MAX_REASONABLE_AMOUNT = Decimal(50000)
MAX_DUE_DATE_SPREAD_DAYS = 120


@dataclass
class DuplicateInfo:
    exact_file_hash_match: bool = False
    existing_import_id: str | None = None
    matched_bill_id: str | None = None
    matched_by: str | None = None  # 'bill_number' | 'billing_period'
    amount_differs: bool = False
    date_differs: bool = False


@dataclass
class ValidationResult:
    status: str  # 'completed' | 'needs_review' | 'duplicate'
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate(
    parsed: ParsedBill,
    classification: ClassificationResult,
    duplicate: DuplicateInfo,
    *,
    is_generic: bool,
    amount_tolerance: Decimal,
) -> ValidationResult:
    errors: list[str] = []
    warnings: list[str] = list(parsed.warnings) + list(classification.warnings)

    if duplicate.exact_file_hash_match:
        return ValidationResult(status="duplicate", errors=errors, warnings=warnings)

    # ── Required fields ──────────────────────────────────────────────────
    if not classification.vendor_key or not classification.company_id:
        errors.append("vendor/company could not be determined")
    if not parsed.issue_date:
        errors.append("issue_date is missing")
    total = parsed.total_due if parsed.total_due is not None else parsed.current_charges
    if total is None:
        errors.append("total amount is missing")

    # ── Sanity checks ────────────────────────────────────────────────────
    if total is not None:
        if total < 0:
            warnings.append(f"total_due is negative ({total}) — verify this is a real credit")
        if abs(total) > MAX_REASONABLE_AMOUNT:
            warnings.append(f"total_due looks unusually large ({total})")

    if parsed.billing_period_start and parsed.billing_period_end:
        if parsed.billing_period_start > parsed.billing_period_end:
            errors.append("billing_period_start is after billing_period_end")

    if parsed.issue_date and parsed.due_date:
        spread = (parsed.due_date - parsed.issue_date).days
        if spread < -5:
            warnings.append(f"due_date ({parsed.due_date}) is before issue_date ({parsed.issue_date})")
        elif spread > MAX_DUE_DATE_SPREAD_DAYS:
            warnings.append(f"due_date is {spread} days after issue_date — looks unusual")

    # ── Balance sum check ────────────────────────────────────────────────
    if parsed.total_due is not None:
        components = [
            parsed.previous_balance or Decimal(0),
            parsed.current_charges or Decimal(0),
            parsed.tax_amount or Decimal(0),
            parsed.late_fee or Decimal(0),
            parsed.adjustments or Decimal(0),
            -(parsed.payments_received or Decimal(0)),
        ]
        computed = sum(components, Decimal(0))
        if abs(computed - parsed.total_due) > amount_tolerance:
            warnings.append(
                f"balance components sum to {computed} but total_due is {parsed.total_due} "
                f"(tolerance {amount_tolerance})"
            )

    # ── Duplicate-with-changes: never silently overwrite ────────────────
    if duplicate.matched_bill_id and (duplicate.amount_differs or duplicate.date_differs):
        warnings.append(
            f"an existing bill (id={duplicate.matched_bill_id}, matched by "
            f"{duplicate.matched_by}) already exists with different amount/date — "
            "not auto-updating, needs manual review"
        )

    if errors:
        return ValidationResult(status="needs_review", errors=errors, warnings=warnings)

    # Conservative policy: generic-extractor output or ANY warning routes to
    # needs_review. Only a clean, known-vendor, fully-resolved parse with
    # zero warnings auto-completes.
    if is_generic:
        warnings.append("generic extractor result — never auto-registered")
        return ValidationResult(status="needs_review", errors=errors, warnings=warnings)

    if warnings:
        return ValidationResult(status="needs_review", errors=errors, warnings=warnings)

    return ValidationResult(status="completed", errors=errors, warnings=warnings)
