#!/usr/bin/env python3
"""Run the optional career-page spider for several targets from one JSON config."""

import argparse
import json
import os
import sys
from pathlib import Path

from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings

SCRAPERS_DIR = Path(__file__).resolve().parent
if str(SCRAPERS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRAPERS_DIR))
os.environ.setdefault("SCRAPY_SETTINGS_MODULE", "hiring_scrapers.settings")

from hiring_scrapers.spiders.career_pages import CareerPagesSpider  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Run configured career-page crawler targets.")
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", default="scrapers/output/career-pages-batch.jsonl")
    parser.add_argument("--stats-file", default="scrapers/output/crawler-stats.jsonl")
    parser.add_argument("--max-pages", type=int, default=250)
    args = parser.parse_args()

    targets = read_targets(args.config)
    if not targets:
        raise SystemExit("No targets configured.")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    settings = get_project_settings()
    settings.set(
        "FEEDS",
        {str(output): {"format": "jsonlines", "encoding": "utf8", "overwrite": False}},
        priority="cmdline",
    )
    settings.set("CAREER_CRAWLER_STATS_FILE", args.stats_file, priority="cmdline")

    process = CrawlerProcess(settings)
    queued = 0
    for target in targets:
        urls = target.get("start_urls") or []
        if isinstance(urls, str):
            urls = [part.strip() for part in urls.split(",") if part.strip()]
        start_url = target.get("start_url") or (urls[0] if len(urls) == 1 else None)
        if not start_url and not urls:
            continue
        process.crawl(
            CareerPagesSpider,
            start_url=start_url,
            start_urls=",".join(urls) if urls else None,
            entity=target.get("entity") or target.get("name") or "",
            max_pages=str(target.get("max_pages") or args.max_pages),
        )
        queued += 1

    if not queued:
        raise SystemExit("No runnable targets configured.")
    process.start()
    print(json.dumps({"queued": queued, "output": str(output), "stats_file": args.stats_file}, indent=2))


def read_targets(path):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("targets"), list):
        return payload["targets"]
    raise ValueError("Config must be a list or an object with a targets list.")


if __name__ == "__main__":
    main()
