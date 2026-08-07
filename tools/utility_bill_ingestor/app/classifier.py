"""Resolve a ParsedBill to a specific vendors.yaml entry (which carries the
authoritative company_id + site_code + db vendor name).

Priority, per spec:
  1. account number -> exact vendors.yaml `accounts` match (highest confidence)
  2. vendor name/alias match, disambiguated by site/company alias text
     found in the body (covers "service address" and "customer/company
     name" signals — both live in sites.yaml aliases)
  3. vendor name/alias match with only one possible company -> accept
  4. anything else -> unresolved (never guess between two same-name
     vendors, e.g. Rogers AFS vs Rogers TNT, without account or site
     evidence)
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.config import CompanyConfig, VendorConfig
from app.extractors.base import ParsedBill
from app.logging_config import mask_account
from app.normalizer import normalize_account_number


@dataclass
class ClassificationResult:
    vendor_key: str | None
    vendor_cfg: VendorConfig | None
    company_id: str | None
    site_code: str | None
    method: str
    confidence: float
    warnings: list[str] = field(default_factory=list)


def classify(
    parsed: ParsedBill,
    text: str,
    vendors: dict[str, VendorConfig],
    sites: dict[str, CompanyConfig],
) -> ClassificationResult:
    warnings: list[str] = []
    text_low = text.lower()

    # 1. Account number — highest-confidence signal.
    if parsed.account_number:
        norm_acct = normalize_account_number(parsed.account_number)
        acct_matches = [
            v for v in vendors.values()
            if norm_acct in (normalize_account_number(a) for a in v.accounts)
        ]
        if len(acct_matches) == 1:
            v = acct_matches[0]
            return ClassificationResult(v.key, v, v.company_id, v.site_code, "account_number", 0.99, warnings)
        if len(acct_matches) > 1:
            warnings.append(
                f"account {mask_account(norm_acct)} matched multiple vendor configs: "
                f"{[v.key for v in acct_matches]} — ambiguous config, fix vendors.yaml"
            )

    # Candidate vendors by declared name / text alias.
    if parsed.vendor_name:
        name_candidates = [
            v for v in vendors.values()
            if v.db_name.lower() == parsed.vendor_name.lower()
            or any(alias.lower() in text_low for alias in v.aliases)
        ]
    else:
        name_candidates = [
            v for v in vendors.values() if any(alias.lower() in text_low for alias in v.aliases)
        ]

    if not name_candidates:
        return ClassificationResult(None, None, None, None, "unresolved", 0.0, warnings + ["vendor not recognized"])

    if len(name_candidates) == 1:
        v = name_candidates[0]
        return ClassificationResult(v.key, v, v.company_id, v.site_code, "vendor_alias_unique", 0.7, warnings)

    # 2. Multiple vendors share this name/alias (e.g. Rogers AFS vs TNT) —
    # disambiguate using each candidate's site/company aliases in the body.
    site_matches = []
    for v in name_candidates:
        company_cfg = sites.get(v.company_id)
        site_cfg = company_cfg.sites.get(v.site_code) if (company_cfg and v.site_code) else None
        if site_cfg and any(alias.lower() in text_low for alias in site_cfg.aliases):
            site_matches.append(v)

    if len(site_matches) == 1:
        v = site_matches[0]
        return ClassificationResult(v.key, v, v.company_id, v.site_code, "site_alias", 0.85, warnings)

    warnings.append(
        f"vendor matched multiple configs ({[v.key for v in name_candidates]}) and "
        "site/company text could not disambiguate — needs manual review"
    )
    return ClassificationResult(None, None, None, None, "unresolved", 0.2, warnings)
