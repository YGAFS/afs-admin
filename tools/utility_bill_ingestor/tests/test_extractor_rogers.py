from datetime import date
from decimal import Decimal

from app.extractors.rogers import RogersExtractor

# Trimmed/synthesized text mirroring the real "simple layout" Rogers bill
# (no "Bill number" text) — the date here previously extracted as garbage
# (year 8609) because a bare 3-numbers-in-a-row regex matched digits out of
# the GST/tax registration numbers instead of the real "31 March 2026" date.
SIMPLE_LAYOUT_TEXT = """
1 of 3
Page
Account 860900
31 March 2026
Invoice: 063066776
Total charges this month
$ 401.15
Contact Us:
GST/HST Reg.# 81578 1448
QST Reg.# 1219760775
New Charges
Balance Forward
Payments/Credits
Total Amount Due
$ 401.15
"""


def test_simple_layout_date_ignores_tax_registration_numbers():
    result = RogersExtractor().extract(SIMPLE_LAYOUT_TEXT)
    assert result.issue_date == date(2026, 3, 31)
    assert result.billing_year == 2026
    assert result.billing_month == 3


def test_simple_layout_amounts():
    result = RogersExtractor().extract(SIMPLE_LAYOUT_TEXT)
    assert result.account_number == "860900"
    assert result.current_charges == Decimal("401.15")
    assert result.total_due == Decimal("401.15")
    assert result.previous_balance == Decimal("0.00")


def test_simple_layout_without_payment_terms_falls_back_with_warning():
    # No "due within N days" line in SIMPLE_LAYOUT_TEXT -> due_date can only
    # default to issue_date, but that must come with an explicit warning
    # (it's a real data gap, not a discovered due date).
    result = RogersExtractor().extract(SIMPLE_LAYOUT_TEXT)
    assert result.due_date == date(2026, 3, 31)
    assert any("due_date defaulted" in w for w in result.warnings)


def test_simple_layout_computes_due_date_from_payment_terms():
    # Real bills of this layout state "due within 30 days of the invoice
    # date" instead of printing an explicit due date — this must be used
    # instead of silently defaulting due_date to the issue date (which
    # would make every bill look immediately overdue).
    text = SIMPLE_LAYOUT_TEXT + "\nThis invoice is due within 30 days of the invoice date.\n"
    result = RogersExtractor().extract(text)
    assert result.issue_date == date(2026, 3, 31)
    assert result.due_date == date(2026, 4, 30)
    assert not any("due_date defaulted" in w for w in result.warnings)
    assert result.confidence == 0.85
