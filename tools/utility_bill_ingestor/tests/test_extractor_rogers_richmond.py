from datetime import date
from decimal import Decimal

from app.extractors.rogers import RogersExtractor


def test_business_tabular_layout_reads_richmond_october_bill():
    text = """
    Account number Bill number Bank Payment ID Bill date Page
    5-0860-8702 3253561439 50860870208 Oct 22, 2026 1 of 8
    Total Due
    Balance from last bill 115.06
    Payments Oct 06 -115.06
    Adjustments Refer to page 2> 226.00
    Balance brought forward 226.00
    This bill
    Total(Includes taxes) -2.54
    Total amount due $223.46
    Required Payment Date: Nov 13, 2026
    """

    result = RogersExtractor().extract(text)

    assert result.account_number == "5-0860-8702"
    assert result.issue_date == date(2026, 10, 22)
    assert result.due_date == date(2026, 11, 13)
    assert result.previous_balance == Decimal("226.00")
    assert result.current_charges == Decimal("-2.54")
    assert result.adjustments == Decimal("0.00")
    assert result.total_due == Decimal("223.46")
    assert result.warnings == []


def test_business_account_without_separators_is_formatted():
    text = """
    Account number Bill number Bank Payment ID Bill date
    507812423 1234567890 50860870208 Oct 05, 2026
    Required Payment Date: Oct 27, 2026
    Balance brought forward 0.00
    Adjustments Refer to page 2> 0.00
    Total(Includes taxes) 60.32
    Total Due 60.32
    """

    result = RogersExtractor().extract(text)

    assert result.account_number == "5-0781-2423"
