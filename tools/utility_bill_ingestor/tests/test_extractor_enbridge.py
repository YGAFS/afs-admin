from datetime import date
from decimal import Decimal

from app.extractors.enbridge import EnbridgeExtractor


def test_enbridge_layout_with_other_charges_and_due_date():
    text = """
    Enbridge Gas Inc.
    Account Number Bill Date
    91 00 70 21073 2 Nov 02, 2026
    Billing Period Sep 30, 2026 - Oct 29, 2026
    Total Amount $602.87
    Total Amount Due $602.87
    Due Date
    Nov 23, 2026 approx.
    Balance Forward $0.00
    Charges for Natural Gas $432.30
    Other Enbridge Charges $170.57
    """

    result = EnbridgeExtractor().extract(text)

    assert result.account_number == "910070210732"
    assert result.issue_date == date(2026, 11, 2)
    assert result.due_date == date(2026, 11, 23)
    assert result.current_charges == Decimal("602.87")
    assert result.total_due == Decimal("602.87")
    assert result.warnings == []
