from datetime import date
from decimal import Decimal

from app.extractors import pick_extractor
from app.extractors.generic import GenericExtractor
from app.extractors.telus import TelusExtractor


def test_generic_extractor_never_raises_on_garbage_text():
    result = GenericExtractor().extract("this is not a bill at all, just random text")
    assert result.total_due is None
    assert result.confidence == 0.1
    assert "parsed by generic extractor — always needs_review" in result.warnings


def test_generic_extractor_finds_common_fields():
    text = (
        "Some Random Company Inc.\n"
        "Bill Date: 07/01/2026\n"
        "Account Number: 12345678\n"
        "Due Date: 07/21/2026\n"
        "Total Amount Due: $123.45\n"
    )
    result = GenericExtractor().extract(text)
    assert result.total_due == Decimal("123.45")
    assert result.account_number == "12345678"
    assert result.due_date == date(2026, 7, 21)
    assert result.issue_date == date(2026, 7, 1)


def test_pick_extractor_falls_back_to_generic_for_unknown_vendor():
    extractor, confidence = pick_extractor("Some Random Utility Co bill text")
    assert extractor.vendor_key == "generic"


def test_pick_extractor_prefers_known_vendor():
    extractor, confidence = pick_extractor("Your TELUS bill for account 12345")
    assert extractor.vendor_key == "telus"
    assert confidence > 0


def test_telus_can_handle_scores_zero_for_other_text():
    assert TelusExtractor().can_handle("this mentions Rogers only") == 0.0
