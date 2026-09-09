from datetime import date
from decimal import Decimal

from app.extractors.us_bank import USBankExtractor


RAY_MORGAN_TEXT = """
RAY MORGAN CO
INVOICE NUMBER 590496584
DATE OF INVOICE 09/07/2026
10/01/2026
$796.30
DUE DATE
TOTAL DUE
RAY MORGAN CO
Customer Credit Account Number 2082868
500-0674116-000
08/01/2026 - 09/01/2026
BASE PAYMENT
314.64
"""


def test_ray_morgan_us_bank_statement_is_parsed():
    result = USBankExtractor().extract(RAY_MORGAN_TEXT)

    assert result.vendor_name == "US Bank"
    assert result.account_number == "2082868"
    assert result.bill_number == "590496584"
    assert result.issue_date == date(2026, 9, 7)
    assert result.due_date == date(2026, 10, 1)
    assert result.current_charges == Decimal("796.30")
    assert result.total_due == Decimal("796.30")
    assert result.currency == "USD"


def test_ray_morgan_detector_requires_the_recurring_statement_markers():
    assert USBankExtractor().can_handle(RAY_MORGAN_TEXT) == 0.95
    assert USBankExtractor().can_handle("Ray Morgan Co invoice") == 0.0
