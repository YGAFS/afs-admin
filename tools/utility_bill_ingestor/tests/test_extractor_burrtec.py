from datetime import date
from decimal import Decimal

from app.extractors.burrtec import BurrtecExtractor

# Trimmed/synthesized text mirroring a real Burrtec bill's layout: labels
# and values in separate blocks, and "Due By" is the text "Due Upon
# Receipt" rather than a date.
SAMPLE_TEXT = """
Customer Number
Service Period
Due By
Total Due
136675222
Due Upon Receipt
$717.91
Customer Number
Invoice Number
Service Period
Statement Date
136675222
S210011687
04/30/26
Zenith Fortio Services, Inc
Total Amount Due
717.91
Last Payment Received on 03/15/26 for 564.62
"""


def test_extracts_statement_date_and_treats_due_upon_receipt_as_immediate():
    result = BurrtecExtractor().extract(SAMPLE_TEXT)
    assert result.issue_date == date(2026, 4, 30)
    assert result.due_date == date(2026, 4, 30)


def test_extracts_total_and_account():
    result = BurrtecExtractor().extract(SAMPLE_TEXT)
    assert result.account_number == "136675222"
    assert result.total_due == Decimal("717.91")
    assert result.current_charges == Decimal("717.91")
    assert result.confidence == 0.8


def test_does_not_confuse_last_payment_date_with_statement_date():
    # Regression: "Last Payment Received on 03/15/26" also matches
    # MM/DD/YY — it comes later in the text and must not be picked up
    # instead of the real statement date (04/30/26).
    result = BurrtecExtractor().extract(SAMPLE_TEXT)
    assert result.issue_date != date(2026, 3, 15)


# Trimmed/synthesized text mirroring a real bill with a previous-balance
# breakdown: a "Total Previous Balance" fully cleared by a same-statement
# "Payment - Thank You" line, then a "Current Charges" section listing this
# period's real line items — including one whose *quantity* (2.38 tons) has
# 2 decimal places, same as a dollar amount, to guard against miscounting it
# as a charge. This exact shape (account 136675222, March 2026) went
# needs_review for months because current_charges came out as $721.15
# instead of $717.91 — the stray quantity 2.38 + 0.86 = 3.24 too much.
BREAKDOWN_TEXT = """
Customer Number
Service Period
Due By
Total Due
136675222
Due Upon Receipt
$717.91
Customer Number
Invoice Number
Service Period
Statement Date
136675222
N2140206906
03/31/26
Total Previous Balance
564.62
Other Charges and Payments
03/15/26
Payment - Thank You
564.62
Current Charges
For Service at: 11099 Almond Ave
03/19/26
1
Load (WO-4206034)
286.58
03/19/26
2.38
Dump Fees (WO-4206034)
242.74
03/20/26
1
Dry Run (WO-4207243)
100.88
03/31/26
0.86
Dump Fees (WO-4211283)
87.71
Total Amount Due - DO NOT PAY
717.91
"""


def test_current_charges_sums_line_items_not_stray_decimal_quantities():
    result = BurrtecExtractor().extract(BREAKDOWN_TEXT)
    assert result.current_charges == Decimal("717.91")
    assert result.previous_balance == Decimal("0.00")
    assert result.total_due == Decimal("717.91")
    assert not result.warnings
