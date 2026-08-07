from datetime import date
from decimal import Decimal

from app.classifier import ClassificationResult
from app.config import VendorConfig
from app.extractors.base import ParsedBill
from app.validator import DuplicateInfo, validate

VENDOR = VendorConfig(
    key="rogers_afs", db_name="Rogers", company_id="afs", site_code="SURREY",
    utility_name="Business Phone", aliases=["Rogers"], accounts=["5-0781-2423"],
)


def _classification(**overrides) -> ClassificationResult:
    base = dict(
        vendor_key="rogers_afs", vendor_cfg=VENDOR, company_id="afs",
        site_code="SURREY", method="account_number", confidence=0.99, warnings=[],
    )
    base.update(overrides)
    return ClassificationResult(**base)


def _clean_bill(**overrides) -> ParsedBill:
    base = dict(
        vendor_name="Rogers", account_number="5-0781-2423", bill_number="123456",
        issue_date=date(2026, 7, 1), due_date=date(2026, 7, 21),
        previous_balance=Decimal("0.00"), current_charges=Decimal("100.00"),
        total_due=Decimal("100.00"), currency="CAD", confidence=0.9, warnings=[],
    )
    base.update(overrides)
    return ParsedBill(**base)


def test_clean_bill_completes():
    result = validate(
        _clean_bill(), _classification(), DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "completed"
    assert not result.errors


def test_missing_issue_date_needs_review():
    result = validate(
        _clean_bill(issue_date=None), _classification(), DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "needs_review"
    assert any("issue_date" in e for e in result.errors)


def test_missing_total_needs_review():
    result = validate(
        _clean_bill(total_due=None, current_charges=None), _classification(), DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "needs_review"
    assert any("total amount" in e for e in result.errors)


def test_unresolved_vendor_needs_review():
    unresolved = ClassificationResult(
        vendor_key=None, vendor_cfg=None, company_id=None, site_code=None,
        method="unresolved", confidence=0.0, warnings=["vendor not recognized"],
    )
    result = validate(
        _clean_bill(), unresolved, DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "needs_review"


def test_generic_extractor_always_needs_review():
    result = validate(
        _clean_bill(), _classification(), DuplicateInfo(),
        is_generic=True, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "needs_review"


def test_exact_file_hash_duplicate():
    result = validate(
        _clean_bill(), _classification(), DuplicateInfo(exact_file_hash_match=True),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "duplicate"


def test_sum_mismatch_triggers_review():
    bill = _clean_bill(previous_balance=Decimal("50.00"), current_charges=Decimal("100.00"), total_due=Decimal("100.00"))
    result = validate(
        bill, _classification(), DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "needs_review"
    assert any("balance components" in w for w in result.warnings)


def test_sum_within_tolerance_completes():
    bill = _clean_bill(previous_balance=Decimal("0.00"), current_charges=Decimal("100.02"), total_due=Decimal("100.00"))
    result = validate(
        bill, _classification(), DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "completed"


def test_existing_bill_with_different_amount_never_silently_overwrites():
    dup = DuplicateInfo(matched_bill_id="abc-123", matched_by="bill_number", amount_differs=True)
    result = validate(
        _clean_bill(), _classification(), dup,
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    assert result.status == "needs_review"
    assert any("already exists" in w for w in result.warnings)


def test_negative_total_is_warning_not_hard_failure():
    bill = _clean_bill(total_due=Decimal("-50.00"), current_charges=Decimal("-50.00"))
    result = validate(
        bill, _classification(), DuplicateInfo(),
        is_generic=False, amount_tolerance=Decimal("0.05"),
    )
    # Still routed to review (conservative policy: any warning -> review),
    # but not a hard error.
    assert result.status == "needs_review"
    assert not result.errors
