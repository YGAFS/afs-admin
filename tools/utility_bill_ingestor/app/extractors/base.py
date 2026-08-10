"""Common data model + interface every vendor extractor implements."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Protocol


@dataclass
class ParsedBill:
    """Extractor output — vendor-agnostic. Repository layer maps this onto
    the real utility_bills columns; nothing here is a Supabase column name
    directly except where they happen to coincide."""

    vendor_name: str | None = None          # raw text as found in the PDF
    account_number: str | None = None
    bill_number: str | None = None
    issue_date: date | None = None
    due_date: date | None = None
    billing_period_start: date | None = None
    billing_period_end: date | None = None
    billing_month: int | None = None
    billing_year: int | None = None
    previous_balance: Decimal | None = None
    current_charges: Decimal | None = None
    payments_received: Decimal | None = None
    tax_amount: Decimal | None = None
    late_fee: Decimal | None = None
    adjustments: Decimal | None = None
    total_due: Decimal | None = None
    currency: str = "CAD"
    # True for vendors whose bill always shows a $0 "total amount due" because the
    # charge is collected via autopay before/at statement time (e.g. Orkin) — the
    # charge itself still gets registered, just pre-marked paid instead of open.
    already_paid: bool = False
    confidence: float = 0.0
    warnings: list[str] = field(default_factory=list)
    raw_fields: dict = field(default_factory=dict)


class BillExtractor(Protocol):
    vendor_key: str

    def can_handle(self, text: str) -> float:
        """Return a 0.0-1.0 confidence that this extractor can parse `text`."""
        ...

    def extract(self, text: str) -> ParsedBill:
        """Parse `text` into a ParsedBill. May raise on unrecoverable
        extraction errors — the pipeline treats that as needs_review, not a
        hard failure, since the PDF itself was readable."""
        ...
