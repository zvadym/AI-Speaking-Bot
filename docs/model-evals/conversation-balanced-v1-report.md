# Balanced Conversation Model Evaluation

Run: 2026-07-13T09:12:34.263Z
Fixture: conversation-balanced-v1 (15 cases)
Judge: gpt-5.6-terra with low reasoning

| Variant | Hard pass | Critical | Quality | p50 ms | p95 ms | Cost USD | Pairwise W/T/L |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline (gpt-5.4) | 100% | 0 | 4.840 | 1757 | 3726 | 0.201742 | 0/0/0 |
| luna_none (gpt-5.6-luna, none) | 100% | 1 | 4.813 | 1492 | 6346 | 0.080739 | 9/1/5 |
| luna_low (gpt-5.6-luna, low) | 100% | 0 | 4.880 | 1995 | 6648 | 0.087105 | 9/2/4 |

## Gates

- luna_none: **FAIL**, cost reduction 60.0%
  - hardConstraints: pass
  - noCriticalRegressions: fail
  - qualityNotMateriallyBelow: pass
  - pairwiseNotMateriallyBelow: pass
  - p95LatencyWithin20Percent: fail
  - costReductionAtLeast40Percent: pass
- luna_low: **FAIL**, cost reduction 56.8%
  - hardConstraints: pass
  - noCriticalRegressions: pass
  - qualityNotMateriallyBelow: pass
  - pairwiseNotMateriallyBelow: pass
  - p95LatencyWithin20Percent: fail
  - costReductionAtLeast40Percent: pass

## Decision

No candidate passed every rollout gate. Keep the production conversation model on gpt-5.4.

Prices use OpenAI Standard short-context rates verified on 2026-07-12. Judge cost is reported separately in the JSON report.
