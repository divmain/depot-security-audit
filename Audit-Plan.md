# Risk-led security audit plan

Start with **Critical items protecting deployment/organization roots, production or privileged-release execution, systemic executable distribution and shared authoritative data**, then work through the remaining High items. Work in small, coherent batches and carry shared-boundary conclusions into their concrete callers.

The [master ledger](audit-ledger.tsv) is authoritative. Its `criticality` field is a conditional-impact estimate defined by the [rubric](Criticality-Rubric.md). [The CSV view](audit-ledger.csv) is a convenience snapshot; batch exports read the current TSV. Individual findings receive an evidence-based impact and severity assessment in their own reports.

The [High/Critical refinement](High-Critical-Rubric.md) only revisits items that were High in its starting snapshot. Medium and Low ratings are carried forward unchanged.

## Selecting the next work

1. Select `critical` items first, then `high` items, that are still `not_started` or have an actionable `needs_validation` follow-up.
2. Within that band, use known exposure, attacker prerequisites, shared usage, sensitive assets, and uncertainty about a claimed protection to choose the next batch. These are scheduling tie-breakers, not additional meanings of `criticality`.
3. Prefer coherent data flows: one admission boundary and its aliases; a credential ceremony and revocation path; a blob identity and its serve shortcuts; a destination grant and the corresponding transport. Inventory IDs are discovery order, not a ranked sequence.
4. Pair shared-primitive review with representative real callers, then check the remaining callers explicitly. A correct helper does not prove adoption; one covered protocol does not prove its siblings.
5. Expand through `medium` and `low` items and close cross-area/deployment gaps. A low-impact item can illuminate a chain, but it needs an actual connection to that chain rather than an assumed catastrophe.

There are no target proportions for the bands. The inventory deliberately concentrates on security-relevant behavior, so a substantial high-impact queue can be appropriate. Criticality also does not measure effort: a short HTTP handler can depend on a complicated authority or concurrency boundary.

## Initial parallel lanes

Use the per-item labels within these lanes; the lane itself does not assign a blanket score.

| Lane | Candidate prefixes | First questions to establish |
| --- | --- | --- |
| Identity and borrowed authority | `HTTP`, `AUTH`, `IAM`, `FED`, `OIDC`, `PAM` | Correct principal/credential recognition; mint attenuation; scope and role/duty separation; account linking; grant/proof binding; revocation and recovery |
| Policy and trusted package bytes | `POL`, `REG`, `BIN`, protocol prefixes | Authenticated/current policy state; namespace and governance decisions; authoritative coordinates; content integrity; cache/conditional/redirect shortcuts |
| Private data and external destinations | `DATA`, `NET`, `REPO`, `READ`, `EVID`, `INT` | Scope predicates and aggregate disclosure; credential destination grants; DNS/redirect admission; secret custody; private artifacts and evidence |
| Shipped and client-side execution | `BUILD`, `CLI`, high-impact `WEB` items | Exact shipped dependency/patch graph; release and updater trust; local file/command/config sinks; privileged-browser content and credentials |
| Distributed state and durable effects | `OPS`, `DATA`, `REG`, `PAM`, `INT`, `EVID` | Lease and write fences; stale in-flight work; replay/expiry; job/outbox effects; audit/witness integrity and bounded failure behavior |
| Format-specific adoption | `NPMCR`, `OCI`, `PYRC`, `GMN`, `DIST` | Each real protocol method, wildcard refinement, parser, alias and layout adopts the expected authority/content/resource contract |

Run deployment and exact-artifact work alongside source review when it affects a high-impact conclusion. The [deferred validation cards](../docs/guide/Deferred-Validation-Cards.md) identify live DNS/CA, ingress, operations-port, proxy, dependency and interleaving obligations. The preparation environment's toolchain/dependency differences are recorded in [Audit Coverage](Audit-Coverage.md); establish the intended runtime and patches before relying on test results.

## Batch size and ownership

- Start with roughly **5–15 related items** per engineer; use fewer for stateful auth, policy signing, parsers, or concurrency. Adjust from actual review effort, not row throughput.
- Give every item one coordinating owner. A specialist may examine a shared primitive across batches, but link that result to the concrete IDs and retain separate adoption checks.
- Before work begins, record the owner in `reviewer` and transition the selected master rows to `in_review`. Exporting is a read-only selection operation and does not claim work.
- Record the intended code revision and relevant configuration in the handoff. A newer checkout requires reconciling changed entry points and dependencies against the inventory.
- Keep related cross-area items visible, particularly the chains in [Audit Coverage](Audit-Coverage.md#cross-area-integration-reviews). Name which engineer owns an untested seam rather than allowing it to fall between batches.

## Exporting small TSV or CSV chunks

From the repository root, create a fresh batch directory:

```sh
python3 out/reference/export-audit-batch.py --prefix AUTH --criticality critical --limit 10 --out out/batches/auth-critical-01
```

For a deliberately selected flow, use exact IDs instead of a positional slice:

```sh
python3 out/reference/export-audit-batch.py --ids HTTP-001,HTTP-002,HTTP-003 --out out/batches/http-admission-01
```

After assigning an engineer in the master, export their current work:

```sh
python3 out/reference/export-audit-batch.py --status in_review --reviewer engineer@example.com --limit 10 --out out/batches/engineer-01
```

The exporter emits equivalent `audit-ledger.tsv` and `audit-ledger.csv` subsets, the **full matching inventory bullets**, a handoff page, and a manifest with selected IDs, source hashes and revisions. It preserves master row order and all selected fields, leaves the master untouched, and refuses an existing destination directory. Prefix/criticality selections default to `not_started`; exact ID selection is explicit and retains those rows' current statuses.

The [example HTTP packet](batches/http-high-example/Handoff.md) is a preserved snapshot from the initial three-band classification. Export a fresh packet from the current master for its latest ratings, then reserve its IDs before using it as an engineer's assignment.

The [Critical authentication example](batches/auth-critical-example/Handoff.md) demonstrates a fresh Critical-only selection. It is an unassigned snapshot; exporting it does not reserve work.

Supply the packet with the shared [Audit Brief](Audit-Brief.md), [criticality rubric](Criticality-Rubric.md), [Finding Categories](Finding-Categories.md), [Finding Template](Finding-Template.md), [trust-boundary map](Trust-Boundaries.md), relevant canonical design/spec documents, and the repository checkout. Packet links resolve within the checkout; preserve the shared pack's repository-relative layout when handing it over. Ledger titles alone omit the attack vectors and source locations a reviewer needs.

## What an engineer returns

Follow the [Audit Brief](Audit-Brief.md) for the actual review. Return the same assigned IDs with:

- `reviewed_revision`, relevant configuration and exact files/functions reviewed.
- Reproducible evidence, positive/negative controls and the variants actually exercised; distinguish source-only reasoning from execution.
- An outcome and corresponding status: `reviewed_no_finding`, `finding_identified`, or `needs_validation`. A timebox ending does not establish a clean result.
- Finding reports using the template, with primary/secondary category IDs, actual attacker prerequisites, violated invariant, consequence, evidence and remaining uncertainty.
- Explicit untested questions, dependent IDs, and a concrete next experiment/environment for blocked validation.
- A rationale for any proposed `criticality` change. Classification is revisable as blast radius becomes clearer; a high-criticality item can contain a low-severity finding and a low-criticality item can reveal an unexpectedly serious one.

The coordinator merges returned **review fields by `inventory_id`**, checks that every returned ID belongs to the assignment, and resolves conflicts against the export snapshot/current master. Preserve another engineer's progress; do not replace the entire master with a returned subset or use row position as identity. Keep the original criticality companions as initial classification provenance and record accepted recalibrations in the master with their rationale.

## Maintaining thoroughness

- Review the full input → admission → authority → state/effect → consumer chain. Use the brief's identity, scope, mode, time, failure and observation contrasts where applicable.
- Cross-review high-impact conclusions, particularly claimed absence of bypasses in shared guards, key custody, signature verification, release trust and cross-tenant data access.
- When one root cause affects several IDs, link the finding rather than multiplying reports; mark each affected item's coverage based on what was actually established.
- Recheck repaired issues at the failing entry point and sibling routes/variants; use repository verification gates for implementation changes.
- Track completed scope, open findings, and `needs_validation` separately. Existing tests, documented acceptances, lack of reproduction, or counts of reviewed rows do not substitute for the relevant evidence.
- An area closes with explicit dispositions for its assigned scope and owned follow-ups for remaining gaps. A deployment-dependent guarantee needs deployment evidence; a source-only audit should describe that boundary accurately.

## Classification and merge provenance

The initial companion files in `out/criticality/` contain exactly `inventory_id` and `criticality`. Their inputs, rubric hash, expected ID sets and original ledger snapshot remain in [the initial manifest](reference/criticality-input-manifest.json). The High-only companions in `out/high-criticality/` use the same columns but contain only eligible original-High IDs, each labeled `critical` or `high`.

The [refinement manifest](reference/high-criticality-input-manifest.json) freezes the eligible High set and protected Medium/Low rows. Its mechanical join checks exact coverage, duplicates, forbidden IDs, allowed values, input/rubric integrity and item identity. It updates only eligible ratings, preserves protected rows, all other field values and live master order, and exports a matching CSV:

```sh
python3 out/reference/merge-high-criticality.py --check
python3 out/reference/merge-high-criticality.py
```

The [refinement report](reference/high-criticality-merge-report.json) and [per-area summary](reference/criticality-summary.tsv) describe the resulting four bands. [The High-only summary](reference/high-criticality-summary.tsv) shows the split without reassessing Medium/Low. The original three-band merge is archived and cannot overwrite this refinement. For ordinary engineer handoffs, export fresh subsets directly from the current master.

[Initial calibration notes](reference/criticality-calibration.md) record the first pass's cross-prefix distinctions. The separate High/Critical rubric governs the narrower exceptional-impact threshold.

[High-only calibration notes](reference/high-criticality-calibration.md) record concrete root/propagation and surviving-containment examples from the refinement.
