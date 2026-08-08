# Source directory provenance

The source graph is designed around official or verified upstream directories. Current directory sync targets:

- U.S. Census Government Units Listing — authoritative state/local government identity
- NASPE Jobs Links — official state-government employment links
- National League of Cities State Municipal Leagues — state municipal league directory
- National Association of Counties State Associations — state county-association directory
- USAJOBS — federal executive-branch organization inventories
- NEOGOV / GovernmentJobs — authorized local/state public-sector hiring inventory
- NLx — verified original-source job exchange
- CareerOneStop Jobs V2 — NLx resilience mirror; same lineage for confidence scoring
- U.S. Courts Judiciary Jobs and OSCAR — judicial-branch exception sources
- USPS Careers/eCareers — Postal Service exception sources
- IntelligenceCareers.gov — Intelligence Community exception/discovery source
- House Talent Marketplace / House employment pages — legislative-branch exception sources
- Senate Employment Bulletin / careers site — legislative-branch exception source
- NACo Career Center, ICMA Job Center and Careers in Government — supplemental public-sector corroboration
- USAspending recipient identity and optional SAM Entity API v4 — contractor/employer identity enrichment

The runtime source ledger records source class, lineage, source health, contribution count and verification timestamps. Shared inventories require employer evidence before jobs are accepted.
