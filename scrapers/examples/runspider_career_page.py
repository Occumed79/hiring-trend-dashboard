import hashlib
import json
import re
from datetime import datetime, timezone

import scrapy


class RunspiderCareerPage(scrapy.Spider):
    """Single-file Scrapy example for quick one-off checks.

    Run from the repo root after installing scrapers/requirements.txt:
      scrapy runspider scrapers/examples/runspider_career_page.py \
        -a start_url=https://example.invalid/careers \
        -a entity="Example Company" \
        -O scrapers/output/runspider-example.jsonl
    """

    name = "runspider_career_page"

    def __init__(self, start_url=None, entity="", *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not start_url:
            raise ValueError("Pass -a start_url=https://...")
        self.start_urls = [start_url]
        self.entity = entity

    def parse(self, response):
        for item in self.extract_json_ld(response):
            yield item

        for anchor in response.css("a"):
            href = anchor.attrib.get("href")
            text = clean(" ".join(anchor.css("::text").getall()))
            if not href or not text:
                continue
            absolute = response.urljoin(href)
            haystack = f"{absolute} {text}".lower()
            if not any(token in haystack for token in ["job", "career", "opening", "position", "requisition"]):
                continue
            yield self.build_item(text, absolute, parser="runspider_anchor")

        next_page = response.css('a[rel="next"]::attr(href), li.next a::attr(href)').get()
        if next_page:
            yield response.follow(next_page, callback=self.parse)

    def extract_json_ld(self, response):
        for raw in response.css('script[type="application/ld+json"]::text').getall():
            try:
                payload = json.loads(raw)
            except Exception:
                continue
            for node in flatten(payload):
                node_type = node.get("@type") if isinstance(node, dict) else None
                if isinstance(node_type, list):
                    is_job = any(str(item).lower() == "jobposting" for item in node_type)
                else:
                    is_job = str(node_type).lower() == "jobposting"
                if not is_job:
                    continue
                title = clean(node.get("title") or node.get("name"))
                if not title:
                    continue
                yield self.build_item(
                    title,
                    response.urljoin(node.get("url") or response.url),
                    location=read_location(node.get("jobLocation")),
                    posted_at=node.get("datePosted"),
                    parser="runspider_json_ld",
                )

    def build_item(self, title, url, location=None, posted_at=None, parser=None):
        return {
            "external_id": "runspider-" + hashlib.sha1(f"{self.entity}|{title}|{url}".encode("utf-8")).hexdigest()[:24],
            "source": "runspider:career_page",
            "entity_name": self.entity,
            "title": title,
            "location": location,
            "city": split_city(location),
            "state": split_state(location),
            "country": "US",
            "is_remote": bool(re.search(r"remote|hybrid", f"{title} {location or ''}", re.I)),
            "is_overseas": False,
            "posted_at": posted_at,
            "url": url,
            "raw_data": {
                "parser": parser,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            },
        }


def flatten(value):
    if isinstance(value, list):
        rows = []
        for item in value:
            rows.extend(flatten(item))
        return rows
    if isinstance(value, dict) and "@graph" in value:
        return flatten(value["@graph"])
    return [value] if isinstance(value, dict) else []


def read_location(location):
    if isinstance(location, list) and location:
        location = location[0]
    if not isinstance(location, dict):
        return None
    address = location.get("address", location)
    if not isinstance(address, dict):
        return None
    parts = [address.get("addressLocality"), address.get("addressRegion")]
    parts = [clean(part) for part in parts if clean(part)]
    return ", ".join(parts) if parts else None


def clean(value):
    if value is None:
        return None
    return re.sub(r"\s+", " ", str(value)).strip() or None


def split_city(location):
    if not location or location.lower() == "remote":
        return None
    return location.split(",")[0].strip() or None


def split_state(location):
    if not location or location.lower() == "remote":
        return None
    parts = [part.strip() for part in location.split(",")]
    return parts[1] if len(parts) > 1 else None
