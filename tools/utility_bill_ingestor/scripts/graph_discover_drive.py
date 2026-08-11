"""One-off admin helper for setting up OneDrive file links.

Once GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET are filled in
.env (see README.md "OneDrive file links"), run this from the
tools/utility_bill_ingestor/ directory to find the right GRAPH_DRIVE_ID and
GRAPH_DRIVE_ROOT_LOCAL values — the two remaining settings needed before the
ingestor will start attaching OneDrive links to bills.

    python -m scripts.graph_discover_drive
    python -m scripts.graph_discover_drive --search AFS
    python -m scripts.graph_discover_drive --user someone@afstrans.co

Read-only — this only lists sites/drives, it never writes anything.
"""
from __future__ import annotations

import argparse
import sys

import requests

from app.config import load_settings
from app.graph_client import GRAPH_BASE, GraphClient


def _get(token: str, url: str, **params: str) -> dict:
    resp = requests.get(
        url, headers={"Authorization": f"Bearer {token}"}, params=params or None, timeout=20
    )
    resp.raise_for_status()
    return resp.json()


def _print_drive(drive: dict, indent: str = "") -> None:
    print(f"{indent}Drive: {drive.get('name')}  id={drive.get('id')}")
    print(f"{indent}  driveType={drive.get('driveType')}  webUrl={drive.get('webUrl')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--search", default="",
        help="Search term for SharePoint site display names (default: just the root site)",
    )
    parser.add_argument(
        "--user", default="",
        help="A UPN/email to also check for a personal OneDrive drive, e.g. someone@afstrans.co",
    )
    parser.add_argument(
        "--site-path", default="",
        help=(
            "Site-relative path from a 'View online' URL, e.g. 'afstrans.co' for "
            "https://afstransco.sharepoint.com/sites/afstrans.co/... — resolves that exact "
            "site directly, bypassing /sites?search which can 403 with app-only tokens."
        ),
    )
    parser.add_argument("--host", default="afstransco.sharepoint.com", help="SharePoint hostname")
    args = parser.parse_args(argv)

    settings = load_settings()
    if not (settings.graph_tenant_id and settings.graph_client_id and settings.graph_client_secret):
        print(
            "GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET are not all set in .env yet.",
            file=sys.stderr,
        )
        return 2

    client = GraphClient(settings)
    token = client.get_token()
    if token is None:
        print(
            "Could not get a Graph access token — double check the 3 values above, and that "
            "'Grant admin consent' was clicked for the Files.Read.All / Sites.Read.All "
            "permissions in Azure Portal → App registrations → API permissions.",
            file=sys.stderr,
        )
        return 2

    print("Authenticated OK.\n")

    if args.user:
        print(f"— Personal OneDrive for {args.user} —")
        try:
            drive = _get(token, f"{GRAPH_BASE}/users/{args.user}/drive")
            _print_drive(drive)
        except requests.RequestException as exc:
            print(f"  (could not fetch: {exc})")
        print()

    if args.site_path:
        print(f"— Site at {args.host}:/sites/{args.site_path} —")
        try:
            sites = [_get(token, f"{GRAPH_BASE}/sites/{args.host}:/sites/{args.site_path}")]
        except requests.RequestException as exc:
            print(f"  (could not fetch: {exc})")
            sites = []
    else:
        print("— SharePoint sites —" + (f" matching '{args.search}'" if args.search else " (root site only)"))
        try:
            if args.search:
                sites = _get(token, f"{GRAPH_BASE}/sites", search=args.search).get("value", [])
            else:
                sites = [_get(token, f"{GRAPH_BASE}/sites/root")]
        except requests.RequestException as exc:
            print(f"  (could not fetch: {exc})")
            sites = []

    for site in sites:
        print(f"\nSite: {site.get('displayName')}  ({site.get('webUrl')})")
        try:
            drives = _get(token, f"{GRAPH_BASE}/sites/{site['id']}/drives").get("value", [])
        except requests.RequestException as exc:
            print(f"  (could not list drives: {exc})")
            continue
        for drive in drives:
            _print_drive(drive, indent="  ")

    print(
        "\nNothing above? Try again with --search <part of your SharePoint site name>, "
        "--site-path <the part after /sites/ in a folder's 'View online' URL>, or "
        "--user <the email whose personal OneDrive holds the bills>.\n"
        "\n"
        "Once you've identified the right drive:\n"
        "  1. GRAPH_DRIVE_ID = its id, shown above.\n"
        "  2. GRAPH_DRIVE_ROOT_LOCAL = a local folder you're confident maps to somewhere\n"
        "     inside this drive (UTILITY_BILL_ARCHIVE_ROOT itself is a safe choice).\n"
        "  3. GRAPH_DRIVE_ROOT_REMOTE_PREFIX = that same folder's path *inside the drive*.\n"
        "     Don't assume it matches the local folder name — OneDrive sync often renames\n"
        "     shortcut folders (e.g. local 'afstrans.co - AFS_2023' for a folder actually\n"
        "     named 'AFS_2023' on the drive). To get the real remote path for sure: right-\n"
        "     click that local folder → 'View online', and read the folder path out of the\n"
        "     browser URL that opens (the 'id=' query param, URL-decoded, after the library\n"
        "     name — e.g. '.../Shared Documents/AFS_2023/Admin/...' means the prefix for a\n"
        "     local folder at '...\\AFS_2023\\Admin\\...' is 'AFS_2023/Admin').\n"
        "  4. Fill all 3 into .env, then verify with a REAL already-archived file before\n"
        "     trusting it against new bills:\n"
        "       python -c \"from pathlib import Path; from app.config import load_settings; "
        "from app.graph_client import GraphClient; s = load_settings(); "
        "print(GraphClient(s).create_sharing_link(Path(r'C:\\path\\to\\a\\real\\archived\\bill.pdf')))\"\n"
        "     A 404 (itemNotFound) almost always means the remote prefix is wrong, not the\n"
        "     drive id — recheck step 3."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
