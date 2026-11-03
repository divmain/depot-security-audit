# Security audit preparation

Baseline: `6a72e67b4b580f0bcb9f2c549782068d2d430aa3` · 2026-10-31.

Use the [Audit Plan](Audit-Plan.md) to choose a small, coherent Critical-first batch, followed by High items, then hand its full inventory bullets and the brief to a reviewer.

| Material | Purpose |
| --- | --- |
| [audit-inventory.md](audit-inventory.md) | Discrete code-grounded audit targets, grouped by stable ID prefix; bulleted list only |
| [Audit-Brief.md](Audit-Brief.md) | Self-contained instructions for a developer auditing one item |
| [Audit-Plan.md](Audit-Plan.md) | High-impact-first sequencing, small-batch export, ownership and review-return workflow |
| [Criticality-Rubric.md](Criticality-Rubric.md) | Current critical/high/medium/low conditional blast-radius definitions |
| [High-Critical-Rubric.md](High-Critical-Rubric.md) | Exceptional-impact threshold and strict original-High-only reassessment scope |
| [Finding-Categories.md](Finding-Categories.md) | Vulnerability taxonomy with illustrative hypothetical findings |
| [Trust-Boundaries.md](Trust-Boundaries.md) | High-level external surfaces, canonical network boundaries, and internal logical boundaries |
| [Audit-Coverage.md](Audit-Coverage.md) | Work breakdown, source-discovery cross-checks, canonical registries and deferred validation |
| [Finding-Template.md](Finding-Template.md) | Evidence, impact, risk-context and remediation fields for an actual finding |
| [audit-ledger.tsv](audit-ledger.tsv) | Authoritative work ledger with per-item criticality; audit statuses start at `not_started` |
| [audit-ledger.csv](audit-ledger.csv) | Matching convenience snapshot for spreadsheet use; fresh batches export from the current TSV |
| [criticality/](criticality/) | Preserved initial three-band classification companions |
| [high-criticality/](high-criticality/) | Per-prefix two-column companions assessing only original High items |
| [reference/criticality-summary.tsv](reference/criticality-summary.tsv) | Current four-band counts by prefix |
| [reference/high-criticality-summary.tsv](reference/high-criticality-summary.tsv) | Critical/High split of the eligible original High set |
| [reference/high-criticality-merge-report.json](reference/high-criticality-merge-report.json) | High-only eligibility, Medium/Low preservation and merge checks |
| [batches/auth-critical-example/Handoff.md](batches/auth-critical-example/Handoff.md) | Fresh Critical-only example packet with full inventory descriptions and TSV/CSV rows |
| [reference/criticality-merge-report.json](reference/criticality-merge-report.json) | Coverage, input hashes and non-criticality-field preservation checks |
| [batches/http-high-example/Handoff.md](batches/http-high-example/Handoff.md) | Preserved initial three-band example packet; export fresh rows for current ratings |
| [reference/http-registrations.tsv](reference/http-registrations.tsv) | Source registration candidates with methods, path expressions and file/line locations |
| [reference/surface-census.json](reference/surface-census.json) | Machine-readable discovery snapshot, canonical route/mutation/mint tables and browser route IDs |
| [reference/http-source-crosswalk.tsv](reference/http-source-crosswalk.tsv) | Registration-source to inventory-ID lookup; traceability, not audit completion |
| [reference/preparation-manifest.json](reference/preparation-manifest.json) | Per-area item counts and consolidation checksums |
| [reference/pack-validation.json](reference/pack-validation.json) | Artifact-format, link, source-path and ledger-parity validation results |

The canonical product trust/threat reference is [docs/Threat-Model.md](../docs/Threat-Model.md). This preparation pack is not a completed audit or a list of confirmed vulnerabilities. Source references are repository-relative; `out/` is gitignored working material.
