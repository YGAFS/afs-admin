"""Backfill stable SharePoint document URLs when Graph sharing-link creation is unavailable.

The URLs point to the existing document-library files and rely on the user's
normal Microsoft 365 sign-in. They do not change file permissions.
"""
from __future__ import annotations

import argparse
import urllib.parse
from pathlib import Path

from app.config import load_settings, require_supabase
from app.repository import Repository


SHAREPOINT_LIBRARY_ROOT = "https://afstransco.sharepoint.com/sites/afstrans.co/Shared Documents"


def direct_url(path: Path, settings) -> str:
    root = settings.graph_drive_root_local
    if root is None:
        raise RuntimeError("GRAPH_DRIVE_ROOT_LOCAL is required to map local files")
    relative = path.resolve().relative_to(root.resolve()).as_posix()
    remote = f"{settings.graph_drive_root_remote_prefix}/{relative}" if settings.graph_drive_root_remote_prefix else relative
    return f"{SHAREPOINT_LIBRARY_ROOT}/{urllib.parse.quote(remote, safe='/')}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    settings = load_settings(dry_run_override=args.dry_run)
    require_supabase(settings)
    repo = Repository(settings)

    bills = repo.client.table("utility_bills").select("id,bill_number,onedrive_file_url").eq("provider", "Waste Connections").eq("company_id", "tnt").execute().data or []
    imports = repo.client.table("utility_bill_imports").select("utility_bill_id,archived_path").eq("status", "completed").execute().data or []
    paths = {row.get("utility_bill_id"): row.get("archived_path") for row in imports if row.get("archived_path")}

    updated = 0
    for bill in bills:
        if bill.get("onedrive_file_url"):
            continue
        archived = paths.get(bill["id"])
        if not archived:
            print(f"SKIP {bill.get('bill_number')}: no archived path")
            continue
        path = Path(archived)
        if not path.exists():
            print(f"SKIP {bill.get('bill_number')}: file not found at {path}")
            continue
        url = direct_url(path, settings)
        print(f"{'WOULD ' if args.dry_run else ''}UPDATE {bill.get('bill_number')} -> {url}")
        if not args.dry_run:
            repo.client.table("utility_bills").update({"onedrive_file_url": url}).eq("id", bill["id"]).execute()
        updated += 1
    print(f"updated={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
