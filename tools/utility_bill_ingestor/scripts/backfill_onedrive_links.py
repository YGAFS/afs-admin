"""Backfill onedrive_file_url on existing utility_bills rows using Microsoft
Graph — for bills the ingestor registered before GRAPH_* was configured.

Requires GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/DRIVE_ID/DRIVE_ROOT_LOCAL to
already be set and verified in .env (see scripts/graph_discover_drive.py).
Safe to re-run — it only touches bills whose onedrive_file_url is still
empty, and skips any archived_path it can't turn into a link.

    python -m scripts.backfill_onedrive_links            # do it for real
    python -m scripts.backfill_onedrive_links --dry-run   # preview only

Note --dry-run only controls the Supabase write — it still calls Graph's
createLink for real (that call is itself idempotent/harmless: Graph reuses
an existing org-scoped link for the same file rather than creating a
duplicate), so a dry-run still tells you definitively whether each file
would link successfully.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.config import load_settings
from app.graph_client import GraphClient
from app.repository import Repository


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Print what would change, write nothing to Supabase")
    args = parser.parse_args(argv)

    settings = load_settings()
    if not settings.graph_enabled:
        print(
            "GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_DRIVE_ID / "
            "GRAPH_DRIVE_ROOT_LOCAL must all be set in .env first — see "
            "scripts/graph_discover_drive.py.",
            file=sys.stderr,
        )
        return 2

    repo = Repository(settings)
    graph = GraphClient(settings)

    imports = repo.list_completed_imports_with_archive()
    print(f"{len(imports)} completed import record(s) with an archived path.\n")

    updated = 0
    skipped_has_link = 0
    skipped_no_bill = 0
    skipped_missing_file = 0
    skipped_link_failed = 0

    for imp in imports:
        bill_id = imp["utility_bill_id"]
        archived_path = imp["archived_path"]

        bill = repo.get_bill(bill_id)
        if bill is None:
            print(f"  [skip] {archived_path} — no matching utility_bills row for id={bill_id}")
            skipped_no_bill += 1
            continue
        if bill.get("onedrive_file_url"):
            skipped_has_link += 1
            continue

        path = Path(archived_path)
        if not path.exists():
            print(f"  [skip] {archived_path} — file no longer at that path (moved/renamed since archiving?)")
            skipped_missing_file += 1
            continue

        link = graph.create_sharing_link(path)
        if not link:
            print(f"  [skip] {archived_path} — Graph couldn't create a link (see warning above)")
            skipped_link_failed += 1
            continue

        tag = "DRY-RUN " if args.dry_run else ""
        print(f"  [{tag}link] {archived_path}\n           -> {link}")
        if not args.dry_run:
            repo.update_bill(bill_id, {"onedrive_file_url": link})
        updated += 1

    print(
        f"\nDone. {updated} {'would be ' if args.dry_run else ''}updated, "
        f"{skipped_has_link} already had a link, {skipped_no_bill} had no matching bill row, "
        f"{skipped_missing_file} files missing on disk, {skipped_link_failed} link creation failed."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
