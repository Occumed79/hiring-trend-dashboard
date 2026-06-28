import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import scrapy
from w3lib.html import remove_tags


US_STATE_RE = re.compile(r"\b([A-Z][a-zA-Z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b")
LOCATION_LABEL_RE = re.compile(
    r"\b(?:Location|Work Location|Job Location|Primary Location|Office Location)\s*[:\-–—]\s*([^|•\n\r]{2,120})",
    re.I,
)
REMOTE_RE = re.compile(r"\b(remote|hybrid|telecommute|work from home)\b", re.I)
JOB_LINK_RE = re.compile(r"\b(job|jobs|career|careers|opening|openings|position|positions|posting|requisition|req)\b", re.I)
JUNK_LINK_RE = re.compile(r"\b(privacy|terms|cookie|login|sign in|talent community|job alert|saved jobs|benefits)\b", re.I)


class CareerPagesSpider(scrapy.Spider):
    """Generic career-page crawler for sites that do not expose a clean ATS API.

    Usage:
      scrapy crawl career_pages -a start_url=https://example.com/careers -a entity="Example Inc" -O output/example.jsonl
      scrapy crawl career_pages -a start_urls=https://a.com/jobs,https://b.com/careers -O output/batch.jsonl

    The output is intentionally close to lib/ingest/careerPage.ts so the JSONL file can be imported
    into the existing jobs table without replacing the app's API/ATS ingest pipeline.
    """

    name = "career_pages"
    allowed_domains = None

    custom_settings = {
        "FEEDS": {
            "output/career-pages.jsonl": {
                "format": "jsonlines",
                "encoding": "utf8",
                "overwrite": False,
            }
        }
    }

    def __init__(self, start_url=None, start_urls=None, entity=None, max_pages="250", *args, **kwargs):
        super().__init__(*args, **kwargs)
        urls = []
        if start_urls:
            urls.extend([part.strip() for part in start_urls.split(",") if part.strip()])
        if start_url:
            urls.append(start_url.strip())
        if not urls:
            raise ValueError("Provide -a start_url=https://... or -a start_urls=url1,url2")

        self.start_urls = urls
        self.entity = entity or ""
        self.max_pages = self._safe_int(max_pages, 250)
        self.pages_seen = 0
        self.allowed_netlocs = {urlparse(url).netloc for url in urls if urlparse(url).netloc}

    def start_requests(self):
        for url in self.start_urls:
            yield scrapy.Request(url=url, callback=self.parse, meta={"source_url": url})

    def parse(self, response):
        if self.pages_seen >= self.max_pages:
            return
        self.pages_seen += 1

        for item in self.extract_json_ld_jobs(response):
            yield item

        for item in self.extract_anchor_jobs(response):
            yield item

        for href in response.css("a::attr(href)").getall():
            absolute = response.urljoin(href)
            if self.should_follow(absolute):
                yield response.follow(absolute, callback=self.parse, meta={"source_url": response.meta.get("source_url")})

    def extract_json_ld_jobs(self, response):
        for raw in response.css('script[type="application/ld+json"]::text').getall():
            try:
                parsed = json.loads(raw.strip())
            except Exception:
                continue

            for node in self.flatten_json_ld(parsed):
                if not self.is_job_posting(node):
                    continue

                title = self.clean_text(node.get("title") or node.get("name") or "")
                if not title:
                    continue

                job_url = response.urljoin(node.get("url") or node.get("sameAs") or response.url)
                location = self.read_job_location(node.get("jobLocation") or node.get("applicantLocationRequirements") or node.get("jobLocationType"))
                country = self.read_job_country(node.get("jobLocation") or node.get("applicantLocationRequirements"))

                yield self.build_item(
                    title=title,
                    url=job_url,
                    location=location,
                    country=country,
                    department=node.get("employmentType") or node.get("occupationalCategory"),
                    posted_at=node.get("datePosted"),
                    external_id=self.read_identifier(node.get("identifier")),
                    parser="scrapy_json_ld",
                    source_url=response.meta.get("source_url") or response.url,
                )

    def extract_anchor_jobs(self, response):
        for anchor in response.css("a"):
            href = anchor.attrib.get("href")
            text = self.clean_text(" ".join(anchor.css("::text").getall()))
            if not href or not text or len(text) < 4 or len(text) > 180:
                continue

            absolute = response.urljoin(href)
            haystack = f"{absolute} {text}"
            if not JOB_LINK_RE.search(haystack) or JUNK_LINK_RE.search(text):
                continue

            yield self.build_item(
                title=text,
                url=absolute,
                location=self.extract_location(text) or self.extract_location(self.clean_text(response.text[:120000])),
                country="US",
                parser="scrapy_anchor_link",
                source_url=response.meta.get("source_url") or response.url,
            )

    def should_follow(self, url):
        if self.pages_seen >= self.max_pages:
            return False
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return False
        if parsed.netloc and parsed.netloc not in self.allowed_netlocs:
            return False
        lowered = url.lower()
        return any(token in lowered for token in ["job", "career", "opening", "position", "requisition", "page="])

    def build_item(self, title, url, location=None, country=None, department=None, posted_at=None, external_id=None, parser=None, source_url=None):
        location = self.clean_location(location)
        country = country or self.detect_country(location) or "US"
        return {
            "external_id": external_id or self.hash_job(title, url, location),
            "source": "scrapy:career_page",
            "entity_name": self.entity,
            "title": self.clean_text(title),
            "department": self.clean_text(department) if department else None,
            "location": location,
            "city": self.split_city(location),
            "state": self.split_state(location),
            "country": country,
            "is_remote": bool(REMOTE_RE.search(f"{title} {location or ''}")),
            "is_overseas": str(country).upper() not in {"US", "USA", "UNITED STATES"},
            "posted_at": posted_at,
            "url": url,
            "raw_data": {
                "parser": parser,
                "source_url": source_url,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    def flatten_json_ld(self, value):
        if not value:
            return []
        if isinstance(value, list):
            rows = []
            for item in value:
                rows.extend(self.flatten_json_ld(item))
            return rows
        if isinstance(value, dict) and "@graph" in value:
            return self.flatten_json_ld(value["@graph"])
        return [value] if isinstance(value, dict) else []

    def is_job_posting(self, node):
        job_type = node.get("@type") if isinstance(node, dict) else None
        if isinstance(job_type, list):
            return any(str(item).lower() == "jobposting" for item in job_type)
        return str(job_type).lower() == "jobposting"

    def read_identifier(self, identifier):
        if identifier is None:
            return None
        if isinstance(identifier, (str, int, float)):
            return str(identifier)
        if isinstance(identifier, list) and identifier:
            return self.read_identifier(identifier[0])
        if isinstance(identifier, dict):
            return identifier.get("value") or identifier.get("name")
        return None

    def read_job_location(self, location):
        if not location:
            return None
        if isinstance(location, str):
            return "Remote" if location.upper() == "TELECOMMUTE" else self.clean_location(location)
        loc = location[0] if isinstance(location, list) and location else location
        if isinstance(loc, dict) and (loc.get("@type") == "VirtualLocation" or loc == "TELECOMMUTE"):
            return "Remote"
        address = loc.get("address", loc) if isinstance(loc, dict) else None
        if not isinstance(address, dict):
            return None
        parts = [address.get("addressLocality"), address.get("addressRegion"), self.read_country_name(address.get("addressCountry"))]
        parts = [str(part).strip() for part in parts if part]
        return ", ".join(parts) if parts else None

    def read_job_country(self, location):
        loc = location[0] if isinstance(location, list) and location else location
        if not isinstance(loc, dict):
            return None
        address = loc.get("address", loc)
        if not isinstance(address, dict):
            return None
        return self.normalize_country(self.read_country_name(address.get("addressCountry")))

    def read_country_name(self, country):
        if isinstance(country, dict):
            return country.get("name") or country.get("addressCountry")
        return country

    def extract_location(self, text):
        if not text:
            return None
        match = LOCATION_LABEL_RE.search(text)
        if match:
            return self.clean_location(match.group(1))
        match = US_STATE_RE.search(text)
        if match:
            return self.clean_location(match.group(1))
        if REMOTE_RE.search(text):
            return "Remote"
        return None

    def split_city(self, location):
        if not location or location.lower() == "remote":
            return None
        return location.split(",")[0].strip() or None

    def split_state(self, location):
        if not location or location.lower() == "remote":
            return None
        parts = [part.strip() for part in location.split(",")]
        return parts[1] if len(parts) > 1 else None

    def detect_country(self, location):
        return self.normalize_country(location)

    def normalize_country(self, value):
        if not value:
            return None
        text = str(value)
        if len(text) == 2:
            return text.upper()
        if re.search(r"united states|usa|\b[A-Z]{2}\b", text):
            return "US"
        if re.search(r"united kingdom|great britain|\buk\b", text, re.I):
            return "GB"
        if re.search(r"kuwait", text, re.I):
            return "KW"
        if re.search(r"qatar", text, re.I):
            return "QA"
        if re.search(r"bahrain", text, re.I):
            return "BH"
        if re.search(r"iraq", text, re.I):
            return "IQ"
        if re.search(r"germany", text, re.I):
            return "DE"
        return None

    def clean_text(self, value):
        text = remove_tags(str(value or ""))
        return re.sub(r"\s+", " ", text).strip()

    def clean_location(self, value):
        if not value:
            return None
        text = self.clean_text(value)
        text = re.sub(r"^(location|work location|job location|primary location|office location)\s*[:\-–—]\s*", "", text, flags=re.I)
        return text.strip(" .;,|") or None

    def hash_job(self, title, url, location):
        raw = f"{self.entity}|{title}|{url}|{location or ''}".encode("utf-8")
        return "scrapy-" + hashlib.sha1(raw).hexdigest()[:24]

    def _safe_int(self, value, fallback):
        try:
            parsed = int(value)
            return parsed if parsed > 0 else fallback
        except Exception:
            return fallback
