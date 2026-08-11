from datetime import date
from decimal import Decimal

from app.extractors.cambridge_water import CambridgeWaterExtractor

# Trimmed/synthesized text mirroring a real bill's layout (no colon after
# "Bill Issue Date", account number embedded in an unlabeled total row) —
# this exact combination broke the extractor on a real TNT Cambridge Water
# bill until both were fixed.
#
# "Current Water/Wastewater Charges" is deliberately printed *twice*, like a
# real bill: the first occurrence (right after the balance-forward summary)
# is followed by the account's total amount due, not this period's charge —
# a real layout quirk. Only the second occurrence, next to "Total Charges"
# on the remittance-stub portion, is the true per-period amount. A bill
# reached needs_review for months (confirmed on real May/Jun/Aug 2026 bills)
# because the extractor used to read the first (wrong) occurrence.
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
Current Water/Wastewater Charges
$158.08
Total Charges
$158.08
Bill Issue Date
2026/06/03
"""


def test_extracts_bill_with_no_colon_after_label():
    result = CambridgeWaterExtractor().extract(SAMPLE_TEXT)
    assert result.issue_date == date(2026, 6, 3)
    assert result.due_date == date(2026, 6, 26)
    assert result.account_number == "12345"
    assert result.previous_balance == Decimal("295.84")
    assert result.current_charges == Decimal("158.08")


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


def test_previous_plus_current_reconciles_with_total_despite_duplicate_label():
    # Regression test for the real needs_review bug: current_charges must
    # come from the second "Current Water/Wastewater Charges" occurrence
    # (next to "Total Charges"), not the first (which equals total_due and
    # would make previous+current never match total).
    result = CambridgeWaterExtractor().extract(SAMPLE_TEXT)
    assert result.previous_balance + result.current_charges == result.total_due
    assert not result.warnings
