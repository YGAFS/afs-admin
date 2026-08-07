"""Registry of all known-vendor extractors, tried in order, plus the
generic fallback. To add a new vendor: write a new module in this package
implementing BillExtractor (see base.py), then add an instance to
KNOWN_EXTRACTORS below. See README.md → "Adding a new vendor extractor"."""
from __future__ import annotations

from app.extractors.base import BillExtractor
from app.extractors.burrtec import BurrtecExtractor
from app.extractors.cambridge_water import CambridgeWaterExtractor
from app.extractors.enbridge import EnbridgeExtractor
from app.extractors.fontana_water import FontanaWaterExtractor
from app.extractors.generic import GenericExtractor
from app.extractors.grandbridge import GrandbridgeExtractor
from app.extractors.orkin import OrkinExtractor
from app.extractors.rogers import RogersExtractor
from app.extractors.telus import TelusExtractor

KNOWN_EXTRACTORS: list[BillExtractor] = [
    TelusExtractor(),
    RogersExtractor(),
    EnbridgeExtractor(),
    GrandbridgeExtractor(),
    CambridgeWaterExtractor(),
    FontanaWaterExtractor(),
    BurrtecExtractor(),
    OrkinExtractor(),
]

GENERIC_EXTRACTOR: BillExtractor = GenericExtractor()


def pick_extractor(text: str) -> tuple[BillExtractor, float]:
    """Return the best-matching extractor and its confidence. Falls back to
    the generic extractor if nothing scores above 0."""
    best: BillExtractor | None = None
    best_score = 0.0
    for extractor in KNOWN_EXTRACTORS:
        score = extractor.can_handle(text)
        if score > best_score:
            best, best_score = extractor, score
    if best is None:
        return GENERIC_EXTRACTOR, GENERIC_EXTRACTOR.can_handle(text)
    return best, best_score
