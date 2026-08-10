from datetime import date
from decimal import Decimal

from app.extractors.fontana_water import FontanaWaterExtractor

# Trimmed/synthesized text mirroring a real Fontana Water bill where the previous
# balance was already paid off before this statement was generated — the printed
# Sys_Balance (total) legitimately excludes it.
PREVIOUS_BALANCE_ALREADY_PAID_TEXT = """
Water Service
1" Meter Service Charge
$56.94
Total Current Charges
$777.04
Customer/Account Number:
10149626-106310
[Sys_Acct_ID=106310]
[Sys_DocDate=7/27/2026]
[Sys_DueDate=8/15/2026]
[CustNum=10149626]
[PrevBal=1713.35]
Amount Now Due
Previous Balance
$1,713.35
07/13/2026 Payment, Thank you
$-1,713.35
Total Current Charges
$777.04
[Sys_Balance=777.04]
"""


def test_settled_previous_balance_extracts_payment_and_reconciles():
    result = FontanaWaterExtractor().extract(PREVIOUS_BALANCE_ALREADY_PAID_TEXT)
    assert result.previous_balance == Decimal("1713.35")
    assert result.current_charges == Decimal("777.04")
    assert result.payments_received == Decimal("1713.35")
    assert result.total_due == Decimal("777.04")
    # previous + current - payments == total -> no reconciliation warning, so this
    # no longer needlessly lands in needs_review.
    assert result.warnings == []
    assert result.account_number == "10149626-106310"
    assert result.issue_date == date(2026, 7, 27)


def test_unreconciled_amounts_still_warn():
    # No "Payment, Thank you" line -> previous + current genuinely doesn't match
    # total, and that must still be flagged, not silently swallowed.
    text = PREVIOUS_BALANCE_ALREADY_PAID_TEXT.replace(
        "07/13/2026 Payment, Thank you\n$-1,713.35\n", ""
    )
    result = FontanaWaterExtractor().extract(text)
    assert result.payments_received is None
    assert any("!= total" in w for w in result.warnings)
