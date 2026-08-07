from datetime import date
from decimal import Decimal

import pytest

from app.normalizer import (
    ParseError,
    format_money,
    normalize_account_number,
    parse_date_any,
    parse_date_day_month_year,
    parse_date_long,
    parse_date_numeric,
    parse_money,
)


@pytest.mark.parametrize("raw,expected", [
    ("$1,234.56", Decimal("1234.56")),
    ("1234.56", Decimal("1234.56")),
    ("(45.00)", Decimal("-45.00")),
    ("-12.50", Decimal("-12.50")),
    ("$0.00", Decimal("0.00")),
])
def test_parse_money(raw, expected):
    assert parse_money(raw) == expected


def test_parse_money_invalid():
    with pytest.raises(ParseError):
        parse_money("not a number")


def test_format_money():
    assert format_money(Decimal("1234.5")) == "1234.50"


@pytest.mark.parametrize("raw,expected", [
    ("07/01/2026", date(2026, 7, 1)),
    ("2026/07/01", date(2026, 7, 1)),
    ("07-01-26", date(2026, 7, 1)),
])
def test_parse_date_numeric(raw, expected):
    assert parse_date_numeric(raw) == expected


def test_parse_date_long():
    assert parse_date_long("Jul 01, 2026") == date(2026, 7, 1)
    assert parse_date_long("July 1, 2026") == date(2026, 7, 1)


def test_parse_date_any_dispatches():
    assert parse_date_any("07/01/2026") == date(2026, 7, 1)
    assert parse_date_any("Jul 01, 2026") == date(2026, 7, 1)


def test_parse_date_day_month_year():
    assert parse_date_day_month_year("31 March 2026") == date(2026, 3, 31)


def test_parse_date_day_month_year_ignores_nearby_digit_runs():
    # Regression: a bare "\d{1,2}\s+\d{1,2}\s+\d{4}" regex would match
    # "81578 1448" out of an unrelated tax-registration number here instead
    # of the real date further down.
    text = "GST/HST Reg.# 81578 1448\nInvoice: 063066776\n31 March 2026\nAccount 860900"
    assert parse_date_day_month_year(text) == date(2026, 3, 31)


def test_parse_date_invalid():
    with pytest.raises(ParseError):
        parse_date_numeric("not/a/date")


def test_normalize_account_number_strips_internal_spaces():
    assert normalize_account_number("604 0393 200") == "6040393200"
    assert normalize_account_number(" 5-0781-2423 ") == "5-0781-2423"
