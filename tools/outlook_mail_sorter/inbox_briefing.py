from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import outlook_mail_sorter as sorter

DEFAULT_SELF_EMAILS = {"yungyeong.j@afstransco.com"}
NOISE_SENDERS = (
    "no-reply",
    "noreply",
    "notifications@",
    "notification@",
    "mailer-daemon",
    "postmaster@",
)
ACTION_KEYWORDS = (
    "please",
    "request",
    "approval",
    "approve",
    "urgent",
    "asap",
    "follow up",
    "time card",
    "timecard",
    "payroll",
    "invoice",
    "quote",
    "coi",
    "setup",
    "confirm",
)


def parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def format_dt(value: str | None) -> str:
    dt = parse_dt(value)
    if dt.year == 1:
        return "unknown"
    return dt.astimezone().strftime("%Y-%m-%d %H:%M")


def sender_email(row: dict[str, Any]) -> str:
    sender = row.get("from") or row.get("sender") or {}
    email = sender.get("emailAddress") or {}
    return sorter.normalize(email.get("address"))


def sender_name(row: dict[str, Any]) -> str:
    sender = row.get("from") or row.get("sender") or {}
    email = sender.get("emailAddress") or {}
    return email.get("name") or sender_email(row)


def is_noise(row: dict[str, Any]) -> bool:
    email = sender_email(row)
    subject = sorter.normalize(row.get("subject"))
    if any(token in email for token in NOISE_SENDERS):
        return True
    if subject.startswith(("automatic reply:", "undeliverable:", "accepted:", "declined:", "tentative:")):
        return True
    return False


def has_action_keyword(row: dict[str, Any]) -> bool:
    text = sorter.normalize(f"{row.get('subject') or ''}\n{row.get('bodyPreview') or ''}")
    return any(keyword in text for keyword in ACTION_KEYWORDS)


def list_folder_rows(client: sorter.GraphClient, folder_path: str, top: int) -> list[dict[str, Any]]:
    folder = sorter.resolve_folder(client, folder_path)
    select = "id,conversationId,subject,bodyPreview,from,sender,toRecipients,ccRecipients,categories,isRead,receivedDateTime,sentDateTime"
    url = f"{client.user_base}/mailFolders/{folder['id']}/messages?$top={top}&$select={select}&$orderby=receivedDateTime desc"
    return client.paged(url)


def latest_by_conversation(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[row.get("conversationId") or row["id"]].append(row)
    latest = []
    for messages in groups.values():
        latest.append(max(messages, key=lambda row: parse_dt(row.get("receivedDateTime"))))
    return sorted(latest, key=lambda row: parse_dt(row.get("receivedDateTime")), reverse=True)


def sent_latest_by_conversation(rows: list[dict[str, Any]]) -> dict[str, datetime]:
    latest: dict[str, datetime] = {}
    for row in rows:
        conv = row.get("conversationId")
        if not conv:
            continue
        dt = parse_dt(row.get("sentDateTime") or row.get("receivedDateTime"))
        if conv not in latest or dt > latest[conv]:
            latest[conv] = dt
    return latest


def bullet(row: dict[str, Any], note: str | None = None) -> str:
    subject = row.get("subject") or "(no subject)"
    preview = " ".join((row.get("bodyPreview") or "").split())[:220]
    unread = "unread" if row.get("isRead") is False else "read"
    categories = ", ".join(row.get("categories") or [])
    meta = f"{format_dt(row.get('receivedDateTime'))} | {sender_name(row)} <{sender_email(row)}> | {unread}"
    if categories:
        meta += f" | {categories}"
    suffix = f" — {note}" if note else ""
    return f"- **{subject}**{suffix}\n  - {meta}\n  - {preview}"


def build_report(inbox_rows: list[dict[str, Any]], sent_rows: list[dict[str, Any]], self_emails: set[str]) -> str:
    latest_inbox = latest_by_conversation(inbox_rows)
    sent_by_conv = sent_latest_by_conversation(sent_rows)

    unread = [row for row in inbox_rows if row.get("isRead") is False and not is_noise(row)]
    needs_reply = []
    waiting = []
    review = []

    for row in latest_inbox:
        if is_noise(row):
            continue
        conv = row.get("conversationId") or row["id"]
        incoming_dt = parse_dt(row.get("receivedDateTime"))
        latest_sent_dt = sent_by_conv.get(conv)
        sender = sender_email(row)
        if latest_sent_dt and latest_sent_dt > incoming_dt:
            waiting.append((row, f"you replied after this at {latest_sent_dt.astimezone().strftime('%Y-%m-%d %H:%M')}"))
        elif sender in self_emails:
            waiting.append((row, "latest message appears to be from you"))
        elif has_action_keyword(row) or row.get("isRead") is False or "Urgent" in (row.get("categories") or []):
            needs_reply.append(row)
        else:
            review.append(row)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# Inbox briefing - {now}",
        "",
        f"Inbox messages scanned: {len(inbox_rows)}",
        f"Conversation summaries: {len(latest_inbox)}",
        f"Unread non-noise messages: {len(unread)}",
        f"Reply/action candidates: {len(needs_reply)}",
        f"Already replied / waiting candidates: {len(waiting)}",
        f"Review later candidates: {len(review)}",
        "",
        "## Unread",
        "",
    ]
    lines.extend([bullet(row) for row in unread] or ["- None"])
    lines.extend(["", "## Reply Or Action Candidates", ""])
    lines.extend([bullet(row) for row in needs_reply] or ["- None"])
    lines.extend(["", "## Already Replied / Waiting", ""])
    lines.extend([bullet(row, note) for row, note in waiting] or ["- None"])
    lines.extend(["", "## Review Later", ""])
    lines.extend([bullet(row) for row in review] or ["- None"])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a morning Inbox briefing report.")
    parser.add_argument("--config", default=str(sorter.CONFIG_PATH), help="Path to config.json")
    parser.add_argument("--top", type=int, default=250, help="Messages to scan from Inbox and Sent Items")
    parser.add_argument("--self-email", action="append", default=[], help="Email address that counts as you")
    parser.add_argument("--output", help="Report output path. Defaults to reports/inbox-briefing-*.md")
    args = parser.parse_args()

    config = sorter.load_config(Path(args.config))
    token = sorter.acquire_token(config)
    client = sorter.GraphClient(token, sorter.get_user_base(config))

    self_emails = {sorter.normalize(email) for email in args.self_email} or set(DEFAULT_SELF_EMAILS)
    inbox_rows = list_folder_rows(client, config["folders"].get("inbox", "Inbox"), args.top)
    sent_rows = list_folder_rows(client, "Sent Items", args.top)
    report = build_report(inbox_rows, sent_rows, self_emails)

    if args.output:
        output_path = Path(args.output)
    else:
        reports_dir = Path(__file__).with_name("reports")
        reports_dir.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        output_path = reports_dir / f"inbox-briefing-{stamp}.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(f"Inbox briefing written to {output_path}")
    print("")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())