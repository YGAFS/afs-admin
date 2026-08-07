from datetime import date
from decimal import Decimal

from app.extractors.cambridge_water import CambridgeWaterExtractor

# Trimmed/synthesized text mirroring a real bill's layout (no colon after
# "Bill Issue Date", account number embedded in an unlabeled total row) —
# this exact combination broke the extractor on a real TNT Cambridge Water
# bill until both were fixed.
SAMPLE_TEXT = """
Account Number:
12345
Total Amount Due:
Customer Name:
SAMPLE PROPERTIES INC
Previous Balance
Payment Received
Adjustments/Other Charges
Balance Forward
Reading Date
Reading
Consumption
$230.37
$ .00
$65.47
$295.84
Current Water/Wastewater Charges
$453.92
12345
$453.92
Jun 26, 2026
Due Date:
Jun 26, 2026
Bill Issue Date
2026/06/03
"""


def test_extracts_bill_with_no_colon_after_label():
    result = CambridgeWaterExtractor().extract(SAMPLE_TEXT)
    assert result.issue_date == date(2026, 6, 3)
    assert result.due_date == date(2026, 6, 26)
    assert result.account_number == "12345"
    assert result.previous_balance == Decimal("295.84")
    assert result.current_charges == Decimal("453.92")


def test_total_uses_the_actual_parsed_account_not_a_hardcoded_one():
    # Regression test: the extractor this was ported from hardcoded a
    # specific account number ("69661") when finding the total-due row.
    result = CambridgeWaterExtractor().extract(SAMPLE_TEXT)
    assert result.total_due == Decimal("453.92")
    assert "total_due fell back to previous+current" not in " ".join(result.warnings)


def test_different_account_number_still_finds_its_total_row():
    text = SAMPLE_TEXT.replace("12345", "99999")
    result = CambridgeWaterExtractor().extract(text)
    assert result.account_number == "99999"
    assert result.total_due == Decimal("453.92")
