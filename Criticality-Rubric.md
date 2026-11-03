# Audit criticality rubric

`criticality` estimates the **likely credible blast radius if a vulnerability exists in the particular inventory item**. It guides review order. Values are exactly `low`, `medium`, `high`, or `critical`.

The current refinement splits only the original High items into `critical` or `high`, using [the High/Critical rubric](High-Critical-Rubric.md). Medium and Low ratings are frozen and are not reassessed. The [initial three-band rubric](Criticality-Rubric.initial.md) is preserved as classification provenance.

Consider impact to **Socket**, **customers and their downstream users/builds**, and **data and credentials**. Use the strongest credible impact across those dimensions. A self-hosted customer deployment is not automatically a path into Socket production or every other customer; name the real propagation path when reasoning about wider impact.

This field estimates conditional impact, not the probability that the code is vulnerable, ease of exploitation, reviewer confidence, review effort, or a confirmed finding's severity/CVSS. An accepted design risk, privileged prerequisite, or existing test does not by itself lower the consequence of a failure. Exposure and prerequisites are additional scheduling information.

## Bands

| Value | Consequence of failure in this item's actual responsibility | Typical examples |
| --- | --- | --- |
| `critical` | Exceptional root or systemic impact meeting the affirmative threshold in [High/Critical Rubric](High-Critical-Rubric.md). | Deployment/organization authority or shared key custody compromise; concrete production-service or privileged-release execution; systemic executable-distribution control; catastrophic compromise of the shared authoritative data foundation. |
| `high` | Serious authority, executable-content, credential, private-data or availability harm that does not establish the exceptional Critical boundary. Existing High items stay High when that stronger scope is unsupported. | Bounded account/workspace/repository compromise; private artifact disclosure; scoped publishing or credential theft; package/version substitution; ordinary privileged-browser or local CLI compromise; SSRF without a concrete root path; substantial evidence loss; recoverable service-wide outage. |
| `medium` | Meaningful confidentiality, integrity, availability, or investigation harm with a bounded object, account, repository, job, or workflow scope, while independent authority and broader containment still work. | Disclosure of a limited package name or operational metadata; corruption/unavailability of a particular index/job/package without attacker-content substitution; bounded retry/resource amplification; misleading investigation/report data; loss of an individual notification/delivery; a workflow disruption recoverable within its existing authority; a local state or coordination error that does not enlarge access. |
| `low` | Limited non-sensitive presentation, diagnostic, convenience, or isolated error-handling impact, without a credible direct path to meaningful authority, private-data, executable-content, or shared-service harm. | Incorrect labels/help text; benign UI sorting/layout/preferences; non-sensitive diagnostic formatting; an isolated rejected request; redundant presentation gating while server authorization still enforces the action; test/display metadata that does not control real authority, release execution, secrets, or substantive evidence. |

Scope alone is insufficient: one deployment-root key can be `critical`, a bounded package substitution can be `high`, and a deployment-wide cosmetic label can be `low`. A read-only item can be `high` when its responsibility protects private artifacts or sensitive evidence. The Medium and Low definitions above retain their initial meaning and ratings during this refinement.

## Per-item decision procedure

1. Read the **full inventory bullet**, not just the ledger title or prefix. Identify the asset, actor-controlled input, actual boundary, and downstream consumer.
2. Ask what security property this particular item owns. Consider the plausible failure modes named in the bullet and the cited implementation/contract. Consult source when scope or authority is ambiguous.
3. Assume the protection under review fails; retain genuinely independent controls. Do not give a UI visibility bug the power of a server authorization bug. Conversely, do not credit the very guard being audited as a reason its failure has little impact.
4. Follow ordinary, credible propagation: shared helpers, cross-tenant queries, queued effects, consumed packages, privileged browsers, generated shell commands, distributed binaries, or release credentials. Do not append unrelated hypothetical vulnerabilities just to reach catastrophe.
5. Choose the strongest **credible, representative** consequence of this item. If several independent consequences are genuinely part of its scope, use the highest applicable band. A generic possibility of arbitrary code execution in any dependency does not make every formatting helper `high`.
6. Distinguish a local failure from shared failure: rejected malformed input versus process exhaustion; a damaged index versus substituted executable bytes; one missed delivery versus fleet-wide evidence suppression; one limited metadata row versus private package contents or a credential-bearing export.
7. Use source/docs to resolve difficult cases. For this High-only refinement, retain `high` when the exceptional Critical consequence is not established; do not downgrade it or revisit Medium/Low rows. Follow the scoped input set and output contract in [High/Critical Rubric](High-Critical-Rubric.md).

Classify every assigned row individually. **No prefix-wide defaults, keyword-only scoring, target percentages, or quotas.** Similar failures at equivalent boundaries should receive similar bands across prefixes. Uniform bands are permissible only when the individual items actually justify them.

## Calibration examples

| Distinction | Expected treatment |
| --- | --- |
| Login/token verification vs a non-sensitive login-screen label | Root-capable arbitrary impersonation can be `critical`; independently confined identity effects remain `high`. The original isolated-label treatment remains `low`. |
| Stored package README renderer vs plain, independently escaped presentation layout | A script-execution boundary in an administrator's browser: `high`. Layout alone: `low`. |
| Repository/package scope predicate vs a bounded non-sensitive search ranking defect | Unauthorized private content access: `high`. Wrong ordering or limited metadata distortion: `low` or `medium`, depending on actual effect. |
| Registry artifact identity vs a single package's malformed-index handling | Unauthorized bytes delivered as trusted content: `high`. Bounded availability/metadata failure without content substitution: `medium`. |
| Global request/body/concurrency bound vs a retry counter for one bounded job | Plausible service-wide exhaustion: `high`. A contained job retry/accounting error: `medium`; a harmless display of that counter may be `low`. |
| SIEM/event authenticity boundary vs one delivery status/display path | Broad evidence forgery, sensitive export leakage, or fleet-wide suppression: `high`. A bounded delivery/investigation error: `medium`; purely cosmetic status formatting: `low`. |
| CLI updater/config interpolation vs ordinary terminal help | Systemic release/update control can be `critical`; ordinary workstation execution or scoped credential-destination control remains `high`. Non-sensitive help formatting retains its original `low` treatment. |
| CI runner/release authority vs test-result bookkeeping | Untrusted execution with secrets or shipped-artifact control: `high`. Inaccurate bounded assurance/bookkeeping: generally `medium` or `low`; do not assume a second undiscovered product exploit. |
| Optional infrastructure or an authenticated-only route | Rate the consequence if the supported feature is in use and the stated attacker can reach it. Optionality and authentication affect scheduling/exposure, not an automatic impact discount. |

## Classification stages and output contract

The initial companions in `out/criticality/<PREFIX>.tsv` are preserved. This refinement writes only originally High IDs to `out/high-criticality/<PREFIX>.tsv`, with the same exact header and actual tab-separated fields:

```tsv
inventory_id	criticality
```

Include every supplied eligible ID exactly once, in input order, with only `critical` or `high`. Include no Medium/Low IDs, extra columns, prose, code fences, blank values, foreign IDs, or duplicates. Do not edit the master ledger or inventory. The High-only merge enforces eligibility and preserves every Medium/Low row and every non-criticality field.

Initial inputs and hashes remain in `out/reference/criticality-inputs/` and `out/reference/criticality-input-manifest.json`. The High-only extracts, eligibility/protected sets, rubric hash and before-refinement ledger snapshot are recorded in `out/reference/high-criticality-input-manifest.json`. These are triage estimates; later recalibration requires an explicit new scope and evidence of changed consequences.

## References

- [Audit inventory](audit-inventory.md), [Audit brief](Audit-Brief.md), [Trust boundaries](Trust-Boundaries.md).
- [Threat Model](../docs/Threat-Model.md), [Finding Categories](Finding-Categories.md), [Accepted Security Risks](../docs/design/Accepted-Security-Risks.md).
