from app.classifier import classify
from app.config import CompanyConfig, SiteConfig, VendorConfig
from app.extractors.base import ParsedBill

ROGERS_AFS = VendorConfig(
    key="rogers_afs", db_name="Rogers", company_id="afs", site_code="SURREY",
    utility_name="Business Phone", aliases=["Rogers", "Rogers Communications"],
    accounts=["5-0781-2423"],
)
ROGERS_TNT = VendorConfig(
    key="rogers_tnt", db_name="Rogers", company_id="tnt", site_code="CAMBRIDGE",
    utility_name="Internet", aliases=["Rogers", "Rogers Communications"], accounts=[],
)
TELUS_AFS = VendorConfig(
    key="telus_afs", db_name="Telus", company_id="afs", site_code="SURREY",
    utility_name="Internet (Wifi)", aliases=["Telus", "TELUS"], accounts=["6070393200"],
)

VENDORS = {"rogers_afs": ROGERS_AFS, "rogers_tnt": ROGERS_TNT, "telus_afs": TELUS_AFS}

SITES = {
    "afs": CompanyConfig(company_id="afs", multi_site=False, sites={
        "SURREY": SiteConfig(code="SURREY", company_id="afs", db_location_name="Surrey Office", aliases=["Surrey"]),
    }),
    "tnt": CompanyConfig(company_id="tnt", multi_site=True, sites={
        "CAMBRIDGE": SiteConfig(code="CAMBRIDGE", company_id="tnt", db_location_name="Cambridge", aliases=["Cambridge"]),
    }),
}


def test_known_account_number_resolves_unambiguously():
    parsed = ParsedBill(vendor_name="Rogers", account_number="5-0781-2423")
    result = classify(parsed, "some rogers bill text", VENDORS, SITES)
    assert result.vendor_key == "rogers_afs"
    assert result.method == "account_number"
    assert result.confidence > 0.9


def test_unknown_account_falls_back_to_alias_and_site_text():
    parsed = ParsedBill(vendor_name="Rogers", account_number="9999999999")
    result = classify(parsed, "Rogers bill for our Cambridge office", VENDORS, SITES)
    assert result.vendor_key == "rogers_tnt"
    assert result.method == "site_alias"


def test_ambiguous_vendor_without_site_evidence_is_unresolved():
    parsed = ParsedBill(vendor_name="Rogers", account_number=None)
    result = classify(parsed, "Rogers Communications monthly invoice", VENDORS, SITES)
    assert result.vendor_key is None
    assert result.method == "unresolved"
    assert result.warnings


def test_single_candidate_vendor_resolves_without_site_evidence():
    parsed = ParsedBill(vendor_name="Telus", account_number=None)
    result = classify(parsed, "Your TELUS bill", VENDORS, SITES)
    assert result.vendor_key == "telus_afs"
    assert result.method == "vendor_alias_unique"


def test_completely_unknown_vendor_is_unresolved():
    parsed = ParsedBill(vendor_name=None, account_number=None)
    result = classify(parsed, "some random text with no known vendor", VENDORS, SITES)
    assert result.vendor_key is None
    assert result.method == "unresolved"
