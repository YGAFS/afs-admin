from datetime import date
from pathlib import Path

from app.filename_builder import (
    build_filename,
    cap_length,
    resolve_collision,
    safe_original_name,
)


def test_bill_number_format():
    name = build_filename(
        site_code="TNT", company_id="tnt", vendor_db_name="Rogers",
        issue_date=date(2026, 7, 1), bill_number="98273461",
        billing_period_start=None, billing_period_end=None,
        account_number="5-0781-2423", original_filename="scan001.pdf",
    )
    assert name == "TNT_Rogers_2026-07-01_98273461.pdf"


def test_period_format_when_no_bill_number():
    name = build_filename(
        site_code="FONTANA", company_id="zfs", vendor_db_name="FontanaWater",
        issue_date=date(2026, 7, 1), bill_number=None,
        billing_period_start=date(2026, 6, 1), billing_period_end=date(2026, 6, 30),
        account_number="10149626-106310", original_filename="scan.pdf",
    )
    assert name == "FONTANA_FontanaWater_2026-06-01_to_2026-06-30_6310.pdf"


def test_issue_date_and_account_fallback():
    name = build_filename(
        site_code="SURREY", company_id="afs", vendor_db_name="Telus",
        issue_date=date(2026, 7, 1), bill_number=None,
        billing_period_start=None, billing_period_end=None,
        account_number="6070393200", original_filename="scan.pdf",
    )
    assert name == "SURREY_Telus_2026-07-01_3200.pdf"


def test_unresolved_falls_back_to_review_prefix():
    name = build_filename(
        site_code=None, company_id=None, vendor_db_name=None,
        issue_date=None, bill_number=None,
        billing_period_start=None, billing_period_end=None,
        account_number=None, original_filename="Scanned Document (3).pdf",
    )
    assert name.startswith("REVIEW_")
    assert "Scanned-Document" in name


def test_illegal_characters_stripped():
    name = build_filename(
        site_code="TNT", company_id="tnt", vendor_db_name="Enbridge",
        issue_date=date(2026, 1, 1), bill_number="AB/12:34*",
        billing_period_start=None, billing_period_end=None,
        account_number=None, original_filename="x.pdf",
    )
    assert "/" not in name and ":" not in name and "*" not in name


def test_cap_length_preserves_extension():
    long_name = ("A" * 300) + ".pdf"
    capped = cap_length(long_name, max_len=50)
    assert len(capped) == 50
    assert capped.endswith(".pdf")


def test_resolve_collision_appends_suffix(tmp_path: Path):
    (tmp_path / "TNT_Rogers_2026-07-01_123.pdf").touch()
    resolved = resolve_collision(tmp_path, "TNT_Rogers_2026-07-01_123.pdf")
    assert resolved == "TNT_Rogers_2026-07-01_123_2.pdf"

    (tmp_path / resolved).touch()
    resolved2 = resolve_collision(tmp_path, "TNT_Rogers_2026-07-01_123.pdf")
    assert resolved2 == "TNT_Rogers_2026-07-01_123_3.pdf"


def test_resolve_collision_no_conflict(tmp_path: Path):
    assert resolve_collision(tmp_path, "brand_new.pdf") == "brand_new.pdf"


def test_safe_original_name_normalizes_spaces():
    assert safe_original_name("Scanned Document (3).pdf") == "Scanned-Document-(3)"
