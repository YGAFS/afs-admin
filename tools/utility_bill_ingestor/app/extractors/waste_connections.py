"""Waste Connections of Canada (TNT Cambridge - waste disposal)."""
from __future__ import annotations

import re

from app.extractors.base import ParsedBill
from app.normalizer import parse_date_numeric, parse_money


class WasteConnectionsExtractor:
    vendor_key = "waste_connections"

    def can_handle(self, text: str) -> float:
        low = text.lower()
        return 0.95 if "waste connections of canada" in low else 0.0

    def extract(self, text: str) -> ParsedBill:
        warnings: list[str] = []

        account_match = re.search(r"ACCOUNT\s+NO\.?\s*\n?\s*([\d-]+)", text, re.IGNORECASE)
        account = account_match.group(1) if account_match else None
        if not account:
            warnings.append("account_number not found")

        # The first date is the invoice/statement date. Later dates are
        # service periods and surcharge dates.
        date_match = re.search(r"\b(\d{2}/\d{2}/\d{2})\b", text)
        issue_date = parse_date_numeric(date_match.group(1)) if date_match else None
        if not issue_date:
            warnings.append("issue_date not found")

        bill_match = re.search(r"\b\d{4}-\d{10}\b", text)
        bill_number = bill_match.group(0) if bill_match else None
        if not bill_number:
            warnings.append("bill_number not found")

        # Site total is the current invoice amount before any prior-balance
        # aging shown on the remittance stub. The final HST line gives the tax
        # and the following amount is the invoice total.
        tax_match = re.search(
            r"\n\s*\$?\s*([\d,]+\.\d{2})\s*\n\s*\$?\s*[\d,]+\.\d{2}\s*\n"
            r"Ontario\s+HST[^\n]*\n\s*\$?\s*[\d,]+\.\d{2}\s*\n\s*SITE TOTAL",
            text,
            re.IGNORECASE,
        )
        total_match = re.search(
            r"TOTAL THIS INVOICE DUE\s*\n\s*\$?\s*([\d,]+\.\d{2})",
            text,
            re.IGNORECASE,
        )
        subtotal_match = re.search(
            r"\n\s*\$?\s*([\d,]+\.\d{2})\s*\nOntario\s+HST",
            text,
            re.IGNORECASE,
        )
        tax = parse_money(tax_match.group(1)) if tax_match else None
        total = parse_money(total_match.group(1)) if total_match else None
        subtotal = parse_money(subtotal_match.group(1)) if subtotal_match else None

        if tax is None:
            warnings.append("tax_amount not found")
        if total is None:
            warnings.append("total_due not found")
        if subtotal is None:
            warnings.append("current_charges subtotal not found")

        # Interest is printed after SITE TOTAL on invoices where an overdue
        # prior balance was carried forward. It is part of this invoice's due
        # amount, so retain it as late_fee for the dashboard ledger.
        late_match = re.search(r"Interest\s+Charge\s*\n\s*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
        late_fee = parse_money(late_match.group(1)) if late_match else None

        if total is not None and subtotal is not None and tax is not None and late_fee:
            if subtotal + tax + late_fee != total:
                warnings.append(f"subtotal({subtotal}) + tax({tax}) + late_fee({late_fee}) != total({total})")
        elif total is not None and subtotal is not None and tax is not None:
            if subtotal + tax != total:
                warnings.append(f"subtotal({subtotal}) + tax({tax}) != total({total})")

        return ParsedBill(
            vendor_name="Waste Connections",
            account_number=account,
            bill_number=bill_number,
            issue_date=issue_date,
            due_date=issue_date,  # The bill says DUE UPON RECEIPT.
            billing_month=issue_date.month if issue_date else None,
            billing_year=issue_date.year if issue_date else None,
            current_charges=subtotal,
            tax_amount=tax,
            late_fee=late_fee,
            total_due=total,
            currency="CAD",
            confidence=0.9 if account and issue_date and bill_number and total is not None else 0.5,
            warnings=warnings,
        )
