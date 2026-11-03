# Brief for auditing one inventory item

## Assignment

Audit **one identified item** from [the audit inventory](audit-inventory.md). Copy its ID and full bullet into your working notes, then follow its inputs, authority, state, and effects across the necessary helpers and callers. The bullet is a starting scope; it is not evidence that the listed protections work or that other attack vectors are absent.

Preparation baseline: commit `6a72e67b4b580f0bcb9f2c549782068d2d430aa3`, 2026-10-31. Record the actual revision and working-tree changes you audit. Re-resolve paths and registration lines when the source differs.

For a small batch, apply this brief separately to each assigned ID and retain each item's full inventory description. The ledger's `criticality` is a [conditional-impact triage estimate](Criticality-Rubric.md); assess actual findings on their demonstrated consequence and prerequisites. Assignment and return procedures are in the [Audit Plan](Audit-Plan.md).

Critical is the exceptional-impact tier defined in [High/Critical Rubric](High-Critical-Rubric.md). Its introduction refines only the original High rows; Medium and Low ratings retain their prior assignments.

Record before starting:

- Inventory ID, reviewer, review date, revision, and item text.
- Assigned criticality and any evidence-backed proposal to change its expected blast radius.
- Relevant service/listener, entry point and mount, supporting functions, data stores, asynchronous consumers, and output sinks.
- Minimum attacker position: anonymous, credential holder, low-privilege insider, elevated insider, operator, upstream/IdP adversary, dependency/build adversary, or network peer.
- Required configuration and enabled modes; distinguish supported defaults from an explicit operator exception.
- Security property to establish, and the counterexample that would falsify it.

## Required orientation

1. [Threat Model](../docs/Threat-Model.md): canonical adversaries, assets, `TB1`–`TB13`, degradation behavior, and organizational/deployment assumptions.
2. [Audit trust-boundary map](Trust-Boundaries.md): service composition, logical boundaries, and high-level entry points.
3. [Finding Categories](Finding-Categories.md): classify a demonstrated issue using its stable category ID(s). An example there is hypothetical; a category is not a severity.
4. [Audit coverage and scope](Audit-Coverage.md): neighboring owners, source census, preparation limits, and open deployment validation.
5. [Accepted Security Risks](../docs/design/Accepted-Security-Risks.md): read the applicable residual, affected configuration, protections, accountable owner, and reconsideration trigger.
6. [AGENTS.md](../AGENTS.md): repository boundaries and verification rules; read the subsystem's canonical design/spec document linked there.

Canonical `docs/` describes intended contracts; source determines actual behavior. Document disagreements explicitly. `.janus/` plans and notes are not the product contract. Passing existing tests, a restrictive TypeScript type, or a guardian row does not close the audit item by itself.

## Review method

### 1. Establish reachability and authority

Trace the actual route registration, composition, middleware order, early-return paths, and caller chain. For a protocol route, reconcile its logical identity with the namespaced/native mount and any wildcard refinement. For a worker, identify who can create or modify its inputs. For a client operation, identify who controls server responses, local files, or project configuration.

Separate authentication from every authorization dimension that applies: workspace role, duty, repository privilege, package/file restriction, credential provenance, temporary grant, and deployment-level authority. Determine whether the decision uses authoritative current state, cached state, or caller assertions. Confirm query/read surfaces and error responses receive the same scrutiny as mutations.

### 2. Follow untrusted data to its effects

Map raw input → parsing/decoding → normalization → validation → authorization → state change/read → output/external effect. Identify each transformation and the exact source of trust. Follow aliases, forwarded routes, aggregate listings, alternate methods, background work, and cache shortcuts that reuse the operation.

Inspect the relevant categories from the taxonomy. Select probes based on the item: encoding/canonicalization differences; unexpected enums or object keys; conflicting header/query/body values; parser and archive limits; SQL/path/URL/shell/HTML output; secret handling; cross-object access; race/replay/expiry; and resource multiplication. Avoid a checklist of speculative defects unsupported by the code path.

Security-relevant validation must work in the default runtime mode. `yoloAssert`, `safe*` wrappers and compiled Elysia/TypeBox validation have mode-dependent behavior; inspect the actual unconditional guard and the validation-mode inventory instead of assuming schema syntax proves admission.

### 3. Challenge state and composition

Choose applicable contrasts; record which were exercised:

| Axis | Useful contrasts |
| --- | --- |
| Identity | Anonymous vs authenticated; owner vs member; duty vs rank; standard vs entitlement/elevation/trusted-publishing credentials; scoped vs unscoped; revoked/expired/deactivated |
| Object scope | Different workspaces, repositories, packages, versions, files; direct member vs composite facade; deleted/restored objects; guessed known IDs |
| Serving | Namespaced vs native; protocol vs operations; internal/proxy/composite; direct vs redirect; filesystem vs S3; manifest/metadata vs artifact bytes |
| Policy | Relevant enforcement/failure modes; workspace vs repository policy; opt-out/deactivation; empty authentic state vs unavailable state; policy replacement using a repeated numeric version |
| State/time | Cold vs warm cache; negative cache; in-flight fill; revocation/expiry while in progress; simultaneous mutation; retries; clock boundary; process restart/lease takeover |
| Failure | Upstream/DB/QuestDB/bus unavailable; partial body/abort/timeout; enqueue failure; sync-hide regeneration failure; last-known-good vs cold fallback |
| Observation | Direct response, subsequent read, persisted row/blob, emitted event, outbound request, browser/CLI rendering; absence of an event alone is not proof of absence of an effect |

Do not infer that all combinations are supported. Confirm applicability from format/support registries and the assigned path. Identify the strongest relevant invariant and test its bypass paths, rather than multiplying irrelevant combinations.

### 4. Produce reproducible evidence

For each candidate, establish a reachable attacker-controlled input, a violated security property, and a concrete consequence. Prefer a minimal local reproduction with a successful authorized positive control and a discriminating negative control. For isolation issues, use independently identified actors/objects on both sides of the boundary. For races, capture an explicit interleaving and durable end state. For information disclosure, show the actual data returned, not just a status code.

Record exact code locations and function names, revision, configuration, prerequisites, steps, expected result, observed result, and the scope of execution. Keep secrets represented by synthetic/redacted values. A source-only argument can be strong evidence; label it accurately and state what remains unexecuted. A failed reproduction or missing dependency is a validation gap, not a clean result.

### 5. Resolve and hand off

Use [Finding-Template.md](Finding-Template.md) for an issue. Separate root cause from downstream manifestations; cross-link affected inventory IDs rather than filing duplicates. Rate impact and exploitability using the actual prerequisite and blast radius, not the category name. Include the dependency/version/advisory only if its applicability to shipped code is established.

An accepted risk is not an automatic exclusion. Determine whether the observed behavior stays within its exact recorded residual and protections. Report a regression, exceeded bound, missing protection, invalid deployment assumption, or reconsideration trigger explicitly. If behavior matches the documented design, label it as a confirmed design exposure or risk-review question, not an implementation bypass.

Finish with one of:

- **Reviewed, no finding identified:** give the files, variants, invariants and evidence actually reviewed; state remaining limits.
- **Finding identified:** supply the completed finding record and affected IDs.
- **Needs validation:** name the unanswered proposition, reason, required experiment/environment, and owner or next action.

Update the corresponding row in [audit-ledger.tsv](audit-ledger.tsv). Every row initially means `not_started`; the existence of this pack does not mark anything reviewed. Record newly discovered surfaces or cross-area gaps for inventory expansion.

Use ledger statuses `not_started`, `in_review`, `reviewed_no_finding`, `finding_identified`, and `needs_validation`; preserve evidence and revision when changing a status.

For an exported batch, return the same IDs and your review fields to the coordinator for an ID-based merge. Preserve other reviewers' work and record the rationale for proposed criticality changes in the handoff or `notes`.

## Repository-specific testing reference

Select the smallest existing layer that can establish the property. Source-only review does not require a full build; a remediation follows the repository's required verification gates.

- **Unit:** `bun test --preload ./test/unit-preload.ts <test-file>` from the repository root. The preload is required for service environment and runtime-mode isolation.
- **Database/HTTP integration:** `test/integration/` with the integration preload and real PostgreSQL. On macOS use the documented [Linux verify-runner procedure](../docs/guide/Verify-Runner-Container.md) for Docker-backed suites.
- **Browser:** Vitest browser/Playwright and `@sd/client-mock/testing`; use whole-app integration when proving route/auth/workspace behavior. See [UI Testing Guide](../docs/guide/UI-Testing-Guide.md).
- **Protocol/e2e:** `test/e2e/`, extended client matrices, and `test/conformance/`. Rebuild images after a source change; existing containers otherwise exercise compiled old code. A mock transport does not establish real DNS/TLS/proxy behavior.
- **Deployment/cryptography/dependency evidence:** follow [Deferred Validation Cards](../docs/guide/Deferred-Validation-Cards.md), pin the actual image/runtime/dependency/configuration, and preserve positive controls. These obligations are not closed by ordinary source or unit-test coverage.
- Use the toolchain pinned in `.prototools` and `bunx` for repository tooling. During preparation, pinned Bun 1.4.4 was unavailable; only static reference generation used installed Bun 1.4.2 and Oxc 0.137.0. No application test result is implied by that generation.

## Copyable handoff

> Audit inventory item: `<ID and full bullet>`  
> Revision/configuration: `<commit, changes, relevant modes>`  
> Attacker and boundary: `<minimum access; canonical TB/local LB>`  
> Property: `<what must remain true>`  
> Evidence reviewed: `<paths/functions; executed commands/results or source-only reasoning>`  
> Outcome: `<reviewed/no finding; finding; needs validation>`  
> Category and impact: `<taxonomy IDs; actual consequence and prerequisites>`  
> Related items / remaining questions: `<IDs and precise follow-up>`
