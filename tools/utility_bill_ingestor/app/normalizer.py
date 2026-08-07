"""Shared parsing/normalization helpers used by every extractor.

Money is always Decimal (never float). Dates are always normalized to
ISO YYYY-MM-DD (returned as `date` objects here; callers/repository format
them for Supabase).
"""
from __future__ import annotations

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

TWOPLACES = Decimal("0.01")

MONTH_LOOKUP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


class ParseError(ValueError):
    pass


def parse_money(value: str) -> Decimal:
    """Parse a currency string like '$1,234.56', '(45.00)', '-12.50' into a
    Decimal rounded to 2dp. Raises ParseError on unparseable input."""
    cleaned = value.replace(",", "").replace("$", "").strip()
    cleaned = cleaned.replace("(", "-").replace(")", "")
    if not cleaned or cleaned in {"-", "."}:
        raise ParseError(f"Not a money value: {value!r}")
    try:
        return Decimal(cleaned).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ParseError(f"Not a money value: {value!r}") from exc


def format_money(value: Decimal) -> str:
    return f"{value.quantize(TWOPLACES, rounding=ROUND_HALF_UP):.2f}"


def parse_date_numeric(value: str) -> date:
    """Parse mm/dd/yyyy, mm-dd-yyyy, yyyy/mm/dd, yyyy-mm-dd, or 2-digit-year
    variants of the above."""
    parts = re.split(r"[/\-]", value.strip())
    if len(parts) != 3:
        raise ParseError(f"Not a numeric date: {value!r}")
    try:
        if len(parts[0]) == 4:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            month, day, year = int(parts[0]), int(parts[1]), int(parts[2])
            if year < 100:
                year += 2000
        return date(year, month, day)
    except ValueError as exc:
        raise ParseError(f"Not a numeric date: {value!r}") from exc


def parse_date_long(value: str) -> date:
    """Parse 'Jul 01, 2026' / 'July 1, 2026' style dates."""
    match = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})", value)
    if not match:
        raise ParseError(f"Not a long-form date: {value!r}")
    month_key = match.group(1)[:3].lower()
    if month_key not in MONTH_LOOKUP:
        raise ParseError(f"Unrecognized month in: {value!r}")
    return date(int(match.group(3)), MONTH_LOOKUP[month_key], int(match.group(2)))


def parse_date_day_month_year(value: str) -> date:
    """Parse '31 March 2026' style dates (day, month name, year — no comma).
    Anchored on a real month name, unlike a bare 3-numbers-in-a-row regex,
    so it won't accidentally match invoice/account/tax-registration numbers
    elsewhere in a document."""
    match = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b", value)
    if not match:
        raise ParseError(f"Not a day-month-year date: {value!r}")
    month_key = match.group(2)[:3].lower()
    if month_key not in MONTH_LOOKUP:
        raise ParseError(f"Unrecognized month in: {value!r}")
    return date(int(match.group(3)), MONTH_LOOKUP[month_key], int(match.group(1)))


def parse_date_any(value: str) -> date:
    value = value.strip()
    if re.match(r"^\d", value) and re.search(r"[/\-]", value):
        return parse_date_numeric(value)
    return parse_date_long(value)


def to_iso(d: date) -> str:
    return d.isoformat()


def normalize_account_number(raw: str) -> str:
    """Collapse internal whitespace (accounts are sometimes printed with
    spaces between digit groups, e.g. '604 0393 200'); keep dashes/letters."""
    return re.sub(r"\s+", "", raw.strip())


def search(pattern: str, text: str, flags: int = 0) -> re.Match[str]:
    match = re.search(pattern, text, flags)
    if not match:
        raise ParseError(f"Pattern not found: {pattern}")
    return match


def find_money_after(label: str, text: str, flags: int = re.IGNORECASE) -> Decimal:
    pattern = rf"{label}[\s.:]*\$?\s*(-?[\d,]+\.\d{{2}})"
    return parse_money(search(pattern, text, flags).group(1))


def normalize_whitespace(text: str) -> str:
    text = text.replace("\xa0", " ").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()
