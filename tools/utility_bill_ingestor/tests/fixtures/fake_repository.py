"""In-memory stand-in for app.repository.Repository — no network calls.
Mirrors the real repository's dry-run behavior (reads always work, writes
are skipped and just recorded for assertions) so pipeline tests can run
against both modes.
"""
from __future__ import annotations

import uuid
from typing import Any


class FakeRepository:
    def __init__(self, *, dry_run: bool = False, vendors: dict | None = None, locations: dict | None = None):
        self.dry_run = dry_run
        self.has_client = True
        # vendors: {(company_id, name_lower): {"id": ..., "name": ..., ...}}
        self._vendors = vendors or {}
        self._locations = locations or {}
        self._bills_by_hash: dict[str, dict] = {}
        self.inserted_bills: list[dict] = []
        self.inserted_imports: list[dict] = []
        self.updated_bills: list[tuple[str, dict]] = []

    def resolve_vendor(self, company_id: str, db_name: str) -> dict[str, Any] | None:
        return self._vendors.get((company_id, db_name.lower()))

    def resolve_location(self, company_id: str, db_location_name: str) -> dict[str, Any] | None:
        return self._locations.get((company_id, db_location_name.lower()))

    def resolve_service_account(self, vendor_id: str, account_number: str) -> dict[str, Any] | None:
        return None

    def find_import_by_hash(self, file_hash: str) -> dict[str, Any] | None:
        return self._bills_by_hash.get(file_hash)

    def find_bill_by_bill_number(self, provider, account_number, bill_number):
        for bill in self.inserted_bills:
            if (
                (bill.get("provider") or "").lower() == (provider or "").lower()
                and bill.get("bill_number") == bill_number
                and (not account_number or bill.get("account_number") == account_number)
            ):
                return bill
        return None

    def find_bill_by_period(self, provider, account_number, billing_year, billing_month):
        for bill in self.inserted_bills:
            if (
                (bill.get("provider") or "").lower() == (provider or "").lower()
                and bill.get("billing_year") == billing_year
                and bill.get("billing_month") == billing_month
                and (not account_number or bill.get("account_number") == account_number)
            ):
                return bill
        return None

    def insert_bill(self, payload: dict[str, Any]) -> str | None:
        if self.dry_run:
            return None
        bill_id = str(uuid.uuid4())
        self.inserted_bills.append({**payload, "id": bill_id})
        return bill_id

    def update_bill(self, bill_id: str, payload: dict[str, Any]) -> None:
        if self.dry_run:
            return
        self.updated_bills.append((bill_id, payload))

    def insert_import_record(self, payload: dict[str, Any]) -> str | None:
        if self.dry_run:
            return None
        import_id = str(uuid.uuid4())
        record = {**payload, "id": import_id}
        self.inserted_imports.append(record)
        if payload.get("source_file_hash"):
            self._bills_by_hash[payload["source_file_hash"]] = record
        return import_id

    def update_import_record(self, import_id: str, payload: dict[str, Any]) -> None:
        pass
