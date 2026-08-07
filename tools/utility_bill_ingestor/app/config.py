"""Environment + YAML configuration for the utility bill ingestor."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml
from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
CONFIG_DIR = PROJECT_DIR / "config"

load_dotenv(PROJECT_DIR / ".env")


def _env(name: str, default: str | None = None) -> str | None:
    val = os.environ.get(name, default)
    return val if val is None or val != "" else default


def _env_str(name: str, default: str) -> str:
    """Like _env, but guarantees a non-None result (default is required)."""
    val = os.environ.get(name)
    return val if val else default


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None or val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    val = os.environ.get(name)
    if val is None or val == "":
        return default
    try:
        return float(val)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    inbox_dir: Path
    archive_root: Path
    data_dir: Path
    processing_dir: Path
    review_dir: Path
    failed_dir: Path
    logs_dir: Path
    enable_ocr: bool
    dry_run: bool
    stability_window_seconds: float
    amount_tolerance: float


def load_settings(*, dry_run_override: bool | None = None) -> Settings:
    supabase_url = _env("SUPABASE_URL", "") or ""
    supabase_key = _env("SUPABASE_SERVICE_ROLE_KEY", "") or ""

    inbox = Path(_env_str("UTILITY_BILL_INBOX", str(PROJECT_DIR / "data" / "inbox")))
    archive_root = Path(_env_str("UTILITY_BILL_ARCHIVE_ROOT", str(inbox.parent)))
    data_dir = Path(_env_str("UTILITY_BILL_DATA_DIR", str(PROJECT_DIR / "data")))
    if not data_dir.is_absolute():
        data_dir = (PROJECT_DIR / data_dir).resolve()

    dry_run = _env_bool("DRY_RUN", False) if dry_run_override is None else dry_run_override

    settings = Settings(
        supabase_url=supabase_url,
        supabase_service_role_key=supabase_key,
        inbox_dir=inbox,
        archive_root=archive_root,
        data_dir=data_dir,
        processing_dir=data_dir / "processing",
        review_dir=data_dir / "review",
        failed_dir=data_dir / "failed",
        logs_dir=data_dir / "logs",
        enable_ocr=_env_bool("ENABLE_OCR", False),
        dry_run=dry_run,
        stability_window_seconds=_env_float("STABILITY_WINDOW_SECONDS", 5.0),
        amount_tolerance=_env_float("AMOUNT_TOLERANCE", 0.05),
    )

    for d in (settings.processing_dir, settings.review_dir, settings.failed_dir, settings.logs_dir):
        d.mkdir(parents=True, exist_ok=True)

    return settings


def require_supabase(settings: Settings) -> None:
    if not settings.dry_run and (not settings.supabase_url or not settings.supabase_service_role_key):
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. "
            "Copy .env.example to .env and fill them in, or run with DRY_RUN=true."
        )


@dataclass(frozen=True)
class VendorConfig:
    key: str
    db_name: str
    company_id: str
    site_code: str | None
    utility_name: str
    aliases: list[str]
    accounts: list[str]
    archive_folder: str = ""

    @property
    def folder_name(self) -> str:
        return self.archive_folder or self.db_name


@dataclass(frozen=True)
class SiteConfig:
    code: str
    company_id: str
    db_location_name: str
    aliases: list[str]


@dataclass(frozen=True)
class CompanyConfig:
    company_id: str
    multi_site: bool
    sites: dict[str, SiteConfig]


def load_vendor_config(path: Path | None = None) -> dict[str, VendorConfig]:
    path = path or (CONFIG_DIR / "vendors.yaml")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, VendorConfig] = {}
    for key, entry in raw.items():
        out[key] = VendorConfig(
            key=key,
            db_name=entry["db_name"],
            company_id=entry["company_id"],
            site_code=entry.get("site_code"),
            utility_name=entry.get("utility_name", ""),
            aliases=list(entry.get("aliases", [])),
            accounts=[str(a) for a in entry.get("accounts", [])],
            archive_folder=entry.get("archive_folder", ""),
        )
    return out


def load_site_config(path: Path | None = None) -> dict[str, CompanyConfig]:
    path = path or (CONFIG_DIR / "sites.yaml")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[str, CompanyConfig] = {}
    for company_id, entry in raw.items():
        sites = {
            code: SiteConfig(
                code=code,
                company_id=company_id,
                db_location_name=site_entry["db_location_name"],
                aliases=list(site_entry.get("aliases", [])),
            )
            for code, site_entry in (entry.get("sites") or {}).items()
        }
        out[company_id] = CompanyConfig(
            company_id=company_id,
            multi_site=bool(entry.get("multi_site", False)),
            sites=sites,
        )
    return out
