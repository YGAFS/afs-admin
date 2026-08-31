from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Callable

from pypdf import PdfReader


ROOT = Path(r"C:\Users\nero_\OneDrive - afstrans.co\afstrans.co - AFS_2023\Admin\0. Admin Dashboard\0. DB")
OUT_DIR = Path(r"C:\Users\nero_\OneDrive\Desktop\afs-admin\tmp\utility_bill_extract")

TWOPLACES = Decimal("0.01")


def money(value: str) -> Decimal:
    cleaned = value.replace(",", "").replace("$", "").strip()
    cleaned = cleaned.replace("(", "-").replace(")", "")
    return Decimal(cleaned).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def fmt_money(value: Decimal) -> str:
    return f"{value.quantize(TWOPLACES, rounding=ROUND_HALF_UP):.2f}"


def search(pattern: str, text: str, flags: int = 0) -> re.Match[str]:
    match = re.search(pattern, text, flags)
    if not match:
        raise ValueError(f"Pattern not found: {pattern}")
    return match


def find_money_after(label: str, text: str, flags: int = re.IGNORECASE) -> Decimal:
    pattern = rf"{label}[\s.:]*\$?\s*(-?[\d,]+\.\d{{2}})"
    return money(search(pattern, text, flags).group(1))


def extract_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def normalize_whitespace(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text


@dataclass
class BillRecord:
    provider: str
    account_number: str
    billing_year: int
    billing_month: int
    due_date: str
    previous_balance: str
    current_charges: str
    total_due: str
    currency: str
    is_paid: bool
    source_file: str


MONTH_LOOKUP = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def month_from_date(date_str: str) -> tuple[int, int, str]:
    parts = re.split(r"[/ -]", date_str.strip())
    if len(parts[0]) == 4:
        year = int(parts[0])
        month = int(parts[1])
        day = int(parts[2])
    else:
        month = int(parts[0])
        day = int(parts[1])
        year = int(parts[2])
        if year < 100:
            year += 2000
    return year, month, f"{year:04d}-{month:02d}-{day:02d}"


def parse_long_date(date_str: str) -> tuple[int, int, str]:
    match = search(r"([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})", date_str)
    month = MONTH_LOOKUP[match.group(1)[:3].lower()]
    day = int(match.group(2))
    year = int(match.group(3))
    return year, month, f"{year:04d}-{month:02d}-{day:02d}"


def make_record(provider: str, account_number: str, bill_year: int, bill_month: int, due_date: str, previous_balance: Decimal, current_charges: Decimal, total_due: Decimal, currency: str, source_file: Path) -> BillRecord:
    return BillRecord(
        provider=provider,
        account_number=account_number,
        billing_year=bill_year,
        billing_month=bill_month,
        due_date=due_date,
        previous_balance=fmt_money(previous_balance),
        current_charges=fmt_money(current_charges),
        total_due=fmt_money(total_due),
        currency=currency,
        is_paid=(total_due <= Decimal("0.00")),
        source_file=str(source_file),
    )


def parse_telus(path: Path, text: str) -> BillRecord:
    account = search(r"Account number:\s*([\d ]+)", text).group(1).replace(" ", "")
    bill_date = search(r"Your TELUS bill\s+([A-Za-z]+\s+\d{2},\s+\d{4})", text).group(1)
    due_date = search(r"Total if received by ([A-Za-z]+\s+\d{2},\s+\d{4})", text).group(1)
    previous = find_money_after(r"Balance forward from your last bill", text)
    current = find_money_after(r"Total new charges", text)
    total = find_money_after(r"Total due", text)
    by, bm, _ = parse_long_date(bill_date)
    _, _, due = parse_long_date(due_date)
    return make_record("TELUS", account, by, bm, due, previous, current, total, "CAD", path)


def parse_rogers(path: Path, text: str) -> BillRecord:
    if "Bill number" in text:
        account = search(r"Account number\s+([\d-]+)", text).group(1)
        bill_date = search(r"Bill date\s+([A-Za-z]{3}\s+\d{2},\s+\d{4})", text).group(1)
        due_date = search(r"Required Payment Date:\s*([A-Za-z]{3}\s+\d{2},\s+\d{4})", text).group(1)
        previous_match = re.search(r"Balance brought forward\s+([\d,]+\.\d{2})", text)
        previous = money(previous_match.group(1)) if previous_match else Decimal("0.00")
        current = find_money_after(r"Total \(Includes taxes\)", text)
        total = find_money_after(r"Total Due", text)
        by, bm, _ = parse_long_date(bill_date)
        _, _, due = parse_long_date(due_date)
        return make_record("Rogers", account, by, bm, due, previous, current, total, "CAD", path)

    account = search(r"Account\s+(\d+)", text).group(1)
    current = find_money_after(r"Total charges this month", text)
    total_match = re.search(r"Amount Due\s*\$?\s*(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
    total = money(total_match.group(1)) if total_match else find_money_after(r"Total Amount", text)
    previous = total - current
    date_match = search(r"(\d{1,2})\s+(\d{1,2})\s+(\d{4})", text)
    bill_day = int(date_match.group(1))
    bill_month = int(date_match.group(2))
    bill_year = int(date_match.group(3))
    due = f"{bill_year:04d}-{bill_month:02d}-{bill_day:02d}"
    return make_record("Rogers", account, bill_year, bill_month, due, previous, current, total, "CAD", path)


def parse_enbridge(path: Path, text: str) -> BillRecord:
    account_match = search(r"(\d{2}\s+\d{2}\s+\d{2}\s+\d{5}\s+\d)\s+([A-Z][a-z]{2}\s+\d{2},\s+\d{4})", text)
    account = re.sub(r"\s+", "", account_match.group(1))
    bill_date = account_match.group(2)
    long_dates = re.findall(r"[A-Z][a-z]{2}\s+\d{2},\s+\d{4}", text)
    unique_dates = []
    for item in long_dates:
        if item not in unique_dates:
            unique_dates.append(item)
    due_date = unique_dates[2]
    previous_match = re.search(r"Balance Forward\s+\$?(-?[\d,]+\.\d{2})", text)
    previous = money(previous_match.group(1)) if previous_match else find_money_after(r"Balance from Previous Bill", text)
    current = find_money_after(r"Charges for Natural Gas", text)
    total = find_money_after(r"Total Amount Due", text)
    by, bm, _ = parse_long_date(bill_date)
    _, _, due = parse_long_date(due_date)
    return make_record("Enbridge", account, by, bm, due, previous, current, total, "CAD", path)


def parse_grandbridge(path: Path, text: str) -> BillRecord:
    account = search(r"Account Number:([0-9-]+)", text).group(1)
    bill_date = search(r"issued on:([A-Za-z]{3} \d{2}, \d{4})", text).group(1)
    due_date = search(r"Due Date:([A-Za-z]{3} \d{2}, \d{4})", text).group(1)
    previous = find_money_after(r"Balance Forward", text)
    current = find_money_after(r"Current Charges", text)
    total = find_money_after(r"Total Amount Due", text)
    by, bm, _ = parse_long_date(bill_date)
    _, _, due = parse_long_date(due_date)
    return make_record("GrandBridge Energy", account, by, bm, due, previous, current, total, "CAD", path)


def parse_cambridge_water(path: Path, text: str) -> BillRecord:
    account = search(r"Account Number:\s*(\d+)", text).group(1)
    bill_date = search(r"Bill Issue Date:\s*(\d{4}/\d{2}/\d{2})", text).group(1)
    due_date = search(r"Due Date:\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})", text).group(1)
    block = search(r"Previous Balance\s+Payment Received\s+Adjustments/Other Charges\s+Balance Forward.*?\$([\d,. ]+)\s+\$([\d,. -]+)\s+\$([\d,. -]+)\s+\$([\d,. -]+)\s+Current Water/Wastewater Charges", text, re.DOTALL)
    previous = money(block.group(4).replace(" ", ""))
    current = find_money_after(r"Current Water/Wastewater Charges", text)
    total = money(search(r"\n69661\s+\$([\d,]+\.\d{2})\s+[A-Za-z]{3}", text).group(1))
    by, bm, _ = month_from_date(bill_date.replace("/", "-"))
    _, _, due = parse_long_date(due_date)
    return make_record("City of Cambridge Water", account, by, bm, due, previous, current, total, "CAD", path)


def parse_fontana_water(path: Path, text: str) -> BillRecord:
    cust = search(r"\[CustNum=(\d+)\]", text).group(1)
    acct = search(r"\[Sys_Acct_ID=(\d+)\]", text).group(1)
    account = f"{cust}-{acct}"
    bill_date = search(r"\[Sys_DocDate=(\d{1,2}/\d{1,2}/\d{4})\]", text).group(1)
    due_date = search(r"\[Sys_DueDate=(\d{1,2}/\d{1,2}/\d{4})\]", text).group(1)
    previous = money(search(r"\[PrevBal=([-\d.]+)\]", text).group(1))
    current = find_money_after(r"Total Current Charges", text)
    total = money(search(r"\[Sys_Balance=([-\d.]+)\]", text).group(1))
    by, bm, _ = month_from_date(bill_date)
    _, _, due = month_from_date(due_date)
    return make_record("Fontana Water Company", account, by, bm, due, previous, current, total, "USD", path)


def parse_burrtec(path: Path, text: str) -> BillRecord:
    account = search(r"(\d{9})", text).group(1)
    month_name = search(r" - ([A-Za-z]+)\.pdf$", path.name).group(1)
    bill_month = MONTH_LOOKUP[month_name[:3].lower()]
    bill_year = 2026
    import calendar
    last_day = calendar.monthrange(bill_year, bill_month)[1]
    due_match = re.search(r"Due By\s+(\d{2}/\d{2}/\d{2})", text)
    if due_match:
        _, _, due = month_from_date(due_match.group(1))
    else:
        due = f"{bill_year:04d}-{bill_month:02d}-{last_day:02d}"
    total_match = re.search(r"Total (?:Amount )?Due(?: - DO NOT P A Y)?\s*\$?\s*(-?[\d,]+\.\d{2})", text, re.IGNORECASE)
    total = money(total_match.group(1)) if total_match else find_money_after(r"Total Due", text)
    previous_match = re.search(r"Total Previous Balance\s+([\d,]+\.\d{2})", text)
    previous = money(previous_match.group(1)) if previous_match else Decimal("0.00")
    current = total - previous if previous_match else total
    return make_record("Burrtec", account, bill_year, bill_month, due, previous, current, total, "USD", path)


def parse_orkin(path: Path, text: str) -> BillRecord:
    account = search(r"Account Number\s+(\d+)", text).group(1)
    due_raw = search(r"\n(\d{1,2}/\d{1,2}/\d{4})\nCUSTOMER INFORMATION", text).group(1)
    service_raw = search(r"SERVICE ADDRESS .*?\n(\d{2}/\d{2}/\d{4})", text, re.DOTALL).group(1)
    row = search(r"PC Standard - Semi-Monthly - PC\s+\S.*?\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})", text, re.DOTALL)
    charge = money(row.group(1))
    total = find_money_after(r"TOTAL AMOUNT DUE", text)
    previous = Decimal("0.00")
    current = charge
    by, bm, _ = month_from_date(service_raw)
    _, _, due = month_from_date(due_raw)
    return make_record("Orkin", account, by, bm, due, previous, current, total, "USD", path)


PARSERS: dict[str, Callable[[Path, str], BillRecord]] = {
    "Telus": parse_telus,
    "Rogers": parse_rogers,
    "Enbridge": parse_enbridge,
    "Grand Bridge": parse_grandbridge,
    "Cambridge Water": parse_cambridge_water,
    "Fontana water": parse_fontana_water,
    "Burrtec": parse_burrtec,
    "Orkin": parse_orkin,
}


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def build_sql(record: BillRecord) -> str:
    return (
        "UPDATE utility_bills\n"
        "SET\n"
        f"  previous_balance = {record.previous_balance},\n"
        f"  current_charges  = {record.current_charges},\n"
        f"  billing_year     = {record.billing_year}\n"
        "WHERE\n"
        f"  provider       = '{sql_quote(record.provider)}'\n"
        f"  AND account_number = '{sql_quote(record.account_number)}'\n"
        f"  AND billing_month  = {record.billing_month}\n"
        f"  AND billing_year   = {record.billing_year};"
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    records: list[BillRecord] = []
    warnings: list[str] = []

    for path in sorted(ROOT.rglob("*.pdf")):
        parser = PARSERS.get(path.parent.name)
        if not parser:
            warnings.append(f"No parser for {path}")
            continue
        try:
            text = normalize_whitespace(extract_text(path))
            record = parser(path, text)
            prev = Decimal(record.previous_balance)
            curr = Decimal(record.current_charges)
            total = Decimal(record.total_due)
            if prev + curr != total:
                warnings.append(f"Total mismatch for {path.name}: previous({record.previous_balance}) + current({record.current_charges}) != total({record.total_due})")
            records.append(record)
        except Exception as exc:
            warnings.append(f"Failed to parse {path}: {exc}")

    records.sort(key=lambda r: (r.provider, r.account_number, r.billing_year, r.billing_month, r.source_file))
    (OUT_DIR / "utility_bills_extracted.json").write_text(json.dumps([asdict(r) for r in records], indent=2), encoding="utf-8")
    (OUT_DIR / "utility_bills_backfill.sql").write_text("\n\n".join(build_sql(r) for r in records), encoding="utf-8")
    (OUT_DIR / "utility_bills_warnings.txt").write_text("\n".join(warnings), encoding="utf-8")
    print(f"records={len(records)}")
    print(f"warnings={len(warnings)}")


if __name__ == "__main__":
    main()
