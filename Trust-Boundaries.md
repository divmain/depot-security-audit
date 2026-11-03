# Audit trust-boundary map

Prepared from source at `6a72e67b4b580f0bcb9f2c549782068d2d430aa3` on 2026-10-31. This is an audit navigation aid: a described control is a proposition to verify, not an audit verdict.

The canonical **Threat Model** is [`docs/Threat-Model.md`](../docs/Threat-Model.md), particularly its system context, adversary classes, assets, degradation inventory, and accepted assumptions. The `TB` identifiers below retain that document's meanings. Additional `LB-*` labels are local to this preparation pack.

## Product and execution model

Depot is a Bun/TypeScript private package registry and policy-enforcement product. Its supported design centers on a self-hosted organizational deployment; workspace, repository, principal, and credential boundaries still require adversarial testing inside that organization.

- **Control-plane:** Elysia management API, better-auth authentication, SSO/SCIM, browser SPA delivery, policy authority, background work, integrations, and CLI distribution. Composition starts at `packages/control-plane/app.ts`; production startup is `packages/control-plane/index.ts`.
- **Registry-api:** Elysia package-manager protocols. A process binds to a workspace. Namespaced serving and repository-bound native serving have different route compositions. Native processes additionally expose an operations listener. Start with `packages/registry-api/{app,native-app,operations-app,registry-runtime,process-runtime,index}.ts`.
- **State:** PostgreSQL relational authority, optional QuestDB evidence, and a deployment-wide filesystem or S3-compatible blob namespace. Application-level authorization is not a substitute for datastore/network/IAM isolation.
- **Clients:** React SPA, headless HTTP SDK, native compiled CLI, package managers, and CI publishers. The SDK's Eden compile-time contract does not validate arbitrary runtime peers or make browser gates authoritative.
- **Coordination:** a database lease selects the current control-plane writer; registry replicas are separate writers. SSE and internal HTTP distribute state and invalidations. Database commit fencing and external side-effect ordering have different guarantees.
- **Dependencies:** patched authentication/framework libraries, policy compiler/WASM, package parsers, Bun, container bases, CI runners, and release machinery are part of the shipped trust chain.

## Externally reachable surface families

| Surface | Reachability and inputs to establish | Entry points / inventory prefixes |
| --- | --- | --- |
| Management API | `/api/v1/...`; anonymous, cookie, token, session-only, workspace, repository, and deployment scopes vary by handler | `packages/control-plane/app.ts`, `routes/`; `HTTP`, `AUTH`, `IAM`, `PAM`, `REPO`, `POL`, `GOV`, `READ`, `EVID`, `INT`, `OPS` |
| Interactive authentication | `/api/auth/*` forwarding plus Depot-owned bootstrap, onboarding, login-flow, session, and recovery routes; cookies, passwords, redirect state, one-time capabilities | `auth.ts`, `auth-ceremony.ts`, `better-auth-forward.ts`, `routes/login-flows.ts`; `AUTH`, `FED`, `PAM` |
| Provisioning and fact ingestion | `/scim/v2/*` and the separately mounted fact-push routes; distinct bearer namespaces and pre-auth admission | `scim-mount.ts`, `routes/fact-push.ts`; `FED`, `POL` |
| Package protocols | npm, Cargo, Docker/OCI and Helm, PyPI, RubyGems, Maven, NuGet, Go, APK, DEB, RPM, Composer, Generic; metadata, artifacts, publishing, listing, auth, diagnostics, and administrative compatibility verbs | `packages/registry-api/routes/`; `NPMCR`, `OCI`, `PYRC`, `GMN`, `DIST`, `REG` |
| Native protocol and operations listeners | Native repository-root paths, literal base paths, bound repository/endpoint identities; health/readiness and privileged metrics on operations | `native-app.ts`, `operations-app.ts`, `lib/composition-profile.ts`; `HTTP`, `REG`, protocol areas, `BUILD` |
| Trusted publishing | Format-specific audience and OIDC mint-token endpoints in namespaced/native layouts; issuer JWTs and remote verification material | `lib/trusted-publishing.ts`, `packages/types/exposed/trusted-publishing.ts`; `OIDC` |
| SPA, documentation, downloads | SPA/static assets and client configuration, `/api/v1/openapi`, frozen request/login deep links, CLI manifest/binaries, authorized evidence/package downloads | `routes/spa.ts`, `routes/cli-distribution.ts`, UI file routes; `HTTP`, `WEB`, `BUILD`, `CLI`, `EVID`, `BIN` |
| Internal HTTP reachable through placement mistakes or service compromise | `/_internal/*`, plus the internal-token login-flow creation operation; distinguish shared-secret routes from writer-health credential families | `routes/internal-auth.ts`, `routes/event-bus.ts`, `routes/internal-policies.ts`, `routes/elevation-writer-health.ts`; `OPS`, `POL`, `PAM`, `AUTH` |
| Server-initiated outbound traffic | Configured and discovered URLs, upstream bytes and redirects, identity documents, webhook/SIEM delivery, email, Socket responses, checksum DB traffic | `packages/shared/server/egress-guard.ts`, transport callers; `NET`, protocol areas, `FED`, `OIDC`, `INT` |
| Developer/operator entry points | CLI commands, generated package-manager configuration, project/local files, Docker/dev tooling, migrations/backfills, CI/release workflows | `packages/cli/`, `packages/client/`, `tools/`, `.github/`, root deployment files; `CLI`, `BUILD`, `DATA` |

Paths are not interchangeable between layouts. Use `packages/shared/universal/registry-logical-routes.ts` for logical identities and composition membership, then follow the actual mounts. Docker wildcard registrations contain separate operations in `packages/registry-api/routes/docker/logical-routes.ts`. Framework forwarding and conditional test hooks require their own expansion.

## Canonical network and storage boundaries

| ID | Boundary and valuable assets | Main questions for an assigned audit |
| --- | --- | --- |
| TB1 | Untrusted package clients → registry-api; package names, bytes, bearer credentials, anonymous requests; native operations listener included | Which listener/composition admits this method? Is the repository bound before parsing, cache reads, or disclosure? Do alternate methods and pre-resolver routes enforce equivalent scope and limits? |
| TB2 | Clients → control-plane; session/API/SCIM/fact credentials, management authority, evidence | Which credential family is accepted? Are authentication, CSRF/origin, workspace/object scope, duty/rank, and mutation authority independently checked? |
| TB3 | Registry-api ↔ control-plane; internal secret, policy snapshots, events, runtime mode, revalidation, login creation | Distinguish caller authentication from response/content authenticity. Signed policy snapshots have a separate verification chain; other events are not thereby signed. Check replay, stale state, tenant binding, and takeover. Writer-health is a separate credential channel. |
| TB4 | Services ↔ PostgreSQL; identity, permissions, secrets, policies, queues, repository state | Connection custody and placement; scoped SQL predicates, constraints, locking, lease fences, migrations, cache coherence, root-commit effects. A direct DB writer is a stronger attacker than an HTTP user. |
| TB5 | Services ↔ QuestDB; events, replay payloads, compliance evidence, writer-health observations | Network isolation, SQL/ILP parsing, attribution, retention, loss disclosure, reader/writer failures, optional-store behavior, and the power of a network-adjacent evidence forger. |
| TB6 | Services ↔ filesystem/S3 blobs; package bytes, metadata, export artifacts | CAS placement and byte integrity, object membership authorization, staging/publication/GC, filesystem or IAM perimeter, signed S3 transport, presigned bearer URLs, range/conditional serving. CLI distribution also has its own filesystem tree. |
| TB7 | Services ↔ upstream registries; pull/push credentials, metadata and artifacts | URL/DNS/redirect admission, credential destination grants, discovered authentication realms, parser differentials, upstream-supplied digest expectations, first-consumer streaming, promotion side effects. |
| TB8 | Services ↔ Socket API; workspace keys, PURLs, enrichment and event posts | Workspace-key resolution and redaction, destination/credential binding, response authenticity/shape/size, cache keys, resource budgets, degraded policy inputs. |
| TB9 | Control-plane ↔ enterprise/social identity providers; assertions, discovery, JWKS, account identity | Issuer/audience/recipient/state/nonce bindings, replay, account linking, domain verification, provisioning, guarded transport integration, enforcement/recovery exceptions. |
| TB10 | Registry-api ↔ trusted-publishing issuers; JWTs, discovery, JWKS, issuer-specific CAs | Trust-anchor authority, algorithm/key selection, exact issuer/audience/claim checks, TTL and replay ledger, per-caller probe budgets, issuer cache and redirect boundaries. |
| TB11 | Services → webhook/SIEM destinations; event contents and signing/TLS credentials | Subscription scope, root-commit/outbox behavior, egress and credential grants, secret redaction, signed body fidelity, retries, loss visibility, cross-tenant routing and recursion. |
| TB12 | Control-plane → SMTP; reset/invitation/login capabilities and notification content | Operator-controlled relay configuration, transport credentials/TLS, recipient binding, template/header/URL injection, one-time capability exposure, delivery/retry semantics. |
| TB13 | Registry-api → Go checksum database; module identities and transparency data | Private/protected-name refusal before contact or memo reads, path canonicalization, lookup/tile relay resource use, caller admission, and response provenance. |

## Logical boundaries inside those edges

| Local label | Boundary to carry through each item | Code landmarks |
| --- | --- | --- |
| LB-AUTH | Identity ≠ workspace role ≠ duty ≠ repository privilege ≠ credential scope ≠ temporary elevation ≠ global-admin flag | Shared auth/guard modules, `store/read/verify-token.ts`, `types/exposed/credential-contract.ts`, elevation registries |
| LB-CREDENTIAL | Cookie sessions, standard/entitlement/elevation/trusted-publishing `sdp_` credentials, SCIM `sds_`, fact-push `sdf_`, Docker JWTs, writer-health leases, and login capabilities do not inherit each other's authority | Token-mint census, token-origin/scope enforcement registries, service admission plugins |
| LB-OBJECT | Workspace → repository → package → version → file/blob; composite facade → actual member; namespaced slug → native endpoint binding | Repository resolver, composite dispatcher, package-scope projections, native endpoint reservations, scoped store reads |
| LB-STATE | Admission-time decisions → commit-time state → post-commit effects → asynchronous consumers | Identity locks/epochs, lease fence, store transactions/outboxes, sweeps/workers, cache coordinator |
| LB-POLICY | Authored JDM → validated/signed source → compiled executable artifact → verified complete snapshot → cached decision → served bytes/metadata | Policy compiler/signing/snapshot services, registry reconciler, decision cache, serve tickets, drift helper |
| LB-INPUT | Raw URL/header/body/archive → normalized ecosystem coordinate → branded/domain value → SQL/path/URL/HTML/shell output | Types/schema boundaries, protocol parsers, URL validators, config escaping, renderers, runtime-mode wrappers |
| LB-PROVENANCE | Upstream claims, caller-supplied facts, actor/request IDs, timestamps, and digest expectations → security decisions and recorded evidence | Fact materializers, integrity outcome records, request IDs/access stamps, event serializers, threat signals |
| LB-CLIENT | Server-returned text/URLs/configuration → privileged browser, CLI filesystem, child process, package manager, or CI runner | UI render/download hooks, SDK HTTP/retries, CLI credential store/updater, registry-config renderers |
| LB-TOPOLOGY | Process-local cache/limiter/flight → cross-replica state; protocol → operations; control-plane holder → successor | Registry runtime/bindings, event bus reconnect, lease lifecycle, readiness routing |
| LB-BUILD | Contributor/dependency/fixture/tool input → CI job → signed or unsigned release artifact → installed executable | Workflows, lockfile, patches, Docker build, CLI distribution/updater, dev/test harness |

## Read these distinctions before judging behavior

- **Declared failure behavior matters.** Policy evaluation, governance reads, namespace snapshots, metadata hide-regeneration, token verification, and PAM gates do not share one fail-open rule. Trace the particular decision and its cold/warm/error state against the canonical contract.
- **Integrity has a provenance limit.** Hash agreement, upstream authenticity, first-consumer verification, and cached-byte integrity are different claims. Preserve that distinction in evidence and severity reasoning.
- **A signed policy is not necessarily current.** Source/artifact authenticity, snapshot completeness, freshness, anti-replay, revision ordering, and stale authentic fallback need separate checks.
- **A private destination grant is not a credential grant.** The application egress census excludes trusted infrastructure drivers by design. Review each class under its actual contract.
- **Client DNS/CA configuration is outside server egress control.** Native credential destinations and Docker Hub mirror/fallback behavior require deployment/client evidence.
- **Types and guardians are discovery aids.** Branded schemas, `safe*` wrappers, structural inventories, and existing tests are not proofs that every security decision validates untrusted input in the default runtime mode.
- **Documentation can disagree.** For example, Deployment Topology's internal-plane discussion includes signing-workstream language, while the current Threat Model, risk register, and signing modules describe signed snapshots. Resolve the exact property from source and current contract; do not infer an unsigned-policy vulnerability from stale prose.

## Canonical references

- [Threat Model](../docs/Threat-Model.md), [Accepted Security Risks](../docs/design/Accepted-Security-Risks.md), [Deployment Topology](../docs/design/Deployment-Topology.md).
- [Identity, Authorization, and Tokens](../docs/design/Identity-Authz-and-Tokens.md), [Privileged Access Management](../docs/design/Privileged-Access-Management.md), [Trusted Publishing](../docs/guide/Trusted-Publishing.md).
- [Native Registry Serving](../docs/design/Native-Registry-Serving.md), [Composite Repositories](../docs/design/Composite-Repositories.md), [Protected Namespaces](../docs/design/Protected-Namespaces.md).
- [Policy and Enforcement](../docs/spec/Policy-and-Enforcement.md), [Minimum Release Age](../docs/design/Minimum-Release-Age.md), [External Facts](../docs/design/External-Facts.md).
- [Storage and Metadata Architecture](../docs/design/Storage-and-Metadata-Architecture.md), [Event Retention](../docs/design/Event-Retention.md), [SIEM Forwarding](../docs/design/SIEM-Forwarding.md).
- [Deployment Configuration Risk Profiles](../docs/guide/Deployment-Configuration-Risk-Profiles.md), [Deferred Validation Cards](../docs/guide/Deferred-Validation-Cards.md).
