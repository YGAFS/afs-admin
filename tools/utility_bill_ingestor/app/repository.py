"""All Supabase reads/writes live here — nothing else in the app talks to
Supabase directly. Uses the service_role key (server-side only, bypasses
RLS) since this worker runs unattended with no user session.

In dry-run mode, reads still hit the DB (needed for accurate classification
and duplicate detection) but writes are logged and skipped.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from supabase import Client, create_client

from app.config import Settings
from app.logging_config import get_logger

log = get_logger()


def _d(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _first_row(data: Any) -> dict[str, Any] | None:
    """supabase-py types `.execute().data` as a loose JSON union; every row
    we ever get back from this project's tables is actually a dict — this
    just gives that fact a proper type instead of `Any` leaking everywhere."""
    if not data:
        return None
    row = data[0]
    return row if isinstance(row, dict) else None


def _first_id(data: Any) -> str | None:
    row = _first_row(data)
    return row.get("id") if row else None


class Repository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.dry_run = settings.dry_run
        self._client: Client | None = None
        if settings.supabase_url and settings.supabase_service_role_key:
            self._client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        elif not self.dry_run:
            raise RuntimeError("Supabase credentials missing and not in dry-run mode")

    @property
    def client(self) -> Client:
        if self._client is None:
            raise RuntimeError(
                "No Supabase client configured (dry-run with no credentials) — "
                "reads are unavailable in this mode."
            )
        return self._client

    @property
    def has_client(self) -> bool:
        return self._client is not None

    # ── Reads (always live, even in dry-run) ────────────────────────────

    def resolve_vendor(self, company_id: str, db_name: str) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        res = (
            self.client.table("utility_vendors")
            .select("id, name, company_id, service_type, location_id")
            .eq("company_id", company_id)
            .ilike("name", db_name)
            .limit(1)
            .execute()
        )
        return _first_row(res.data)

    def resolve_location(self, company_id: str, db_location_name: str) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        res = (
            self.client.table("utility_locations")
            .select("id, name, company_id")
            .eq("company_id", company_id)
            .ilike("name", db_location_name)
            .limit(1)
            .execute()
        )
        return _first_row(res.data)

    def resolve_service_account(self, vendor_id: str, account_number: str) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        res = (
            self.client.table("utility_service_accounts")
            .select("id, vendor_id, location_id, account_number, is_auto_pay")
            .eq("vendor_id", vendor_id)
            .eq("account_number", account_number)
            .limit(1)
            .execute()
        )
        return _first_row(res.data)

    def get_bill(self, bill_id: str) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        res = (
            self.client.table("utility_bills")
            .select("id, onedrive_file_url")
            .eq("id", bill_id)
            .limit(1)
            .execute()
        )
        return _first_row(res.data)

    def list_completed_imports_with_archive(self) -> list[dict[str, Any]]:
        """Import records that produced a bill and have an archived_path on
        disk — the backfill candidates for scripts/backfill_onedrive_links.py."""
        if not self.has_client:
            return []
        res = (
            self.client.table("utility_bill_imports")
            .select("id, utility_bill_id, archived_path")
            .eq("status", "completed")
            .not_.is_("utility_bill_id", "null")
            .not_.is_("archived_path", "null")
            .execute()
        )
        return res.data or []

    def find_import_by_hash(self, file_hash: str) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        res = (
            self.client.table("utility_bill_imports")
            .select("*")
            .eq("source_file_hash", file_hash)
            .limit(1)
            .execute()
        )
        return _first_row(res.data)

    def find_bill_by_bill_number(
        self, provider: str, account_number: str | None, bill_number: str
    ) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        q = (
            self.client.table("utility_bills")
            .select("*")
            .ilike("provider", provider)
            .eq("bill_number", bill_number)
        )
        if account_number:
            q = q.eq("account_number", account_number)
        res = q.limit(1).execute()
        return _first_row(res.data)

    def find_bill_by_period(
        self, provider: str, account_number: str | None, billing_year: int, billing_month: int
    ) -> dict[str, Any] | None:
        if not self.has_client:
            return None
        q = (
            self.client.table("utility_bills")
            .select("*")
            .ilike("provider", provider)
            .eq("billing_year", billing_year)
            .eq("billing_month", billing_month)
        )
        if account_number:
            q = q.eq("account_number", account_number)
        res = q.limit(1).execute()
        return _first_row(res.data)

    # ── Writes ────────────────────────────────────────────────────────

    def insert_bill(self, payload: dict[str, Any]) -> str | None:
        if self.dry_run:
            log.info("[DRY-RUN] would insert utility_bills: %s", payload)
            return None
        res = self.client.table("utility_bills").insert(payload).execute()
        return _first_id(res.data)

    def update_bill(self, bill_id: str, payload: dict[str, Any]) -> None:
        if self.dry_run:
            log.info("[DRY-RUN] would update utility_bills id=%s: %s", bill_id, payload)
            return
        self.client.table("utility_bills").update(payload).eq("id", bill_id).execute()

    def insert_import_record(self, payload: dict[str, Any]) -> str | None:
        if self.dry_run:
            log.info("[DRY-RUN] would insert utility_bill_imports: %s", payload)
            return None
        res = self.client.table("utility_bill_imports").insert(payload).execute()
        return _first_id(res.data)

    def update_import_record(self, import_id: str, payload: dict[str, Any]) -> None:
        if self.dry_run:
            log.info("[DRY-RUN] would update utility_bill_imports id=%s: %s", import_id, payload)
            return
        self.client.table("utility_bill_imports").update(payload).eq("id", import_id).execute()


def bill_payload_from_parsed(
    *,
    company_id: str,
    utility_name: str,
    provider: str,
    parsed,  # ParsedBill
    location_id: str | None,
    service_account_id: str | None,
    auto_pay: bool = False,
) -> dict[str, Any]:
    """Map a ParsedBill onto real utility_bills columns. `amount` and
    `total_due` both get the same computed total (legacy + new balance
    system, mirroring app/utility/page.tsx's own saveBill())."""
    previous = parsed.previous_balance or Decimal(0)
    current = parsed.current_charges
    payments = parsed.payments_received or Decimal(0)
    computed_total = parsed.total_due
    if computed_total is None and current is not None:
        computed_total = previous + current

    # A payment shown on the bill clears the *previous* balance first, not this
    # period's current_charges — waterfall it: reduce previous_balance by the
    # payment (down to zero), and only the leftover excess (if any) counts as
    # amount_paid toward the current total. Registering the raw previous_balance
    # here when it's already been paid off would otherwise resurrect a stale,
    # already-settled debt in the app's own account-balance ledger (see
    # app/utility/page.tsx's computeAccountBalanceDetail, which reads
    # previous_balance/amount_paid straight off this row).
    effective_previous = previous - payments
    if effective_previous < 0:
        effective_previous = Decimal(0)
    excess_payment = payments - previous
    if excess_payment < 0:
        excess_payment = Decimal(0)

    already_paid = getattr(parsed, "already_paid", False)
    # Auto-pay is the account's payment policy. For this system it also means
    # the newly imported bill is considered settled, so it must not enter the
    # dashboard as overdue and require a manual Paid action.
    settled = already_paid or auto_pay
    amount_paid = computed_total if settled else excess_payment

    return {
        "company_id": company_id,
        "utility_name": utility_name,
        "provider": provider,
        "previous_balance": _d(effective_previous),
        "current_charges": _d(parsed.current_charges),
        "amount": _d(computed_total),
        "total_due": _d(computed_total),
        "tax": _d(parsed.tax_amount) or 0,
        "late_fee": _d(parsed.late_fee) or 0,
        "adjustments": _d(parsed.adjustments) or 0,
        "amount_paid": _d(amount_paid) or 0,
        "remaining_balance": 0 if settled else _d(max((computed_total or Decimal(0)) - amount_paid, Decimal(0))),
        "currency": parsed.currency,
        "issue_date": _iso(parsed.issue_date),
        "due_date": _iso(parsed.due_date),
        "billing_month": parsed.billing_month,
        "billing_year": parsed.billing_year,
        "bill_number": parsed.bill_number,
        "account_number": parsed.account_number,
        "location_id": location_id,
        "service_account_id": service_account_id,
        "is_auto_pay": already_paid or auto_pay,
        "is_paid": settled,
        "balance_status": "paid" if settled else "open",
        "invoice_status": "active",
        "needs_amount_review": bool(parsed.warnings),
        "notes": "Imported via utility-bill-ingestor" + (" — auto-paid" if settled else ""),
    }
