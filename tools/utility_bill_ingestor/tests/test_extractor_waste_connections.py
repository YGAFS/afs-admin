from datetime import date
from decimal import Decimal

from app.extractors.waste_connections import WasteConnectionsExtractor


SAMPLE_TEXT = """
WASTE CONNECTIONS OF CANADA INC.
ACCOUNT NO.
7121-072918-0000
7121-0000760990
03/31/26
(0001) TNT EXPRESS LINES
255 HOLIDAY INN DR, CAMBRIDGE ON
$240.58
$1,850.61
Ontario HST 866808298RT0003
$2,091.19
SITE TOTAL
TOTAL THIS INVOICE DUE
$2,091.19
"""


def test_extracts_waste_connections_bill():
    result = WasteConnectionsExtractor().extract(SAMPLE_TEXT)
    assert result.account_number == "7121-072918-0000"
    assert result.bill_number == "7121-0000760990"
    assert result.issue_date == date(2026, 3, 31)
    assert result.due_date == date(2026, 3, 31)
    assert result.current_charges == Decimal("1850.61")
    assert result.tax_amount == Decimal("240.58")
    assert result.total_due == Decimal("2091.19")
    assert not result.warnings


def test_extracts_late_fee_when_present():
    text = SAMPLE_TEXT.replace("$2,091.19\n$1,850.61", "$2,091.19\n$1,850.61") + "\nInterest Charge\n$30.58\n"
    result = WasteConnectionsExtractor().extract(text)
    assert result.late_fee == Decimal("30.58")
