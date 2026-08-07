"""Polling-based inbox watcher.

Deliberately polling rather than OS file-system events: the whole point of
the stability check is "has nothing happened to this file for N seconds",
which a pure event-driven watcher can't express directly anyway, and
polling is far more predictable across OneDrive-synced folders and network
drives (where native fs-event backends are often unreliable).
"""
from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings
from app.logging_config import get_logger
from app.pipeline import Pipeline

log = get_logger()

POLL_INTERVAL_SECONDS = 1.5

# Files to ignore outright: partial downloads, temp files, Office lock
# files, OneDrive conflict copies, hidden/system files.
IGNORE_PATTERNS = (
    ".tmp", ".crdownload", ".partial", ".part", ".download",
)


def _is_ignorable(path: Path) -> bool:
    name = path.name
    if name.startswith("~$") or name.startswith("."):
        return True
    lower = name.lower()
    if any(lower.endswith(pat) for pat in IGNORE_PATTERNS):
        return True
    if path.suffix.lower() != ".pdf":
        return True
    return False


@dataclass
class _Candidate:
    size: int
    mtime: float
    first_seen: float
    stable_since: float | None = None


def recover_orphaned_processing_files(settings: Settings, pipeline: Pipeline) -> None:
    """On startup, anything left in processing/ is from a crash mid-run —
    reprocess it (process_file is idempotent: the file-hash dedupe check
    means a file that was actually already written to the DB just gets
    marked 'duplicate' and archived, never double-inserted)."""
    leftovers = sorted(settings.processing_dir.glob("*.pdf"))
    if not leftovers:
        return
    log.warning("recovering %d file(s) left in processing/ from a previous run", len(leftovers))
    for path in leftovers:
        pipeline.process_file(path, original_filename=path.name)


def move_to_processing(settings: Settings, path: Path) -> Path | None:
    if settings.dry_run:
        # Dry-run must never mutate the filesystem outside data/logs — read
        # the file in place instead of staging it into processing/.
        log.info("[DRY-RUN] would move %s into processing/", path)
        return path
    dest = settings.processing_dir / path.name
    n = 2
    while dest.exists():
        dest = settings.processing_dir / f"{path.stem}_{n}{path.suffix}"
        n += 1
    try:
        shutil.move(str(path), str(dest))
        return dest
    except OSError as exc:
        log.error("could not move %s into processing/: %s", path, exc)
        return None


def watch_forever(settings: Settings, pipeline: Pipeline, *, stop_after_idle_cycles: int | None = None) -> None:
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    log.info("watching inbox: %s", settings.inbox_dir)

    recover_orphaned_processing_files(settings, pipeline)

    candidates: dict[str, _Candidate] = {}
    idle_cycles = 0

    while True:
        now = time.monotonic()
        seen_names: set[str] = set()

        try:
            entries = sorted(settings.inbox_dir.iterdir())
        except OSError as exc:
            log.error("could not list inbox dir: %s", exc)
            entries = []

        for path in entries:
            if not path.is_file() or _is_ignorable(path):
                continue
            seen_names.add(path.name)
            try:
                st = path.stat()
            except OSError:
                continue  # file disappeared mid-scan (e.g. sync moved it)

            prev = candidates.get(path.name)
            if prev is None or prev.size != st.st_size or prev.mtime != st.st_mtime:
                candidates[path.name] = _Candidate(size=st.st_size, mtime=st.st_mtime, first_seen=now)
                continue

            if prev.stable_since is None:
                prev.stable_since = now

            if now - prev.stable_since >= settings.stability_window_seconds:
                log.info("stable, moving to processing: %s", path.name)
                moved = move_to_processing(settings, path)
                del candidates[path.name]
                if moved:
                    pipeline.process_file(moved, original_filename=path.name)

        # Drop candidates for files that vanished from the inbox (moved/renamed
        # externally, or someone deleted the download) without double-processing.
        for name in list(candidates):
            if name not in seen_names:
                del candidates[name]

        if not entries:
            idle_cycles += 1
            if stop_after_idle_cycles is not None and idle_cycles >= stop_after_idle_cycles:
                return
        else:
            idle_cycles = 0

        time.sleep(POLL_INTERVAL_SECONDS)


def process_all(settings: Settings, pipeline: Pipeline) -> None:
    """One-shot: process every PDF currently in the inbox (skipping
    obviously-in-progress files with the same stability check, but without
    looping forever — files still unstable after one pass are left for the
    next run / the watcher)."""
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    recover_orphaned_processing_files(settings, pipeline)

    paths = [p for p in sorted(settings.inbox_dir.iterdir()) if p.is_file() and not _is_ignorable(p)]
    if not paths:
        log.info("inbox is empty, nothing to process")
        return

    log.info("checking stability of %d file(s) before processing", len(paths))
    snapshot: dict[Path, tuple[int, float]] = {}
    for p in paths:
        try:
            st = p.stat()
            snapshot[p] = (st.st_size, st.st_mtime)
        except OSError:
            continue
    time.sleep(settings.stability_window_seconds)

    for p in paths:
        if not p.exists():
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        if snapshot.get(p) != (st.st_size, st.st_mtime):
            log.warning("skipping %s — still being written to", p.name)
            continue
        moved = move_to_processing(settings, p)
        if moved:
            pipeline.process_file(moved, original_filename=p.name)
