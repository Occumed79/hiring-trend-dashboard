# Hiring Insights benchmark & validation contract

The benchmark system deliberately separates three evidence levels:

1. **Ground truth** — an independently captured official-site snapshot includes the complete official job URL set. This supports exact posting-level precision and recall.
2. **Official count** — an independently captured official-site count exists, but the complete URL set does not. This supports count parity, not exact posting-level precision/recall.
3. **Live parity** — no independent truth snapshot exists; the benchmark compares the persisted app inventory with the latest healthy authoritative source envelope. This is operational validation, not ground truth.

A portal must never be shown as production-ready from live parity alone.

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

Until the minimum truth evidence is present, the portal status is **insufficient_evidence**, even when all operational metrics are excellent.

## Stable cohort

`benchmark_cohort_members` persists membership. Each active portal fills open cohort slots from tracked entities, prioritizing entities that already have independent truth snapshots and then high source-coverage scores. Existing members do not churn because a coverage score changes. Inactive entities leave the active cohort and can return if reactivated.

## Daily validation loop

After the daily ingest:

1. Source coverage and reliability incidents are persisted.
2. Learned source-pair baselines are rebuilt from recent healthy observations.
3. The stable benchmark cohort is evaluated.
4. Portal release assessments are updated.
5. Source Health displays the latest source fleet, incidents, learned source-pair ranges, benchmark run, truth coverage, and release gates.

## Learned source-pair baselines

Pairs are learned from recent healthy, independent source observations. The runtime incident engine uses learned p10/p90 behavior when enough samples exist; otherwise it falls back to the conservative extreme-disagreement rule. CareerOneStop and NLx share lineage and do not count as independent corroboration.

## Truth capture

The Source Health workspace can save an official count and complete official job URLs for a tracked entity. The complete URL set is strongly preferred: an official count alone cannot prove posting-level precision or recall.

Do not fabricate or infer ground-truth counts. If independent truth has not been captured, keep the evidence level as live parity / insufficient evidence.
