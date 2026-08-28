from datetime import date
from decimal import Decimal

from app.extractors.base import ParsedBill
from app.repository import bill_payload_from_parsed


def _parsed(**overrides) -> ParsedBill:
    defaults = dict(
        vendor_name="Test Vendor",
        account_number="12345",
        issue_date=date(2026, 7, 1),
        due_date=date(2026, 7, 21),
        billing_month=7,
        billing_year=2026,
        previous_balance=Decimal("0.00"),
        current_charges=Decimal("100.00"),
        total_due=Decimal("100.00"),
        currency="USD",
        confidence=0.9,
    )
    defaults.update(overrides)
    return ParsedBill(**defaults)


def test_payment_that_fully_settles_previous_balance_zeroes_it_out():
    # Mirrors the Fontana Water case: previous_balance already cleared by a
    # matching payment shown on the same statement -> must not resurrect that
    # old balance on the newly-registered bill, and the payment itself doesn't
    # count as having paid down this period's fresh current_charges.
    parsed = _parsed(
        previous_balance=Decimal("1713.35"),
        current_charges=Decimal("777.04"),
        payments_received=Decimal("1713.35"),
        total_due=Decimal("777.04"),
    )
    payload = bill_payload_from_parsed(
        company_id="zfs", utility_name="Water", provider="Fontana Water",
        parsed=parsed, location_id=None, service_account_id=None,
    )
    assert payload["previous_balance"] == 0
    assert payload["amount_paid"] == 0
    assert payload["remaining_balance"] == 777.04
    assert payload["is_paid"] is False


def test_payment_larger_than_previous_balance_leaves_excess_as_amount_paid():
    parsed = _parsed(
        previous_balance=Decimal("100.00"),
        current_charges=Decimal("50.00"),
        payments_received=Decimal("120.00"),
        total_due=Decimal("50.00"),
    )
    payload = bill_payload_from_parsed(
        company_id="zfs", utility_name="Water", provider="Fontana Water",
        parsed=parsed, location_id=None, service_account_id=None,
    )
    assert payload["previous_balance"] == 0
    assert payload["amount_paid"] == 20.00
    assert payload["remaining_balance"] == 30.00


def test_already_paid_vendor_registers_full_charge_as_paid():
    # Mirrors the Orkin case: total_due deliberately left unset (misleading $0
    # printed total), already_paid=True instead.
    parsed = _parsed(
        previous_balance=Decimal("0.00"),
        current_charges=Decimal("227.86"),
        total_due=None,
        already_paid=True,
    )
    payload = bill_payload_from_parsed(
        company_id="zfs", utility_name="Pest Control", provider="Orkin",
        parsed=parsed, location_id=None, service_account_id=None,
    )
    assert payload["amount"] == 227.86
    assert payload["total_due"] == 227.86
    assert payload["amount_paid"] == 227.86
    assert payload["remaining_balance"] == 0
    assert payload["is_auto_pay"] is True
    assert payload["is_paid"] is True
    assert payload["balance_status"] == "paid"


def test_auto_pay_bill_is_registered_as_paid():
    payload = bill_payload_from_parsed(
        company_id="zfs", utility_name="Water", provider="Fontana Water",
        parsed=_parsed(), location_id=None, service_account_id=None, auto_pay=True,
    )
    assert payload["is_auto_pay"] is True
    assert payload["is_paid"] is True
    assert payload["balance_status"] == "paid"
    assert payload["amount_paid"] == 100.0
    assert payload["remaining_balance"] == 0
