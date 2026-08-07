"""CLI entry point.

    python -m app.main watch                  # watch the inbox forever
    python -m app.main process-all             # process everything currently in the inbox once
    python -m app.main process-file PATH       # process a single specific file
    python -m app.main dry-run                 # process-all with DRY_RUN forced on (no DB writes, no file moves logged as real)

Any subcommand also accepts --dry-run to force dry-run mode regardless of
the .env DRY_RUN setting.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.config import load_settings, require_supabase
from app.logging_config import setup_logging
from app.pipeline import Pipeline
from app.repository import Repository
from app.watcher import move_to_processing, process_all, watch_forever


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="utility-bill-ingestor")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run mode (no DB writes)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("watch", help="Watch the inbox folder forever")
    sub.add_parser("process-all", help="Process every file currently in the inbox once, then exit")

    process_file_parser = sub.add_parser("process-file", help="Process a single PDF")
    process_file_parser.add_argument("path", type=str)

    sub.add_parser("dry-run", help="Same as process-all, but never writes to Supabase or moves files for real")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    dry_run_override = True if (args.dry_run or args.command == "dry-run") else None
    settings = load_settings(dry_run_override=dry_run_override)
    logger = setup_logging(settings.logs_dir)
    logger.info(
        "starting command=%s dry_run=%s inbox=%s archive_root=%s",
        args.command, settings.dry_run, settings.inbox_dir, settings.archive_root,
    )

    try:
        require_supabase(settings)
    except RuntimeError as exc:
        logger.error(str(exc))
        return 2

    repository = Repository(settings)
    pipeline = Pipeline(settings, repository)

    if args.command == "watch":
        watch_forever(settings, pipeline)
        return 0

    if args.command in ("process-all", "dry-run"):
        process_all(settings, pipeline)
        return 0

    if args.command == "process-file":
        path = Path(args.path)
        if not path.exists():
            logger.error("no such file: %s", path)
            return 1
        original_name = path.name
        moved = move_to_processing(settings, path)
        if moved is None:
            return 1
        result = pipeline.process_file(moved, original_filename=original_name)
        logger.info("result: %s — %s", result.status, result.message)
        return 0 if result.status in ("completed", "duplicate") else 1

    return 1


if __name__ == "__main__":
    sys.exit(main())
