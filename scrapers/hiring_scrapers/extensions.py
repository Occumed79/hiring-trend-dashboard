import json
import os
from datetime import datetime, timezone
from pathlib import Path

from scrapy import signals


class JsonStatsExtension:
    """Write per-spider crawl stats to a JSONL file when a crawl finishes.

    Scrapy already collects useful runtime stats. This extension makes those stats durable so the
    dashboard team can inspect what happened without digging through terminal logs.
    """

    def __init__(self, stats_file):
        self.stats_file = Path(stats_file)

    @classmethod
    def from_crawler(cls, crawler):
        stats_file = crawler.settings.get("CAREER_CRAWLER_STATS_FILE") or os.getenv(
            "CAREER_CRAWLER_STATS_FILE",
            "output/crawler-stats.jsonl",
        )
        extension = cls(stats_file)
        crawler.signals.connect(extension.spider_closed, signal=signals.spider_closed)
        return extension

    def spider_closed(self, spider, reason):
        stats = spider.crawler.stats.get_stats()
        self.stats_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "spider": spider.name,
            "entity": getattr(spider, "entity", None),
            "reason": reason,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "stats": normalize_stats(stats),
        }
        with self.stats_file.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, default=str, sort_keys=True) + "\n")


def normalize_stats(stats):
    normalized = {}
    for key, value in stats.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            normalized[key] = value
        else:
            normalized[key] = str(value)
    return normalized
