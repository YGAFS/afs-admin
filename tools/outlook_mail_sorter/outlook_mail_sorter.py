from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import requests


GRAPH_BASE = "https://graph.microsoft.com/v1.0"
CONFIG_PATH = Path(__file__).with_name("config.json")
TOKEN_CACHE_PATH = Path(__file__).with_name(".token_cache.json")


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(errors="replace")


class GraphError(RuntimeError):
    pass


def progress(message: str) -> None:
    print(message, flush=True)


@dataclass(frozen=True)
class MessageInfo:
    id: str
    subject: str
    sender_name: str
    sender_email: str
    to_emails: list[str]
    cc_emails: list[str]
    body_preview: str
    categories: list[str]
    body_content: str = ""

    @property
    def all_emails(self) -> list[str]:
        seen: set[str] = set()
        emails: list[str] = []
        for email in [self.sender_email, *self.to_emails, *self.cc_emails]:
            normalized = normalize(email)
            if normalized and normalized not in seen:
                seen.add(normalized)
                emails.append(normalized)
        return emails

    @property
    def all_domains(self) -> list[str]:
        domains: list[str] = []
        for email in self.all_emails:
            if "@" in email:
                domains.append(email.rsplit("@", 1)[1].lower())
        return domains

    @property
    def recipient_domains(self) -> list[str]:
        domains: list[str] = []
        for email in [*self.to_emails, *self.cc_emails]:
            normalized = normalize(email)
            if "@" in normalized:
                domains.append(normalized.rsplit("@", 1)[1].lower())
        return domains


def load_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as file:
        return json.load(file)


def normalize(value: str | None) -> str:
    return (value or "").strip().lower()


def get_user_base(config: dict[str, Any]) -> str:
    shared_mailbox = config["azure"].get("shared_mailbox")
    if shared_mailbox:
        return f"{GRAPH_BASE}/users/{shared_mailbox}"
    return f"{GRAPH_BASE}/me"


def read_token_cache(token_cache_path: Path) -> dict[str, Any]:
    if not token_cache_path.exists():
        return {}
    try:
        with token_cache_path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except json.JSONDecodeError:
        return {}


def write_token_cache(token_cache_path: Path, cache: dict[str, Any]) -> None:
    with token_cache_path.open("w", encoding="utf-8") as file:
        json.dump(cache, file, indent=2)


def token_endpoint(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"


def raise_for_oauth_error(response: requests.Response, action: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": response.text}
    if response.status_code >= 400:
        raise GraphError(f"{action} failed: {response.status_code} {payload}")
    return payload


def refresh_access_token(client_id: str, tenant_id: str, scopes: list[str], refresh_token: str) -> dict[str, Any] | None:
    response = requests.post(
        token_endpoint(tenant_id),
        data={
            "client_id": client_id,
            "scope": " ".join(scopes),
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=60,
    )
    if response.status_code >= 400:
        return None
    return response.json()


def acquire_device_code_token(client_id: str, tenant_id: str, scopes: list[str]) -> dict[str, Any]:
    print("Requesting Microsoft device login code...", flush=True)
    device_response = requests.post(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/devicecode",
        data={"client_id": client_id, "scope": " ".join(scopes)},
        timeout=20,
    )
    flow = raise_for_oauth_error(device_response, "Device-code login start")
    print(flow.get("message") or f"Open {flow['verification_uri']} and enter code {flow['user_code']}", flush=True)

    interval = int(flow.get("interval", 5))
    expires_at = time.time() + int(flow.get("expires_in", 900))

    while time.time() < expires_at:
        time.sleep(interval)
        token_response = requests.post(
            token_endpoint(tenant_id),
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": client_id,
                "device_code": flow["device_code"],
            },
            timeout=60,
        )
        payload = token_response.json()
        if token_response.status_code == 200:
            return payload

        error = payload.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5
            continue
        if error == "invalid_client" and "7000218" in str(payload):
            raise GraphError(
                "Device-code login failed because the Azure app is not enabled as a public client. "
                "In Azure Portal, open App registrations > this app > Authentication > Advanced settings, "
                "then set 'Allow public client flows' to Yes. Original error: "
                f"{payload}"
            )
        raise GraphError(f"Device-code login failed: {payload}")

    raise GraphError("Device-code login timed out before authorization completed")


def acquire_token(config: dict[str, Any], token_cache_path: Path = TOKEN_CACHE_PATH) -> str:
    client_id = os.getenv("OUTLOOK_SORTER_CLIENT_ID") or config["azure"]["client_id"]
    tenant_id = os.getenv("OUTLOOK_SORTER_TENANT_ID") or config["azure"]["tenant_id"]
    scopes = config["azure"]["scopes"]
    cache = read_token_cache(token_cache_path)

    if cache.get("access_token") and float(cache.get("expires_at", 0)) > time.time() + 300:
        return cache["access_token"]

    token_result = None
    if cache.get("refresh_token"):
        token_result = refresh_access_token(client_id, tenant_id, scopes, cache["refresh_token"])

    if not token_result:
        token_result = acquire_device_code_token(client_id, tenant_id, scopes)

    if "access_token" not in token_result:
        raise GraphError(f"Could not acquire token: {token_result}")

    next_cache = {
        "access_token": token_result["access_token"],
        "refresh_token": token_result.get("refresh_token") or cache.get("refresh_token"),
        "expires_at": time.time() + int(token_result.get("expires_in", 3600)),
    }
    write_token_cache(token_cache_path, next_cache)
    return next_cache["access_token"]


class GraphClient:
    def __init__(self, token: str, user_base: str) -> None:
        self.user_base = user_base
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        for attempt in range(5):
            response = self.session.request(method, url, timeout=60, **kwargs)
            if response.status_code in (429, 503, 504):
                retry_after = int(response.headers.get("Retry-After", "2"))
                time.sleep(retry_after + attempt)
                continue
            if response.status_code >= 400:
                raise GraphError(f"{method} {url} failed: {response.status_code} {response.text}")
            if response.status_code == 204 or not response.text:
                return None
            return response.json()
        raise GraphError(f"{method} {url} failed after retries")

    def get(self, url: str) -> Any:
        return self.request("GET", url)

    def patch(self, url: str, payload: dict[str, Any]) -> Any:
        return self.request("PATCH", url, json=payload)

    def post(self, url: str, payload: dict[str, Any]) -> Any:
        return self.request("POST", url, json=payload)

    def delete(self, url: str) -> Any:
        return self.request("DELETE", url)

    def paged(self, url: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        next_url: str | None = url
        while next_url:
            data = self.get(next_url)
            rows.extend(data.get("value", []))
            next_url = data.get("@odata.nextLink")
        return rows


def list_child_folders(client: GraphClient, parent_id: str | None = None) -> list[dict[str, Any]]:
    location = "root" if parent_id is None else f"child of {parent_id}"
    progress(f"FOLDERS {location}")
    root = f"{client.user_base}/mailFolders"
    if parent_id:
        root = f"{client.user_base}/mailFolders/{parent_id}/childFolders"
    url = f"{root}?$top=100&$select=id,displayName,totalItemCount,unreadItemCount"
    return client.paged(url)


def find_folders_by_name(client: GraphClient, display_name: str) -> list[dict[str, Any]]:
    progress(f"FIND folder by name: {display_name}")
    matches: list[dict[str, Any]] = []

    def walk(parent_id: str | None = None, parent_path: str = "") -> None:
        for folder in list_child_folders(client, parent_id):
            path = f"{parent_path}/{folder['displayName']}" if parent_path else folder["displayName"]
            if folder["displayName"].strip().lower() == display_name.strip().lower():
                matches.append({**folder, "path": path})
            walk(folder["id"], path)

    walk()
    return matches


def resolve_folder(client: GraphClient, folder_path: str) -> dict[str, Any]:
    parts = [part.strip() for part in folder_path.replace("\\", "/").split("/") if part.strip()]
    if not parts:
        raise GraphError("Folder path cannot be empty")

    parent_id: str | None = None
    folders = list_child_folders(client)
    current: dict[str, Any] | None = None

    if len(parts) == 1:
        root_matches = [folder for folder in folders if folder["displayName"].strip().lower() == parts[0].strip().lower()]
        if len(root_matches) == 1:
            progress(f"RESOLVE matched root folder: {root_matches[0]['displayName']}")
            return root_matches[0]
        if len(root_matches) > 1:
            names = ", ".join(match["displayName"] for match in root_matches)
            raise GraphError(f"Folder name '{folder_path}' matched multiple root folders: {names}. Use the full path in config.json.")

        matches = find_folders_by_name(client, parts[0])
        if len(matches) == 1:
            progress(f"RESOLVE matched nested folder: {matches[0].get('path', matches[0]['displayName'])}")
            return matches[0]
        if len(matches) > 1:
            paths = ", ".join(match.get("path", match["displayName"]) for match in matches)
            raise GraphError(f"Folder name '{folder_path}' matched multiple folders: {paths}. Use the full path in config.json.")

    for part in parts:
        progress(f"RESOLVE check part: {part}")
        current = next((folder for folder in folders if folder["displayName"].strip().lower() == part.strip().lower()), None)
        if not current:
            location = "root" if parent_id is None else f"folder id {parent_id}"
            raise GraphError(f"Folder '{part}' was not found under {location} while resolving '{folder_path}'")
        progress(f"RESOLVE matched part: {current['displayName']}")
        parent_id = current["id"]
        folders = list_child_folders(client, parent_id)

    progress(f"RESOLVE done: {folder_path}")
    return current


def recipient_addresses(row: dict[str, Any], key: str) -> list[str]:
    recipients = row.get(key) or []
    addresses: list[str] = []
    for recipient in recipients:
        email = (recipient or {}).get("emailAddress") or {}
        address = normalize(email.get("address"))
        if address:
            addresses.append(address)
    return addresses


def message_from_graph(row: dict[str, Any]) -> MessageInfo:
    sender = row.get("from") or row.get("sender") or {}
    email = sender.get("emailAddress") or {}
    return MessageInfo(
        id=row["id"],
        subject=row.get("subject") or "",
        sender_name=email.get("name") or "",
        sender_email=normalize(email.get("address")),
        to_emails=recipient_addresses(row, "toRecipients"),
        cc_emails=recipient_addresses(row, "ccRecipients"),
        body_preview=row.get("bodyPreview") or '',
        categories=list(row.get("categories") or []),
    )


def message_body_text(client: GraphClient, message_id: str) -> str:
    data = client.get(f"{client.user_base}/messages/{message_id}?$select=body")
    body = (data or {}).get("body") or {}
    content = body.get("content") or ""
    # Graph may return HTML for body.content; stripping tags is enough for keyword matching.
    return re.sub(r"<[^>]+>", " ", content)


def list_messages(client: GraphClient, folder_id: str, page_size: int, limit: int | None = None) -> list[MessageInfo]:
    select = "id,subject,bodyPreview,from,sender,toRecipients,ccRecipients,categories,receivedDateTime"
    order = "receivedDateTime desc"
    url: str | None = f"{client.user_base}/mailFolders/{folder_id}/messages?$top={page_size}&$select={select}&$orderby={order}"
    messages: list[MessageInfo] = []

    while url:
        data = client.get(url)
        for row in data.get("value", []):
            messages.append(message_from_graph(row))
            if limit is not None and len(messages) >= limit:
                return messages
        url = data.get("@odata.nextLink")

    return messages


def domain_matches(actual_domain: str, configured_domain: str) -> bool:
    wanted = normalize(configured_domain)
    return actual_domain == wanted or actual_domain.endswith(f".{wanted}")


def keyword_matches_text(keyword: str, text: str) -> bool:
    raw_keyword = (keyword or "").strip()
    if not raw_keyword:
        return False

    if raw_keyword == "PTO":
        pattern = r"(?<![A-Za-z0-9])PTO(?![A-Za-z0-9])"
        return re.search(pattern, text or "") is not None

    wanted = normalize(raw_keyword)
    haystack = normalize(text)
    pattern = rf"(?<![a-z0-9]){re.escape(wanted)}(?![a-z0-9])"
    return re.search(pattern, haystack) is not None


def rule_matches(message: MessageInfo, rule: dict[str, Any]) -> bool:
    if rule.get("enabled") is False:
        return False

    checks: list[bool] = []

    domains = rule.get("domains", [])
    if domains:
        checks.append(any(any(domain_matches(domain, configured_domain) for domain in message.all_domains) for configured_domain in domains))

    senders = rule.get("senders", [])
    if senders:
        checks.append(any(normalize(configured_sender) in message.all_emails for configured_sender in senders))

    recipient_emails = {normalize(email) for email in [*message.to_emails, *message.cc_emails]}
    recipients = [*rule.get("to_or_cc", []), *rule.get("recipients", [])]
    if recipients:
        checks.append(any(normalize(configured_recipient) in recipient_emails for configured_recipient in recipients))

    categories = rule.get("categories_contains", [])
    if categories:
        message_categories = {normalize(category) for category in message.categories}
        checks.append(any(normalize(configured_category) in message_categories for configured_category in categories))

    subject_keywords = rule.get("subject_contains", [])
    if subject_keywords:
        checks.append(any(keyword_matches_text(keyword, message.subject) for keyword in subject_keywords))

    subject_keywords_all = rule.get("subject_contains_all", [])
    if subject_keywords_all:
        checks.append(all(keyword_matches_text(keyword, message.subject) for keyword in subject_keywords_all))

    body_text = message.body_content or message.body_preview

    body_keywords = rule.get("body_contains", [])
    if body_keywords:
        checks.append(any(keyword_matches_text(keyword, body_text) for keyword in body_keywords))

    searchable_keywords = rule.get("subject_or_body_contains", [])
    if searchable_keywords:
        checks.append(any(keyword_matches_text(keyword, f"{message.subject}\n{body_text}") for keyword in searchable_keywords))

    if not checks:
        return False
    if rule.get("require_all"):
        return all(checks)
    return any(checks)


def company_rule_matches(message: MessageInfo, rule: dict[str, Any]) -> bool:
    if rule.get("enabled") is False:
        return False

    for configured_domain in rule.get("recipient_domains", []):
        if any(domain_matches(domain, configured_domain) for domain in message.recipient_domains):
            return True

    return rule_matches(message, rule)


def choose_company(message: MessageInfo, config: dict[str, Any]) -> str | None:
    priority = config["runtime"]["company_categories"]

    for rule in config.get("special_move_rules", []):
        if rule_matches(message, rule) and rule.get("force_company"):
            return rule["force_company"]

    for company in priority:
        for rule in config["company_rules"]:
            if rule["company"] == company and company_rule_matches(message, rule):
                return company

    for company in priority:
        if company in message.categories:
            return company

    return config["runtime"].get("default_company")


def company_categories_only(categories: list[str], company_categories: list[str]) -> list[str]:
    return [category for category in categories if category in company_categories]


def categories_with_single_company(message: MessageInfo, company: str | None, config: dict[str, Any]) -> list[str]:
    company_categories = set(config["runtime"]["company_categories"])
    retained = [category for category in message.categories if category not in company_categories]
    if not company:
        return retained
    for rule in config.get("special_move_rules", []):
        if rule_matches(message, rule):
            for category in rule.get("add_categories", []):
                if category not in retained and category not in company_categories:
                    retained.append(category)
    return retained + [company]


def update_categories(client: GraphClient, message: MessageInfo, categories: list[str], dry_run: bool) -> None:
    if message.categories == categories:
        return

    print(f"TAG  {message.sender_email} | {message.subject[:80]} -> {categories}")
    if not dry_run:
        client.patch(f"{client.user_base}/messages/{message.id}", {"categories": categories})


def classify_folder(client: GraphClient, folder: dict[str, Any], config: dict[str, Any], dry_run: bool) -> int:
    changed = 0
    page_size = int(config["runtime"]["page_size"])
    for message in list_messages(client, folder["id"], page_size):
        company = choose_company(message, config)
        desired = categories_with_single_company(message, company, config)
        if desired != message.categories:
            update_categories(client, message, desired, dry_run)
            changed += 1
    return changed


def allowed_special_rules(config: dict[str, Any], folder_mode: str) -> list[dict[str, Any]]:
    rules = list(config.get("special_move_rules", []))
    if folder_mode != "inbox":
        return rules
    allowed_names = set(config.get("runtime", {}).get("inbox_special_rule_names", []))
    if not allowed_names:
        return []
    return [rule for rule in rules if rule.get("name") in allowed_names]


def choose_special_rule(message: MessageInfo, config: dict[str, Any], folder_mode: str = "done") -> dict[str, Any] | None:
    for rule in allowed_special_rules(config, folder_mode):
        if rule_matches(message, rule):
            if rule.get("review_only"):
                return None
            return rule
    return None


def destination_from_rule(rule: dict[str, Any] | None) -> tuple[str, str] | None:
    if not rule:
        return None
    if rule["destination_type"] == "company":
        return "company", rule["company"]
    if rule["destination_type"] == "delete":
        return "delete", rule.get("destination_key", "delete")
    return "special", rule["destination_key"]


def choose_special_destination(message: MessageInfo, config: dict[str, Any], folder_mode: str = "done") -> tuple[str, str] | None:
    return destination_from_rule(choose_special_rule(message, config, folder_mode))


def choose_destination(message: MessageInfo, config: dict[str, Any]) -> tuple[str, str] | None:
    special_destination = choose_special_destination(message, config, "done")
    if special_destination:
        return special_destination

    company = choose_company(message, config)
    if not company:
        return None
    return "company", company

def destination_folder_id(
    destination: tuple[str, str] | None,
    config: dict[str, Any],
    resolved_folders: dict[str, dict[str, Any]],
) -> tuple[str, str] | None:
    if not destination:
        return None
    destination_type, value = destination
    if destination_type == "delete":
        return "DELETE", "DELETE"
    if destination_type == "company":
        path = config["folders"]["done_by_company"].get(value)
    else:
        path = config["folders"]["special_destinations"].get(value)
    if not path:
        return None
    return path, resolved_folders[path]["id"]


def mark_message_read(client: GraphClient, message: MessageInfo, dry_run: bool) -> None:
    print(f"READ {message.sender_email} | {message.subject[:80]}")
    if not dry_run:
        client.patch(f"{client.user_base}/messages/{message.id}", {"isRead": True})


def move_message(client: GraphClient, message: MessageInfo, destination_id: str, dry_run: bool) -> None:
    print(f"MOVE {message.sender_email} | {message.subject[:80]}")
    if not dry_run:
        client.post(f"{client.user_base}/messages/{message.id}/move", {"destinationId": destination_id})


def delete_message(client: GraphClient, message: MessageInfo, dry_run: bool) -> None:
    print(f"DELETE {message.sender_email} | {message.subject[:80]}")
    if not dry_run:
        client.delete(f"{client.user_base}/messages/{message.id}")


def resolve_all_required_folders(client: GraphClient, config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    progress("PREP resolving configured folders")
    paths = {
        config["folders"]["inbox"],
        config["folders"]["done"],
        *config["folders"]["done_by_company"].values(),
        *[path for path in config["folders"].get("special_destinations", {}).values() if path],
    }
    resolved: dict[str, dict[str, Any]] = {}
    for path in sorted(paths):
        progress(f"PREP folder: {path}")
        resolved[path] = resolve_folder(client, path)
    progress("PREP configured folders ready")
    return resolved


def print_folder_check(resolved: dict[str, dict[str, Any]]) -> None:
    for path, folder in resolved.items():
        total = folder.get("totalItemCount", "?")
        unread = folder.get("unreadItemCount", "?")
        print(f"OK   {path} | total={total} unread={unread}")


def run_classify(
    client: GraphClient,
    config: dict[str, Any],
    resolved: dict[str, dict[str, Any]],
    dry_run: bool,
    source_path: str | None = None,
) -> None:
    changed = 0
    if source_path:
        source_folder = resolve_folder(client, source_path)
        changed += classify_folder(client, source_folder, config, dry_run)
        print(f"Classification complete. Source: {source_path}. Changed messages: {changed}")
        return

    if config["runtime"].get("classify_inbox", True):
        inbox_path = config["folders"]["inbox"]
        changed += classify_folder(client, resolved[inbox_path], config, dry_run)

    if config["runtime"].get("classify_done", True):
        done_path = config["folders"]["done"]
        changed += classify_folder(client, resolved[done_path], config, dry_run)

    print(f"Classification complete. Changed messages: {changed}")


def run_sort_folder(
    client: GraphClient,
    config: dict[str, Any],
    resolved: dict[str, dict[str, Any]],
    dry_run: bool,
    source_path: str,
    max_messages: int | None = None,
) -> None:
    progress(f"SORT start: {source_path}")
    source_folder = resolve_folder(client, source_path)
    page_size = int(config["runtime"]["page_size"])
    moved = 0
    scanned = 0

    progress(f"SOURCE {source_path}")
    progress(f"FETCH messages page_size={page_size} limit={max_messages if max_messages is not None else "all"}")
    for message in list_messages(client, source_folder["id"], page_size, max_messages):
        scanned += 1
        if scanned == 1 or scanned % 10 == 0:
            print(f"SCAN {scanned} | {message.sender_email} | {message.subject[:80]}")

        company = choose_company(message, config)
        desired_categories = categories_with_single_company(message, company, config)
        if desired_categories != message.categories:
            update_categories(client, message, desired_categories, dry_run)
            message = replace(message, categories=desired_categories)

        folder_mode = "inbox" if source_path == config["folders"]["inbox"] else "done"
        rule = choose_special_rule(message, config, folder_mode)
        if rule:
            destination = destination_from_rule(rule)
            destination_info = destination_folder_id(destination, config, resolved)
        elif folder_mode == "done":
            destination = choose_destination(message, config)
            destination_info = destination_folder_id(destination, config, resolved)
        else:
            destination = None
            destination_info = None

        if not destination_info:
            continue
        path, destination_id = destination_info
        if destination_id == source_folder["id"]:
            print(f"SKIP {message.sender_email} | {message.subject[:80]} -> already in {path}")
            continue
        print(f"DEST {path}")
        if rule and rule.get("mark_read"):
            mark_message_read(client, message, dry_run)
        if destination_id == "DELETE":
            delete_message(client, message, dry_run)
        else:
            move_message(client, message, destination_id, dry_run)
        moved += 1

    limit_note = f" Limit: {max_messages}." if max_messages is not None else ""
    print(f"Folder sorting complete. Source: {source_path}.{limit_note} Scanned messages: {scanned}. Moved messages: {moved}")


def run_sort_done(client: GraphClient, config: dict[str, Any], resolved: dict[str, dict[str, Any]], dry_run: bool) -> None:
    done_path = config["folders"]["done"]
    done_folder = resolved[done_path]
    page_size = int(config["runtime"]["page_size"])
    moved = 0

    for message in list_messages(client, done_folder["id"], page_size):
        destination = choose_destination(message, config)
        destination_info = destination_folder_id(destination, config, resolved)
        if not destination_info:
            print(f"SKIP {message.sender_email} | {message.subject[:80]} -> no destination; left in general Done")
            continue
        path, destination_id = destination_info
        print(f"DEST {path}")
        move_message(client, message, destination_id, dry_run)
        moved += 1

    print(f"Done sorting complete. Moved messages: {moved}")


def rebalance_company_order(config: dict[str, Any], only_company: str | None = None) -> list[tuple[str, str]]:
    done_by_company = config["folders"]["done_by_company"]
    company_order = config["runtime"]["company_categories"]
    companies = [company for company in company_order if company in done_by_company]
    if only_company:
        companies = [company for company in companies if company == only_company]
    return [(company, done_by_company[company]) for company in companies]


def run_rebalance_done(
    client: GraphClient,
    config: dict[str, Any],
    resolved: dict[str, dict[str, Any]],
    dry_run: bool,
    only_company: str | None = None,
) -> None:
    page_size = int(config["runtime"]["page_size"])
    changed = 0
    moved = 0
    skipped = 0

    for source_company, source_path in rebalance_company_order(config, only_company):
        source_folder = resolved[source_path]
        print(f"CHECK {source_company} | {source_path}")
        for message in list_messages(client, source_folder["id"], page_size):
            company = choose_company(message, config)
            desired_categories = categories_with_single_company(message, company, config)
            if desired_categories != message.categories:
                update_categories(client, message, desired_categories, dry_run)
                changed += 1

            destination = choose_destination(message, config)
            destination_info = destination_folder_id(destination, config, resolved)
            if not destination_info:
                print(f"SKIP {message.sender_email} | {message.subject[:80]} -> no destination; left in {source_path}")
                skipped += 1
                continue

            destination_path, destination_id = destination_info
            if destination_id == source_folder["id"]:
                continue

            print(f"DEST {destination_path}")
            move_message(client, message, destination_id, dry_run)
            moved += 1

    print(f"Done rebalance complete. Changed messages: {changed}. Moved messages: {moved}. Skipped messages: {skipped}")


DATE_CLEANUP_SYSTEM_FOLDERS = {
    "conversation history",
    "deleted items",
    "drafts",
    "junk email",
    "outbox",
    "rss feeds",
    "sent items",
    "sync issues",
}


def list_all_folders(client: GraphClient) -> list[dict[str, Any]]:
    folders: list[dict[str, Any]] = []

    def walk(parent_id: str | None = None, parent_path: str = "") -> None:
        for folder in list_child_folders(client, parent_id):
            path = f"{parent_path}/{folder['displayName']}" if parent_path else folder["displayName"]
            row = {**folder, "path": path}
            folders.append(row)
            walk(folder["id"], path)

    walk()
    return folders


def date_cleanup_destination(received_datetime: str, config: dict[str, Any]) -> str | None:
    received_date = (received_datetime or "")[:10]
    for rule in config["folders"].get("date_cleanup", []):
        if rule["start"] <= received_date < rule["end"]:
            return rule["folder"]
    return None


def list_date_cleanup_rows(client: GraphClient, folder_id: str, page_size: int, limit: int | None = None) -> list[dict[str, Any]]:
    select = "id,subject,from,sender,receivedDateTime"
    order = "receivedDateTime desc"
    url: str | None = f"{client.user_base}/mailFolders/{folder_id}/messages?$top={page_size}&$select={select}&$orderby={order}"
    rows: list[dict[str, Any]] = []
    while url:
        data = client.get(url)
        for row in data.get("value", []):
            rows.append(row)
            if limit is not None and len(rows) >= limit:
                return rows
        url = data.get("@odata.nextLink")
    return rows


def message_sender_email(row: dict[str, Any]) -> str:
    sender = row.get("from") or row.get("sender") or {}
    email = sender.get("emailAddress") or {}
    return normalize(email.get("address"))


def move_message_id(client: GraphClient, message_id: str, sender_email: str, subject: str, destination_id: str, dry_run: bool) -> None:
    print(f"MOVE {sender_email} | {subject[:80]}")
    if not dry_run:
        client.post(f"{client.user_base}/messages/{message_id}/move", {"destinationId": destination_id})


def run_date_cleanup(
    client: GraphClient,
    config: dict[str, Any],
    dry_run: bool,
    source_folder: str | None = None,
    include_system_folders: bool = False,
    max_messages: int | None = None,
) -> None:
    page_size = int(config["runtime"]["page_size"])
    rules = config["folders"].get("date_cleanup", [])
    if not rules:
        raise GraphError("date-cleanup requires folders.date_cleanup rules in config")

    destinations = {rule["folder"]: resolve_folder(client, rule["folder"]) for rule in rules}
    destination_ids = {path: folder["id"] for path, folder in destinations.items()}

    if source_folder:
        source = resolve_folder(client, source_folder)
        folders = [{**source, "path": source_folder}]
    else:
        folders = list_all_folders(client)

    scanned = 0
    moved = 0
    skipped_same = 0
    by_destination: dict[str, int] = {path: 0 for path in destination_ids}

    for folder in folders:
        folder_path = folder.get("path") or folder.get("displayName") or ""
        folder_name = folder.get("displayName", "").strip().lower()
        if not include_system_folders and folder_name in DATE_CLEANUP_SYSTEM_FOLDERS:
            continue

        print(f"CHECK {folder_path}")
        remaining = None if max_messages is None else max_messages - scanned
        if remaining is not None and remaining <= 0:
            break
        for row in list_date_cleanup_rows(client, folder["id"], page_size, remaining):
            if max_messages is not None and scanned >= max_messages:
                print(f"Date cleanup complete. Scanned messages: {scanned}. Moved messages: {moved}. Already correct: {skipped_same}.")
                for path, count in by_destination.items():
                    print(f"DEST COUNT {path}: {count}")
                return

            scanned += 1
            destination_path = date_cleanup_destination(row.get("receivedDateTime", ""), config)
            if not destination_path:
                continue
            destination_id = destination_ids[destination_path]
            if destination_id == folder["id"]:
                skipped_same += 1
                continue

            sender_email = message_sender_email(row)
            subject = row.get("subject") or ""
            print(f"DEST {destination_path} | DATE {(row.get('receivedDateTime') or '')[:10]}")
            move_message_id(client, row["id"], sender_email, subject, destination_id, dry_run)
            by_destination[destination_path] += 1
            moved += 1

    print(f"Date cleanup complete. Scanned messages: {scanned}. Moved messages: {moved}. Already correct: {skipped_same}.")
    for path, count in by_destination.items():
        print(f"DEST COUNT {path}: {count}")

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Classify and move Outlook mail with Microsoft Graph.")
    parser.add_argument(
        "command",
        choices=["folders", "classify", "sort-inbox", "sort-folder", "date-cleanup", "sort-done", "rebalance-done", "all"],
        help="folders checks paths; classify tags Inbox; sort-inbox moves Inbox by special rules; sort-folder moves a named folder by special rules; date-cleanup moves mail by received date; sort-done moves general Done; rebalance-done rechecks company Done folders; all runs enabled steps.",
    )
    parser.add_argument("--config", default=str(CONFIG_PATH), help="Path to config.json")
    parser.add_argument("--token-cache", default=str(TOKEN_CACHE_PATH), help="Path to token cache JSON")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without updating Outlook")
    parser.add_argument("--source-folder", help="Folder path to use with sort-folder, date-cleanup, or classify")
    parser.add_argument("--page-size", type=int, help="Override Graph page size for large folders")
    parser.add_argument("--max-messages", type=int, help="Only scan this many newest messages from the source folder")
    parser.add_argument("--include-system-folders", action="store_true", help="Include Sent Items, Deleted Items, Drafts, and other system folders in date-cleanup")
    parser.add_argument("--company", choices=["ZFS", "TNT", "AFS"], help="Limit rebalance-done to one company Done folder")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    progress(f"START command={args.command}")
    progress(f"CONFIG {args.config}")
    progress(f"TOKEN CACHE {args.token_cache}")
    config = load_config(Path(args.config))
    if args.page_size is not None:
        config["runtime"]["page_size"] = args.page_size

    progress("AUTH acquiring token")
    token = acquire_token(config, Path(args.token_cache))
    progress("AUTH token ready")
    client = GraphClient(token, get_user_base(config))
    progress("GRAPH client ready")
    resolved = resolve_all_required_folders(client, config)

    if args.command == "folders":
        print_folder_check(resolved)
        return 0

    if args.command in ("classify", "all"):
        run_classify(client, config, resolved, args.dry_run, args.source_folder)

    if args.command in ("sort-inbox", "all") and config["runtime"].get("move_inbox", False):
        run_sort_folder(client, config, resolved, args.dry_run, config["folders"]["inbox"], args.max_messages)

    if args.command == "sort-folder":
        if not args.source_folder:
            raise GraphError("sort-folder requires --source-folder")
        run_sort_folder(client, config, resolved, args.dry_run, args.source_folder, args.max_messages)

    if args.command == "date-cleanup":
        run_date_cleanup(client, config, args.dry_run, args.source_folder, args.include_system_folders, args.max_messages)

    if args.command in ("sort-done", "all") and config["runtime"].get("move_done", True):
        run_sort_done(client, config, resolved, args.dry_run)

    if args.command == "rebalance-done":
        run_rebalance_done(client, config, resolved, args.dry_run, args.company)

    if args.dry_run:
        print("Dry run only. Outlook was not changed.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Cancelled.")
        raise SystemExit(130)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)




















