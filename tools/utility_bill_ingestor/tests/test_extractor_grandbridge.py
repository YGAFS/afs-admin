from datetime import date
from decimal import Decimal

from app.extractors.grandbridge import GrandbridgeExtractor

OLD_LAYOUT = """
TNT BRITISH COLUMBIA EXPRESS LINE & TOWING
Account Number:00009762-04
This statement was issued on:Apr 22, 2026
Due Date:May 15, 2026
Balance Forward
$0.00
Current Charges
$2,500.10
Total Amount Due
$2,500.10
"""

# Newer OEB-style layout: label and value on separate lines (a real bill
# broke on this — the ported regexes assumed same-line "Label:Value"), and
# no "Current Charges" line at all, only a per-item breakdown.
NEW_LAYOUT = """
TNT BRITISH COLUMBIA EXPRESS LINE & TOWING
Account Number:
00009762-04
This statement was issued on:
Apr 22, 2026
Account Number:
00009762-04
Due Date:
May 15, 2026
Amount Due:
$2,500.10
Balance Forward
$0.00
Previous Balance
$2,303.55
Payment Received - Thank You
($2,303.55)
Your Electricity Charges
Electricity
$1,763.19
Delivery
$961.49
"""


def test_old_layout_with_current_charges_line():
    result = GrandbridgeExtractor().extract(OLD_LAYOUT)
    assert result.account_number == "00009762-04"
    assert result.issue_date == date(2026, 4, 22)
    assert result.due_date == date(2026, 5, 15)
    assert result.previous_balance == Decimal("0.00")
    assert result.current_charges == Decimal("2500.10")
    assert result.total_due == Decimal("2500.10")
    assert result.confidence == 0.9


def test_new_layout_without_current_charges_line_derives_it():
    result = GrandbridgeExtractor().extract(NEW_LAYOUT)
    assert result.account_number == "00009762-04"
    assert result.issue_date == date(2026, 4, 22)
    assert result.due_date == date(2026, 5, 15)
    assert result.total_due == Decimal("2500.10")
    # current_charges = total - previous(Balance Forward) = 2500.10 - 0.00
    assert result.current_charges == Decimal("2500.10")
    assert result.confidence == 0.7
    assert any("derived as total - previous" in w for w in result.warnings)
