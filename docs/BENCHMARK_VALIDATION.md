# Hiring Insights benchmark & validation contract

The benchmark system deliberately separates three evidence levels:

1. **Ground truth** — an independently captured official-site snapshot includes the complete official job URL set. This supports exact posting-level precision and recall.
2. **Official count** — an independently captured official-site count exists, but the complete URL set does not. This supports count parity, not exact posting-level precision/recall.
3. **Live parity** — no independent truth snapshot exists; the benchmark compares the persisted app inventory with the latest healthy authoritative source envelope. This is operational validation, not ground truth.

A portal must never be shown as production-ready from live parity alone.

## Truth freshness

Ground-truth evidence is time-sensitive. By default, a truth snapshot is valid for **36 hours** (`BENCHMARK_TRUTH_MAX_AGE_HOURS`). Once it expires, the benchmark preserves it as history but stops using it for current precision/recall or release-gate evidence. The entity falls back to official-count/live-parity/insufficient evidence until a new independent snapshot is captured.

## Automatic independent official-source audits

Benchmark-cohort entities receive a second, independent read of supported official hiring systems after normal ingest. The auditor intentionally does **not** import or call the operational ingest parser. Supported dedicated source families include GovernmentJobs/NEOGOV, USAJOBS, Workday, Greenhouse, Lever, SmartRecruiters, BambooHR, Ashby, Recruitee, Workable and Personio, plus the specialized Amentum, V2X/Jibe and IDS/JazzHR surfaces.

Every attempt is written to `benchmark_source_audits`, including unsupported, incomplete and error results. Audit evidence is promoted to `benchmark_truth_snapshots` only when completeness can be established:

- A dedicated source with a complete official URL inventory can create posting-level ground truth.
- A single complete count-only official source can create official-count evidence, but not posting-level precision/recall.
- Multiple dedicated authoritative sources create exact ground truth only when **all** are independently complete and every non-zero inventory provides a complete URL set.
- Multiple count-only inventories are never summed because overlap cannot be proven.
- Shared inventories, directories, sitemaps and unverified discovered surfaces cannot become automatic entity ground truth.

Only active benchmark-cohort entities receive the extra audit, and a fresh truth snapshot suppresses repeat auditing for 12 hours by default (`BENCHMARK_AUTO_TRUTH_REFRESH_HOURS`). Audit failure is validation evidence only; it never fails an otherwise valid ingest.

## Default release gates

- At least 5 benchmark entities per portal.
- At least 3 independently truth-backed entities per portal.
- Precision >= 98%.
- Recall >= 90%.
- Source parity >= 90%.
- Duplicate rate <= 1%.
- Stale active-job rate <= 3%.
- Mapped-location rate >= 85%.
- Healthy authoritative-source rate >= 95%.
- High-severity source-incident entity rate <= 5%.

Until the minimum fresh truth evidence is present, the portal status is **insufficient_evidence**, even when all operational metrics are excellent.

## Stable cohort

`benchmark_cohort_members` persists membership. Each active portal fills open cohort slots from tracked entities, prioritizing entities that already have independent truth snapshots and then high source-coverage scores. Existing members do not churn because a coverage score changes. Inactive entities leave the active cohort and can return if reactivated.

## Daily validation loop

After the daily ingest:

1. Source coverage and reliability incidents are persisted.
2. Benchmark-cohort ingests independently audit supported official sources and refresh eligible truth evidence.
3. Learned source-pair baselines are rebuilt from recent healthy observations.
4. The stable benchmark cohort is evaluated.
5. Portal release assessments are updated.
6. Source Health displays source fleet health, incidents, independent audits, learned source-pair ranges, benchmark results, truth coverage and release gates.

A failed primary ingest retains a failed cron exit status. Baseline/benchmark diagnostics only run after a successful ingest.

## Learned source-pair baselines

Pairs are learned from recent healthy, independent source observations. The runtime incident engine uses learned p10/p90 behavior when enough samples exist; otherwise it falls back to the conservative extreme-disagreement rule. CareerOneStop and NLx share lineage and do not count as independent corroboration.

Each successful rebuild prunes pairs that no longer meet the current observation threshold. Runtime reliability also refuses to use learned baselines older than three days, so a stopped validation cron cannot leave a stale learned model active indefinitely.

## Manual truth capture

The Source Health workspace can still save an official count and complete official job URLs for a tracked entity when a source is unsupported by the automatic auditor. The complete URL set is strongly preferred: an official count alone cannot prove posting-level precision or recall.

Do not fabricate or infer ground-truth counts. If independent truth has not been captured, or the captured truth has expired, keep the evidence level as live parity / insufficient evidence.
