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
