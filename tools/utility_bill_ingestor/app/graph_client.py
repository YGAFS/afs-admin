"""Microsoft Graph client for turning an archived bill's local file path
into an "organization"-scoped OneDrive/SharePoint sharing link.

Uses the client-credentials (app-only) OAuth flow — no user ever signs in.
Requires an Azure AD app registration with the Files.Read.All (and usually
Sites.Read.All) Graph *application* permissions, admin-consented. See
README.md's "OneDrive file links" section for the full setup.

Every public method here is best-effort: on any failure (missing config,
network error, non-2xx response, path outside the configured drive root) it
logs a warning and returns None rather than raising. A OneDrive link is a
nice-to-have on a bill row — it must never be the reason a bill fails to
register.
"""
from __future__ import annotations

import threading
import time
import urllib.parse
from pathlib import Path

import requests

from app.config import Settings
from app.logging_config import get_logger

log = get_logger()

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TOKEN_URL_TMPL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
REQUEST_TIMEOUT_SECONDS = 20
# Refresh a bit before actual expiry so a token never goes stale mid-call.
TOKEN_REFRESH_MARGIN_SECONDS = 60


class GraphClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.settings.graph_enabled

    # ── Auth ──────────────────────────────────────────────────────────

    def get_token(self) -> str | None:
        """Public so one-off admin scripts (see scripts/graph_discover_drive.py)
        can authenticate the same way without duplicating the token-fetch
        logic — useful before GRAPH_DRIVE_ID/GRAPH_DRIVE_ROOT_LOCAL are even
        known, since only tenant/client/secret are needed to get a token."""
        with self._lock:
            if self._token and time.monotonic() < self._token_expires_at:
                return self._token

            url = TOKEN_URL_TMPL.format(tenant=self.settings.graph_tenant_id)
            data = {
                "grant_type": "client_credentials",
                "client_id": self.settings.graph_client_id,
                "client_secret": self.settings.graph_client_secret,
                "scope": "https://graph.microsoft.com/.default",
            }
            try:
                resp = requests.post(url, data=data, timeout=REQUEST_TIMEOUT_SECONDS)
                resp.raise_for_status()
            except requests.RequestException as exc:
                log.warning("Graph token request failed: %s", exc)
                return None

            body = resp.json()
            token = body.get("access_token")
            expires_in = body.get("expires_in", 3600)
            if not token:
                log.warning("Graph token response had no access_token: %s", body)
                return None

            self._token = token
            self._token_expires_at = time.monotonic() + max(expires_in - TOKEN_REFRESH_MARGIN_SECONDS, 60)
            return token

    # ── Sharing links ─────────────────────────────────────────────────

    def _relative_drive_path(self, local_path: Path) -> str | None:
        """GRAPH_DRIVE_ROOT_LOCAL is the local folder that corresponds to
        wherever GRAPH_DRIVE_ROOT_REMOTE_PREFIX points inside the drive —
        not necessarily the drive's own root. This matters because a
        OneDrive "shortcut" to a SharePoint folder is often synced under a
        locally-renamed folder name (e.g. local `afstrans.co - AFS_2023`
        for a remote folder actually named `AFS_2023`), so a plain
        local-root == drive-root assumption silently 404s on every path."""
        root = self.settings.graph_drive_root_local
        if root is None:
            return None
        try:
            rel = local_path.resolve().relative_to(root.resolve())
        except ValueError:
            log.warning(
                "path %s is not under GRAPH_DRIVE_ROOT_LOCAL (%s) — skipping OneDrive link",
                local_path, root,
            )
            return None
        rel_str = rel.as_posix()
        prefix = self.settings.graph_drive_root_remote_prefix
        return f"{prefix}/{rel_str}" if prefix else rel_str

    def create_sharing_link(self, local_path: Path) -> str | None:
        """Create (or reuse, per Graph's own dedup behavior) an
        organization-scoped view link for the given archived file. Returns
        the webUrl, or None if anything about this isn't set up / fails."""
        if not self.enabled:
            return None

        rel_path = self._relative_drive_path(local_path)
        if rel_path is None:
            return None

        token = self.get_token()
        if token is None:
            return None

        quoted = urllib.parse.quote(rel_path, safe="/")
        url = f"{GRAPH_BASE}/drives/{self.settings.graph_drive_id}/root:/{quoted}:/createLink"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        payload = {"type": "view", "scope": "organization"}

        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
            resp.raise_for_status()
        except requests.RequestException as exc:
            detail = getattr(exc.response, "text", "") if getattr(exc, "response", None) is not None else ""
            log.warning("Graph createLink failed for %s: %s %s", local_path, exc, detail)
            return None

        try:
            link_url = resp.json()["link"]["webUrl"]
        except (KeyError, ValueError) as exc:
            log.warning("Graph createLink response missing link.webUrl for %s: %s", local_path, exc)
            return None

        return link_url
