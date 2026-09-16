"""Register TNT Cambridge's Waste Connections account and ingest its PDFs.

This is intentionally idempotent: rerunning it updates the vendor metadata,
reuses the existing service account, and the pipeline's bill/hash checks keep
already-imported invoices from being duplicated.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

from app.config import load_settings, require_supabase
from app.pipeline import Pipeline
from app.repository import Repository
from app.watcher import move_to_processing


VENDOR_NAME = "Waste Connections"
ACCOUNT_NUMBER = "7121-072918-0000"


def register_vendor(repo: Repository) -> tuple[str, str]:
    location = repo.client.table("utility_locations").select("id").eq("company_id", "tnt").ilike("name", "Cambridge").limit(1).execute().data
    if not location:
        raise RuntimeError("TNT Cambridge location was not found")
    location_id = location[0]["id"]

    rows = repo.client.table("utility_vendors").select("id").eq("company_id", "tnt").ilike("name", VENDOR_NAME).limit(1).execute().data
    vendor_payload = {
        "company_id": "tnt",
        "name": VENDOR_NAME,
        "service_type": "Waste Disposal",
        "location_id": location_id,
        "contact_name": "Customer Service",
        "contact_phone": "(519) 745-8080",
        "billing_portal_url": "https://billpay.wasteconnectionscanada.com",
        "notes": "Waste Connections of Canada Inc. - TNT Cambridge, 255 Holiday Inn Dr, Cambridge ON. Account 7121-072918-0000.",
    }
    if rows:
        vendor_id = rows[0]["id"]
        repo.client.table("utility_vendors").update(vendor_payload).eq("id", vendor_id).execute()
    else:
        vendor_id = repo.client.table("utility_vendors").insert(vendor_payload).execute().data[0]["id"]

    accounts = repo.client.table("utility_service_accounts").select("id").eq("vendor_id", vendor_id).eq("account_number", ACCOUNT_NUMBER).limit(1).execute().data
    account_payload = {
        "vendor_id": vendor_id,
        "location_id": location_id,
        "account_number": ACCOUNT_NUMBER,
        "service_label": "Commercial waste and recycling",
        "is_active": True,
        "is_auto_pay": False,
        "notes": "Invoice terms: due upon receipt. Source account address: 255 Holiday Inn Dr, Cambridge ON.",
    }
    if accounts:
        repo.client.table("utility_service_accounts").update(account_payload).eq("id", accounts[0]["id"]).execute()
        account_id = accounts[0]["id"]
    else:
        account_id = repo.client.table("utility_service_accounts").insert(account_payload).execute().data[0]["id"]
    return vendor_id, account_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path, help="Folder containing Waste Connections PDFs")
    parser.add_argument("--skip-graph", action="store_true", help="Do not attempt OneDrive sharing links")
    args = parser.parse_args()
    settings = load_settings()
    require_supabase(settings)
    if args.skip_graph:
        settings = replace(
            settings,
            graph_tenant_id="",
            graph_client_id="",
            graph_client_secret="",
            graph_drive_id="",
            graph_drive_root_local=None,
        )
    repo = Repository(settings)
    register_vendor(repo)
    pipeline = Pipeline(settings, repo)

    files = sorted(args.folder.glob("*.pdf"))
    if not files:
        raise SystemExit(f"No PDF files found in {args.folder}")
    results = []
    for source in files:
        staged = move_to_processing(settings, source)
        if staged is None:
            results.append((source.name, "failed to stage"))
            continue
        result = pipeline.process_file(staged, original_filename=source.name)
        results.append((source.name, result.status, str(result.destination or "")))
    for row in results:
        print(" | ".join(row))
    return 0 if all(row[1] in ("completed", "duplicate") for row in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
