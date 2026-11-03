# Audit scope and coverage guide

## Baseline and meaning of coverage

Preparation targets tracked source at commit `6a72e67b4b580f0bcb9f2c549782068d2d430aa3` on 2026-10-31. The starting working tree has no tracked changes; the existing untracked `Redesign-Blast-Radius.md` is outside the product-source baseline. Material in `out/` is gitignored audit working material.

This pack inventories **review targets**. Item counts, source references, route census matches, and existing guardian tests measure discovery/traceability, not completed security review. The [audit ledger](audit-ledger.tsv) starts every item at `not_started`.

The consolidated snapshot contains **6,406 targets across the review areas below**, plus **65 hypothetical finding categories**. Per-area counts and consolidation checksums are recorded in [the preparation manifest](reference/preparation-manifest.json). [Artifact validation](reference/pack-validation.json) records ID/ledger/link/source-path checks and textual reconciliation of literal HTTP registrations and browser route sources.

Each ledger item carries a conditional-impact `criticality` classification under the [shared rubric](Criticality-Rubric.md). The [High/Critical refinement](High-Critical-Rubric.md) reassesses only the original High set; Medium/Low ratings are preserved. The [Audit Plan](Audit-Plan.md) describes Critical-first sequencing and small engineer handoffs, and the [classification summary](reference/criticality-summary.tsv) records the per-prefix distribution. Classification does not change an item's audit status.

The review includes Depot both as an attack target and as a vector into customer clients, upstream publishing accounts, identity infrastructure, integration destinations, and the build/release chain. Workspace/repository isolation remains in scope despite the self-hosted organizational deployment assumption.

## Work breakdown

The stable ID prefix in [audit-inventory.md](audit-inventory.md) selects a review area. A shared helper and its protocol/domain caller can both have items: one owns the primitive's contract, the other its correct adoption. Carry a finding across related IDs when the root cause is shared.

| Prefix | Review area | Primary code / seams |
| --- | --- | --- |
| `HTTP` | HTTP shell, primitive guards, listeners, public diagnostics, static hosting | Both `app.ts` compositions, native/operations apps, shared auth/HTTP guards, `routes/spa.ts`; domain lifecycles remain with their owners |
| `AUTH` | Bootstrap, interactive/social authentication, sessions, recovery, login capabilities | Control-plane auth/session modules and associated routes; federation and PAM ceremonies link outward |
| `IAM` | Workspace/principal/team/role/duty/privilege administration and API/entitlement tokens | Identity routes, guard composition, credential scopes, token-mint and origin censuses |
| `FED` | Enterprise SSO and SCIM | Provider routes, SAML/OIDC seams, SCIM mount/parser/resource operations, provisioning and account linking |
| `OIDC` | Trusted publishing | Per-format exchange mounts, issuer/JWKS/CA verification, registrations, replay ledger, minted-token provenance |
| `PAM` | Privileged access management | Elevation routes/state, grant containment and credentials, step-up, oversight, custody, witness health and expiry |
| `REPO` | Repository/upstream administration, promotion, cleanup and restore | Native endpoint reservation, composite graph, upstream credentials, signing keys, promotion executors, ecosystem sync/cleanup workers |
| `POL` | Policy authoring/compiler/execution/signing/distribution and external facts | `policy-engine/`, control-plane policy modules/routes, fact-push and consumer lifecycle |
| `GOV` | Governance, namespace administration, posture and threat response | Dispositions/approvals/break-glass, protected namespaces, threat campaigns, request signals, work items and escalation |
| `READ` | Search, package/installer/setup reads, dashboards and management telemetry | `shared-routes/`, management query/projection routes, dashboard logic, lockfile input and package-scope read classification |
| `EVID` | Audit/evidence/exports/replay/retention and event-store pipeline | `events-store/` excluding SIEM delivery, audit/report routes/workers, logs, event attribution, serialization and loss accounting |
| `INT` | Webhook, SIEM, notification and email delivery | Integration routes, workers/outboxes, `events-store/siem/`, signing, destination and event-scope behavior |
| `OPS` | Internal bus, lease/lifecycle coordination, runtime and operator configuration | Internal routes/SSE, process startup/shutdown, fences/sweeps, config, breakers, ASN and Socket-key administration |
| `REG` | Shared registry resolution, enforcement, composites, caches and drift | Registry `lib/` common serving path, package projection, namespace enforcement, policy tickets, metadata and asynchronous fill fences |
| `NPMCR` | npm and Cargo protocol operations | `registry-api/routes/{npm,crates}/`, format parsers, serializers, proxy and composite adapters |
| `OCI` | Docker/OCI and Helm | Docker wildcard operations, JWT realm/keyring, uploads, image membership, manifests/tags, Helm extraction/classification |
| `PYRC` | PyPI, RubyGems and Composer | Format routes/parsers, indexes/discovery, upload and archive flows, proxy and composite adapters |
| `GMN` | Go, Maven and NuGet | Format routes, checksum relay, coordinate/ZIP/XML parsing, deployments/discovery, proxy and composite adapters |
| `DIST` | APK, DEB, RPM and Generic artifacts | Format routes, distro indexes/signing/parsers, generic file identity/browsing/path credentials, proxy/composite adapters |
| `DATA` | Relational persistence and coordination contracts | `store/` schema/read/write/cache/migrations, scoped queries, uniqueness, transaction/lock/lease behavior and durable side effects |
| `NET` | Guarded egress and upstream transport primitives | URL/DNS/IP/redirect/credential admission, upstream pull/publish/probes, Socket enrichment and network breakers |
| `BIN` | Blob/binary/cryptographic/validation primitives | Filesystem/S3/staging/range serving, generic archive/stream decoding, secret crypto, runtime-mode and schema trust boundaries |
| `WEB` | Browser routes, actions, renderers and client state | `ui/`, `shared/browser/`; server-side access control is separately inventoried |
| `CLI` | CLI, SDK and generated client configuration | `cli/`, `client/`, `shared/universal/registry-config/`; distribution client trust and local process/filesystem effects |
| `BUILD` | Dependencies, release/distribution, deployment and developer tooling | Workflows, patches, Docker/build scripts, public CLI distribution server, dev/bench/test harness, mock production exclusion |

`packages/types/` contributes domain schemas and vocabularies to the owning area; `packages/runtime-mode/` belongs to `BIN`. `packages/client-mock/`, test fixtures, and tooling belong to `BUILD`, with browser-facing devtools seams in `WEB`. Production dependency patches are reviewed at their integration and release boundaries as well as by the relevant domain owner.

## Discovery cross-checks

The [static source census](reference/surface-census.json) and [HTTP registration table](reference/http-registrations.tsv) provide independent entry-point discovery to compare with the human inventory. They include explicit computed path arguments, file/line locations, browser route declarations, canonical registry routes, Docker wildcard refinements, mutation-policy rows, and token-mint rows.

The census scans source without constructing applications or opening listeners. HTTP path arguments are **local registration expressions**, not necessarily final public URLs. The canonical tables are committed governance data, not observations of a live router. Expand mount prefixes, shared factories, native variants, conditional paths, implicit HEAD, and dependency-owned authentication endpoints during an actual review. Excluded non-path-like method calls are retained in the JSON for recheck.

Snapshot discovery results:

| Discovery set | Entries at this revision |
| --- | ---: |
| Filtered source files across tracked source/tooling roots | 2,807 |
| HTTP source-registration candidates | 608 |
| Candidates with computed path expressions | 11 |
| Canonical registry logical-route rows | 229 |
| Docker wildcard operation refinements | 12 |
| Canonical mutation-policy rows | 296 |
| Canonical token-mint rows | 23 |
| Browser `createFileRoute` declarations | 114 |

These sets overlap and must not be summed into a count of endpoints. Counts are snapshot facts, not acceptance thresholds. No parser errors were reported in the scanned server/browser source. Source counts exclude tests/fixtures/declarations and the generated UI route tree; the inventory still covers security-relevant test/deployment tooling.

Generation: `reference/build-census.mjs`. The pinned Bun 1.4.4 and root-linked Oxc dependency were unavailable in the existing installation. The static pass used installed Bun 1.4.2 and Oxc 0.137.0, recorded in the JSON. It did not install dependencies, run application factories, or execute product tests. Re-run with the pinned toolchain after dependencies are prepared; an optional `AUDIT_PARSER_PATH` selects an already-installed parser.

The existing `node_modules/better-auth/package.json` and control-plane `node_modules/@better-auth/sso/package.json` also report 1.7.1, while the committed manifests and patch declarations select 1.7.7. Treat the installed tree as unsynchronized preparation-environment state. Establish the committed dependency/patch graph before runtime review; a local installed version is not evidence of the shipped version.

## Canonical inventories to reconcile per item

| Concern | Canonical discovery source |
| --- | --- |
| Actual composition and schema forwarding | Service `app.ts`, registry `native-app.ts` / `operations-app.ts`, control-plane route composite modules, `scim-mount.ts`, auth ceremonies |
| Registry placement, methods, native membership | `packages/shared/universal/registry-logical-routes.ts`, registry `pre-resolver-admission-sites.ts`, Docker `logical-routes.ts` |
| Mutation authority and credential issuance | `packages/shared/universal/mutation-route-policy.ts`, `token-mint-census.ts` |
| Elevation coverage and credential kinds | `elevation-operation-registry.ts`, `elevation-boundary-call-sites.ts`, `elevation-credential-kind-census.ts` under shared universal |
| Credential restrictions and origin | Shared `credential-scope-enforcement-points.ts`, `token-origin-enforcement-points.ts`; control-plane `lib/package-scope-read-registry.ts`; registry `lib/package-scope-projection-capabilities.ts` |
| Namespace enforcement and aggregate disclosure | `packages/registry-api/lib/protected-namespace-sites.ts`, exposed protected-namespace grammar and support registry |
| Outbound transport and credential grants | `packages/shared/server/egress-adoption-inventory.ts`, `egress-guard.ts`, `egress-credential-policy.ts` |
| Policy authenticity, identity and inventory writes | Policy signing/snapshot modules, registry serve-ticket guardian, store policy-inventory choke-point guardian |
| Lease fencing and background work | `packages/control-plane/write-fence-inventory.ts`, `sweep-table.ts`, `sweep-names.ts`, store lock-order/fence modules |
| Mode-dependent validation | `tools/lint/validation-mode-inventory.ts`, runtime-mode and safe-value modules |
| Events, delivery and retention | Webhook event registry/producer guardian, event constants, SIEM event map, events-store retention classifiers |
| Browser navigation and cache segregation | UI nav inventory, generated route tree, workspace-query-key guardian, shared route/read projections |
| Shipped dependency and artifact boundaries | Lockfile, patchedDependencies/patches, CLI import-graph guardian, image/distribution wiring and workflows |

Use guardians to find assumptions and expected membership, then read the actual enforcement. A structurally complete row can still name a behaviorally incomplete guard; an exported function can still have an unclassified caller.

## Cross-area integration reviews

Carry these end-to-end chains across assignments so that separate primitive reviews do not leave their composition unexamined. The relevant inventory items provide the individual entry points and sinks.

| Chain | Areas to connect | Property to follow end to end |
| --- | --- | --- |
| Invitation/SSO/SCIM → principal → token/session → registry request | `AUTH`, `FED`, `IAM`, `HTTP`, protocol areas | Identity provenance, membership and credential restrictions remain conserved through every conversion and subsequent use |
| Elevation request → policy → approval/proof → grant-bound mutation/mint → termination | `PAM`, `POL`, `IAM`, `DATA`, protocol areas | Complete affected-set authority and credential/origin pinning survive races, conversion, retry and expiry |
| Untrusted publish → parsing → policy → persisted bytes/metadata → installed client | Protocol areas, `BIN`, `POL`, `REG`, `DATA`, `WEB`, `CLI` | Every stage agrees on coordinate, content and authority; parser or output differences cannot move the trusted object |
| Composite facade → ordered members → owner cache → artifact/redirect | `REPO`, `REG`, protocol areas, `NET`, `BIN` | Facade/member access, ownership, namespace protection and policy remain bound to the actual served object |
| Namespace change → snapshot/invalidation → warm cache/listing/advisory/sumdb path | `GOV`, `REG`, `OPS`, `DATA`, protocol areas | Changes respect the documented propagation/fallback bounds and do not leak a protected name through an alternate surface |
| Policy publish/rotation → signed complete snapshot → decision cache/ticket → metadata | `POL`, `OPS`, `REG`, `DATA` | Authenticity, complete inventory, freshness and state identity remain separate and correctly composed |
| Deactivation/revocation → transaction → notification/bus → cached request/SSE authority | `AUTH`, `FED`, `IAM`, `PAM`, `OPS`, `EVID`, `DATA` | Revocation bounds hold across all replicas and open connections, including stale in-flight cache fills |
| Administrative destination change → queued job → outbound connection → receiver | `REPO`, `INT`, `NET`, `DATA`, `OPS` | Execution-time destination, credential grant and scope match current authorized state; retries/takeover preserve the external-effect contract |
| Request/decision/fact → event → storage/rollup → evidence/export/SIEM → browser/CLI | `POL`, `GOV`, `EVID`, `INT`, `READ`, `WEB`, `CLI` | Attribution, privacy, payload tier, retention, escaping and loss disclosure survive each representation and delivery hop |
| Native endpoint reservation → generated config → client DNS/CA → protocol/realm | `REPO`, `DATA`, `HTTP`, `REG`, `CLI`, `BUILD`, `OCI` | The credential destination and selected repository agree; client fallback and ingress rewriting do not silently change the trust boundary |
| Contributor/dependency/patch → build → distributed image/CLI/UI → runtime | `BUILD`, `CLI`, `HTTP`, `BIN`, `FED`, `POL` | The reviewed code, patches and runtime are the ones shipped and executed, including default validation mode and generated assets |
| Migration/restore → new holder → caches/workers → first request | `DATA`, `OPS`, `REG`, `POL`, `INT`, `EVID` | Persisted authority, key custody and schema capabilities remain coherent through recovery and non-database effects stay within their stated guarantees |

## Validation obligations to carry into the audit

The repository already records open work in [Deferred Validation Cards](../docs/guide/Deferred-Validation-Cards.md). Preparation does not close those obligations. Assign them alongside affected inventory items:

- Exact-shipped dependency/advisory census: pin lockfile resolution, dependency patches, Bun/WASM/runtime versions and final artifacts; distinguish advisory relevance from mere package-name matches.
- Production-like flags, topology and reverse proxy: admission of test modes, public/internal/datastore port placement, proxy-chain client-address trust, lease contention/takeover, replica budgets and redirect behavior.
- Native client DNS/CA rollout, ingress literal base-path preservation, and protocol/operations port separation.
- Sweep/worker adversarial interleavings and non-database effects across takeover.
- Minimum-release-age hide/reveal and chart exemption schedules under concurrent state changes.
- Full cryptographic-purpose/key-lifecycle/caller census beyond sampled primitives.

## Bounds of this preparation

No deployed environment, live ingress/IAM/DNS/CA policy, production secrets, actual published image/binary, or complete installed dependency implementation has been audited. The baseline is source reconnaissance and code-grounded target enumeration. Runtime reachability, exploitability, controls, severity and accepted-risk applicability are the subsequent auditor's work.

Discovery depth also varies: large persistence implementation bodies were sampled, migration lineage was inspected without exhaustive snapshot/schema diffs, and the policy compiler/AOT dependency internals were unavailable locally. Their entry points and security contracts are inventory targets, not closed review results. Protocol payloads deliberately treated as opaque by the product, such as RPM cpio content, require a separate consumer/provenance analysis rather than assuming the registry parses them.

If a new entry point, transport, worker, schema authority, client sink, or deployment variant appears, add a discrete inventory item and link its adjacent area. Keep any untested proposition explicit rather than marking an area complete because its file or route has a reference.
