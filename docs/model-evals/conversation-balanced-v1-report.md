# Balanced Conversation Model Evaluation

Run: 2026-07-13T08:36:33.011Z
Fixture: conversation-balanced-v1 (15 cases)
Judge: gpt-5.6-terra with low reasoning

| Variant | Hard pass | Critical | Quality | p50 ms | p95 ms | Cost USD | Pairwise W/T/L |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline (gpt-5.4) | 93% | 0 | 4.640 | 2685 | 13257 | 0.193823 | 0/0/0 |
| luna_none (gpt-5.6-luna, none) | 87% | 1 | 4.707 | 1404 | 1903 | 0.077385 | 10/0/5 |
| luna_low (gpt-5.6-luna, low) | 87% | 1 | 4.680 | 2257 | 3103 | 0.084129 | 9/0/6 |

## Gates

- luna_none: **FAIL**, cost reduction 60.1%
  - hardConstraints: fail
  - noCriticalRegressions: fail
  - qualityNotMateriallyBelow: pass
  - pairwiseNotMateriallyBelow: pass
  - p95LatencyWithin20Percent: pass
  - costReductionAtLeast40Percent: pass
- luna_low: **FAIL**, cost reduction 56.6%
  - hardConstraints: fail
  - noCriticalRegressions: fail
  - qualityNotMateriallyBelow: pass
  - pairwiseNotMateriallyBelow: pass
  - p95LatencyWithin20Percent: pass
  - costReductionAtLeast40Percent: pass

## Decision

No candidate passed every rollout gate. Keep the production conversation model on gpt-5.4.

Prices use OpenAI Standard short-context rates verified on 2026-07-12. Judge cost is reported separately in the JSON report.
