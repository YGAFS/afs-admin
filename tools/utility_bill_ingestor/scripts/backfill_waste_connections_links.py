"""Backfill the Vendor account link on already-imported Waste Connections bills."""
from __future__ import annotations

from app.config import load_settings, require_supabase
from app.repository import Repository


def main() -> int:
    settings = load_settings()
    require_supabase(settings)
    repo = Repository(settings)
    vendor = repo.client.table("utility_vendors").select("id").eq("company_id", "tnt").ilike("name", "Waste Connections").limit(1).execute().data[0]
    account = repo.client.table("utility_service_accounts").select("id").eq("vendor_id", vendor["id"]).eq("account_number", "7121-072918-0000").limit(1).execute().data[0]
    bills = repo.client.table("utility_bills").select("id").eq("provider", "Waste Connections").eq("company_id", "tnt").eq("account_number", "7121-072918-0000").execute().data
    for bill in bills:
        repo.client.table("utility_bills").update({"service_account_id": account["id"]}).eq("id", bill["id"]).execute()
    print(f"backfilled {len(bills)} Waste Connections bills -> {account['id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
