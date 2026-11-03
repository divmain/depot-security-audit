# Finding Categories

> **Security-audit preparation only.** This is a taxonomy of possible findings, not a report of
> vulnerabilities in Depot. Every example below is hypothetical. Repository documentation supplies
> intended contracts and review context; its presence does not demonstrate that a control works in
> a particular build or deployment.

**Navigate:** [Identity](#identity-and-authority) ·
[Registry/content](#registry-resolution-and-content-lifecycle) ·
[Policy](#policy-and-security-decision-boundaries) ·
[Input/browser](#untrusted-input-and-browser-facing-behavior) ·
[Network/confidentiality](#network-trust-cryptography-and-confidentiality) ·
[State/evidence/availability](#state-evidence-and-availability) ·
[Supply chain/deployment](#supply-chain-clients-deployment-and-assurance) ·
[Ecosystem coverage](#ecosystem-coverage-lens) ·
[Accepted risks](#accepted-risks-and-limits-of-inference)

## How to use this taxonomy

The scope includes Depot **as an attack target** and **as a vehicle for attacking clients, upstreams,
identity providers, collectors, developer machines, and build systems**, following
[docs/Threat-Model.md][threat]. Include confidentiality, integrity, availability, identity,
accountability, and privacy consequences. Customer supply-chain threats belong here when Depot's
handling of them breaks a security boundary or an applicable product guarantee; merely storing a
malicious package is not, by itself, a vulnerability in a registry.

- **Stable identifiers.** `FC-*` identifiers are durable references, independent of ordering,
  severity, component, or ecosystem. Retain identifiers when refining descriptions; introduce a new
  identifier rather than silently repurposing one. Each identifier also has a Markdown heading.
- **Classify the broken invariant.** Choose the most specific primary category; add secondary
  categories for independently relevant mechanisms or consequences. Record component, protocol,
  trust boundary, and lifecycle as tags rather than duplicating the finding for every endpoint.
  For example, an omitted workspace predicate is `FC-OBJECT-ISOLATION`; a shared cache that drops the
  workspace key is primarily `FC-CACHE-COHERENCE`, with isolation as a secondary category.
- **Category is separate from severity.** None of these categories implies a rating. Assess severity
  using the actual attacker authority, reachability, deployment configuration, affected assets,
  exploit reliability, exposure window, scale, and recovery cost. An authenticated exploit can have
  greater impact than an unauthenticated one. Confidence and evidence quality are separate again.
- **Distinguish status from classification.** A hypothesis, confirmed vulnerability, accepted
  residual, deployment misconfiguration, defense-in-depth concern, and unverified coverage gap can
  concern the same category. Do not turn a missing test, an advisory match, or an unanswered question
  into a demonstrated vulnerability.
- **Use canonical contracts.** [AGENTS.md][agents] supplies repository constraints, registries, and
  guardian locations; [package.json][manifest] identifies workspace/tooling conventions, dependency
  overrides, patches, and verification entrypoints. Canonical `docs/` takes precedence over
  `.janus/` working notes. Distinguish proposed features from implemented behavior. Where documents
  disagree, record the discrepancy and reconcile it against the assessed revision rather than
  treating either passage as proof of a finding.
- **Track chains without inflating counts.** Preserve each independently fixable boundary failure
  and explain the complete attack chain. Do not create separate reports for an injection, the same
  injection's unauthorized read, and the same read's secret disclosure unless they require distinct
  fixes. Conversely, a shared helper does not prove that every adapter or composition uses it.

A later finding record should identify: primary/secondary IDs; affected revision and deployment;
attacker prerequisites; input and entrypoint; crossed boundary and intended invariant; observable
effect and CIA impact; relevant controls and bypass conditions; supporting evidence; uncertainty;
and any risk-acceptance record whose assumptions need reconsideration. No exploitation, dependency
advisory census, tests, or deployment validation is represented by this document.

## Identity and authority

Grounding: [docs/design/Identity-Authz-and-Tokens.md][identity],
[docs/design/Privileged-Access-Management.md][pam],
[docs/guide/Trusted-Publishing.md][publishing], and [docs/Threat-Model.md][threat].

### FC-AUTHENTICATION

**Authentication and principal recognition.** Establishing who presented a request, which credential
family was verified, and whether verification succeeded. Includes cryptographic-token recognition,
credential-header precedence, and separation of real, synthetic, anonymous, and service principals.

**Hypothetical examples:** A malformed Docker JWT is recognized from its issuer-shaped payload and
reaches a capability guard without signature verification. An invalid bearer silently falls back to
anonymous access on a path whose contract requires refusing presented invalid credentials. An `sdf_`
or `sds_` credential is mistakenly accepted as an interactive `sdp_` credential.

### FC-SESSION-LIFECYCLE

**Interactive session continuity and termination.** Session fixation, issuance, provenance, cookie
handling, idle/absolute expiry, sign-out, deactivation, and durable invalidation across cached or
long-lived connections. Bearer-token manufacture belongs primarily to `FC-TOKEN-LIFECYCLE`.

**Hypothetical examples:** A deactivated user resumes an old session after reactivation because the
session-valid-after watermark is not checked. An SSE stream continues exposing evidence beyond its
independent authority deadline after membership removal. A login transition retains an
attacker-selected session identifier instead of establishing the intended authenticated session.

### FC-ENROLLMENT-RECOVERY

**Bootstrap, invitations, recovery, and login ceremonies.** Initial ownership, joining a workspace,
first credentials, emailed links, browser-to-CLI login, and their one-time proofs and user intent.

**Hypothetical examples:** Concurrent bootstrap requests create independent founding authorities
after one request should have closed enrollment. An invitation's workspace or role can be changed
between issuance and acceptance. CLI login completion ignores the displayed user code or delivers
the resulting token to a different flow. A library password-reset or self-sign-up endpoint becomes
reachable despite the documented disabled posture.

### FC-FEDERATION

**Interactive identity federation and account linking.** OIDC/OAuth/SAML transaction binding,
provider ownership, verified domains, claims, JIT login, social-login mapping, and SSO enforcement.
CI workload exchange is separately classified under `FC-TRUSTED-PUBLISHING`.

**Hypothetical examples:** A provider's unverified email claim links to an existing owner's account.
A SAML response is accepted for the wrong audience or request, or a signature validates one XML
element while the application consumes another. An OAuth callback accepts state from another browser
session. A non-owner account obtains the owner-only SSO recovery exemption.

### FC-PROVISIONING

**Directory provisioning and identity reconciliation.** SCIM connection scope, external identifiers,
group-to-team mappings, deprovisioning, tombstones, and reconciliation with invitations or JIT users.

**Hypothetical examples:** A SCIM `externalId` lookup crosses connection or workspace boundaries and
updates another principal. A group PATCH changes locally managed deployment authority. A repeated
provisioning event revives a deactivated account with its prior grants despite the required
reactivation ceremony. A group-delete mode leaves privileges active contrary to the selected
configuration while reporting successful removal.

### FC-AUTHORIZATION

**Action, rank, duty, and privilege enforcement.** Whether the caller may perform a verb on the
selected object, including deployment-global authority, standing-only operations, and checks that
must exist server-side rather than only in the UI.

**Hypothetical examples:** A route accepts repository `admin` where unscoped global-admin authority
is required to create a native credential destination. A team manager can grant a rank they cannot
otherwise administer. A bulk mutation checks the first item but changes unauthorized items as well.
An entitlement principal passes a real-principal guard because a generic read capability is treated
as a workspace role.

### FC-OBJECT-ISOLATION

**Workspace, repository, principal, and object ownership isolation.** IDOR/BOLA, missing join
predicates, cross-object references, per-process bindings, and authorization of relationships as
well as the named object. This applies within Depot's organizational boundary without assuming a
multi-tenant SaaS guarantee.

**Hypothetical examples:** A report download accepts another workspace's job ID. A version-file
lookup checks the requested repository but returns a file belonging to a different version. An OCI
mount authorizes the destination but not the source image's blob membership. A worker loads a
workspace-scoped row by globally unique ID and performs an action under the wrong workspace context.

### FC-CREDENTIAL-SCOPE

**Credential-envelope conservation.** Repository, package, permission, and origin restrictions must
intersect with authority, never expand through rank shortcuts, aggregate reads, search, or
alternative protocols. Includes deny-all versus unrestricted empty-scope semantics.

**Hypothetical examples:** An owner presenting a package-restricted token reads an entire repository
through a rank bypass. A constrained credential downloads an existing audit export despite the
evidence-plane refusal contract. A listing filters rows after pagination but exposes unfiltered
totals. A token scoped only to a composite member is accepted at the composite endpoint even though
the endpoint itself is outside its envelope.

### FC-TOKEN-LIFECYCLE

**Minting, conversion, attenuation, rotation, and revocation of credentials.** Each family's minting
contract governs scope, lifetime, lineage, and origin. Restricted or grant-conferring conversions
must not manufacture prohibited standing authority; ordinary standing-authority minting has its own
contract. Terminal identity/grant transitions must have their documented consequences. Signature
admission alone is `FC-AUTHENTICATION`.

**Hypothetical examples:** A short-lived trusted-publishing token obtains a longer-lived standard
token through a secondary npm mint route. A `token_mint` elevation grant produces a credential with
a broader package set or later expiry than the conferring grant. Revoking a grant misses one family
of grant-manufactured credentials. A token cache accepts a revoked credential beyond its documented
recheck bound.

### FC-TRUSTED-PUBLISHING

**Workload identity to package-publishing delegation.** Registered issuer/workload binding,
service-account selection, issuer discovery and keys, audience separation, publisher ambiguity,
replay prevention, and transactional withdrawal of mint authority.

**Hypothetical examples:** An organization-level matcher is accepted as the required exact workload
binding, allowing an unintended repository's CI job to publish. An exchange accepts a multi-audience
JWT or derives its audience from attacker-controlled `Host`. Two replicas consume one job JWT
because replay uniqueness is local or signature-dependent. A deleted registration still authorizes
a new mint after deletion committed; this differs from the documented lifetime of previously minted
tokens.

### FC-PRIVILEGED-ACCESS

**Temporary elevation and constrained custody.** PAM eligibility, approval, activation, proof
binding, operation classes, full affected-set coverage, expiry/fuses, origin/credential pins,
handoffs, freeze, four-eyes controls, and standing-versus-borrowed authority.

**Hypothetical examples:** Two disjoint narrow grants are combined to authorize an operation that
requires one grant covering its entire affected set. A proof receipt created for one credential
activates another credential's grant. Handoff leaves both holders able to act after the cutover.
A borrowed repository administrator persists a durable security configuration that is explicitly
standing-only. Writer-health evidence has its own category, `FC-WITNESS-INTEGRITY`.

### FC-GOVERNANCE-WORKFLOW

**Business-logic integrity of security decisions and exceptions.** Quarantine, allowlists,
approvals, break-glass, reviewer independence, scoped exceptions, request state transitions, and
posture escalation/de-escalation. A valid credential does not establish a valid workflow transition.

**Hypothetical examples:** An approval for one package/version releases another after the request is
edited. An expired exception still suppresses quarantine. A self-approval reaches a peer-required
flow through a bulk endpoint. A re-quarantine loses to an older release continuation. A posture
automation path lowers posture even though its authority is escalation-only.

## Registry resolution and content lifecycle

Grounding: [docs/design/Composite-Repositories.md][composite],
[docs/design/Native-Registry-Serving.md][native],
[docs/design/Protected-Namespaces.md][namespaces],
[docs/design/Storage-and-Metadata-Architecture.md][storage],
[docs/design/Idempotent-Publish-Design.md][idempotency], and
[docs/design/Search-Design.md][search].

### FC-COORDINATE-CANONICALIZATION

**Agreement on package and artifact identity.** Names, versions, namespaces, paths, qualifiers,
case, Unicode, escaping, and aliases must identify the same object in routing, authorization,
storage, policy, and clients. This is semantic identity disagreement, not generic malformed input.

**Hypothetical examples:** PyPI normalization lets two spellings pass different package-scope checks
but resolve to one project. Go's escaped uppercase path bypasses a protected-root match. Maven
metadata is authorized under its group interpretation but consumed as artifact metadata. A Composer
version alias or a generic flat-layout path reaches content outside the coordinate authorized by
the request.

### FC-ROUTE-ADMISSION

**Coverage and ordering of admission across route compositions.** Elysia hooks, method aliases,
wildcards, native mounts, namespaced mounts, and pre-resolver routes must enforce the applicable
admission before reading data, disclosing existence, or creating side effects.

**Hypothetical examples:** A generic token-download route mounted before the resolver omits public
target selection. A native repository is also served through a namespaced alias. A Docker HEAD or
alternate delete registration misses its GET/DELETE counterpart's guard. An operations-listener
route inherits protocol JWT acceptance that its global-admin metrics contract explicitly excludes.

### FC-ADDRESS-IDENTITY

**Endpoint ownership, reservation, and outward address binding.** Native endpoint uniqueness,
immutable addressing, deployment registry identity, base-path preservation, stable repository IDs,
and the distinction between the addressed and owning repository.

**Hypothetical examples:** Concurrent restore/create operations reserve overlapping native
endpoints. A deleted native repository is replaced at the same slug and an existing process silently
serves the replacement. A deployment URL changes without respecting the recorded registry identity,
redirecting credential-bearing generated configuration. A composite's artifact URLs accidentally
name its private member's address instead of the addressed endpoint.

### FC-COMPOSITE-RESOLUTION

**Security-preserving composition and ownership.** Member ordering, first-owner semantics,
MIN-fold access, dual-scope policy, strictest enforcement, redirect-target resolution, and terminal
versus fall-through behavior. Apply the documented entitlement-scope exception explicitly.

**Hypothetical examples:** A member quarantine becomes a miss, allowing an attacker-controlled later
proxy to answer the same name. A redirect resolves its target without evaluating that target's
member policy. A union index applies composite policy but drops owning-member restrictions.
Reordering members leaves an ownership shortcut serving the former owner's bytes under the new
owner's apparent provenance.

### FC-NAMESPACE-PROTECTION

**Dependency-confusion protection and private-name disclosure prevention.** Protected namespace
matching, proxy trust, overlapping rules, control precedence, listings, batches, and Go checksum
requests. This is narrower than all name normalization or all policy enforcement.

**Hypothetical examples:** An untrusted proxy in `enforce` contacts upstream for a protected name
before returning a refusal. A Composer replacement claim or advisory batch exposes a protected
package through a secondary surface. A Go checksum lookup uses an alternate spelling to disclose a
protected module to the public log. An allowlist or approval improperly overrides a protection
exclusion that the contract makes non-overridable.

### FC-PUBLISH-MUTATION

**Package mutation invariants and upload state machines.** Immutable versions, allowed mutable
versions, tags, yanks, deletes, resumable uploads, retries, checksum deploy, and consistency of the
declared operation with every mutation it actually performs.

**Hypothetical examples:** A duplicate immutable-version publish replaces bytes through an upsert.
A retried OCI upload close uses a different digest but reuses the prior successful result.
A tag-only update changes a protected chart version without the required authority. An npm envelope
validates one version but commits additional versions or tag targets outside its approved affected
set. Intended Maven SNAPSHOT or Composer development-version mutability is not itself a finding.

### FC-METADATA-PROJECTION

**Security equivalence of metadata representations.** Filtering and rewriting across indexes,
search, facets, version lists, sidecars, signed aggregates, conditional responses, and alternate
content types. The visible document must preserve the applicable scope and serving decision.

**Hypothetical examples:** A filtered package page hides a version while its JSON alternative or
sidecar still advertises it. An authorized caller receives `304` for an older, broader listing after
their package envelope narrows. An index rewrites top-level URLs but retains a nested upstream
artifact URL that bypasses the intended Depot path. A union document's counts reveal names its rows
correctly omit.

### FC-ARTIFACT-INTEGRITY

**Binding bytes to the correct expected content.** Digest/length checks, expectation acquisition,
TOFU pins, metadata-to-blob relationships, partial responses, independent sidecars, and truthful
verification outcomes. Byte consistency is distinct from publisher authenticity.

**Hypothetical examples:** A known checksum mismatch is linked into the warm cache despite the
rejection contract. Verification compares a computed digest to an expectation derived from those
same bytes and records it as an independent upstream match. A distribution's checksum is reused for
its metadata sidecar. A truncated or incorrectly sliced response advertises the full object's
successful integrity result without identifying the partial representation.

### FC-PROVENANCE-SIGNING

**Authenticity claims for packages, indexes, and attestations.** Which authority signed which
content, under which repository/key/purpose, and what the signature or provenance statement actually
establishes. Policy-state signatures belong to `FC-POLICY-AUTHENTICITY`.

**Hypothetical examples:** A repository signs a derived index that references another repository's
private blobs because the signing operation failed to bind its inputs. A forwarded npm provenance
bundle names a different tarball digest. A UI label claims verified upstream signatures based only
on a self-attested checksum match. Key distribution supplies a different repository's public key,
causing clients to trust an unintended signing authority.

### FC-PROMOTION-DEPUTY

**Outbound publication as a privileged action.** Promotion uses Depot-held external publishing
credentials or signing keys and can disclose proprietary artifacts or act publicly as the customer.
Distinguish permission to read bytes, manage a destination, and authorize the external publication.

**Hypothetical examples:** A queued promotion executes after its destination changes, sending private
bytes to an unapproved recipient. Policy checks one artifact but a mutable source is replaced before
upload. A reader invokes a worker path that signs and publishes using stored administrator
credentials. A retry bypasses a fresh authorization check required by the promotion contract.

### FC-CONTENT-LIFECYCLE

**Deletion, restoration, deduplication, and garbage-collection safety.** Liveness and confidentiality
of referenced blobs, tombstoned content, forensic holds, staging objects, ref-event accounting, and
restored metadata across filesystem and S3 backends.

**Hypothetical examples:** Deleting an OCI image removes a layer still referenced by another image's
mount. GC disregards a soft-deleted row whose restore window remains open. Restore brings an old
aggregate document back into service without applying current quarantine or protection state.
Repeated cancelled uploads leave staging objects permanently outside cleanup accounting and exhaust
the storage budget.

## Policy and security-decision boundaries

Grounding: [docs/spec/Policy-and-Enforcement.md][enforcement],
[docs/design/Policy-Authoring-and-Editing.md][authoring],
[docs/design/Minimum-Release-Age.md][mra], [docs/design/External-Facts.md][facts],
[docs/design/Security-Plane.md][security],
[docs/design/Helm-Charts-on-Docker-Repositories.md][helm], and
[docs/design/Accepted-Security-Risks.md][risks].

### FC-POLICY-AUTHENTICITY

**Authorized policy source, compiled artifacts, and distributed state.** Publication authorization,
source signatures, complete challenge-bound snapshots, scope/realm binding, custody keys, atomic
installation, and identity of the exact artifact evaluated.

**Hypothetical examples:** A signature covers JDM text but omits fact declarations that change its
meaning. A spoke executes compiled bytes before authenticating the snapshot. An incomplete snapshot
silently removes a restrictive policy. An artifact-channel response supplies the key used to trust
itself. A cache identifies two different signed artifacts only by a reused numeric policy version.

### FC-POLICY-SEMANTICS

**Faithful interpretation of policy and security state.** Correct decision point, outcome vocabulary,
precedence, scope combination, actor/requester attribution, materialization, template behavior, and
agreement between authoring tools and production execution.

**Hypothetical examples:** A control-plane verdict is coerced into the package-serving outcome
vocabulary. An empty analysis result is presented as a clean scan rather than unavailable evidence.
A browser preview hides an engine semantic difference that causes the production rule to allow.
A cached decision keyed only by principal type is reused for actors whose policy-relevant attributes
differ, without another mechanism preserving those distinctions.

### FC-FAILURE-SEMANTICS

**Correct failure polarity and downgrade boundaries.** Fail-open, fail-closed, fail-stale,
no-action, and unavailable must have their documented scope. A policy-evaluation fallback must not
become permission to ignore authentication, credential restrictions, or known unsafe serving state.

**Hypothetical examples:** A broad catch around policy and authorization turns an authentication
error into a serve. An `enforce` repository configured `fail_closed` treats a missing decision as
allow. MRA synchronous hide-regeneration falls back to a document known to contain withheld
versions. An escalation evaluation exception causes an autonomous mutation instead of no action.

### FC-TEMPORAL-GATES

**Release-age and posture-dependent visibility.** Publication-time interpretation, cutoff units,
clock horizons, dist-tag remapping, expiry of age-dependent decisions, and verified content-class
exemptions. Credential lifetime errors stay with the relevant credential category.

**Hypothetical examples:** A regeneration records a cutoff before filtering succeeds, causing a
later request to trust violating metadata. An unverified OCI artifact's declared Helm media type
alone grants the chart release-age exemption. An upstream timestamp rewrite makes an internal
publish appear older than its authoritative creation time. A cached tag answer survives a posture
change past the promised recomputation boundary.

### FC-FACTS-SIGNALS

**Trust and integrity of decision inputs.** External facts, fact-push bindings, analysis identities,
Socket enrichment, threat campaigns, first-seen/velocity signals, provenance, freshness, and the
difference between attacker-influenced observations and authority-conferring facts.

**Hypothetical examples:** An `sdf_` token updates a fact outside its bindings after a concurrent
definition change. A fact fallback resets its read-start age each time it is reused. Replay reports
fresh fact values beside a verdict computed from older values. An external signal's package
identity is not bound to the analyzed digest, so favorable evidence for one artifact is applied to
another. Missing-fact policy behavior must be judged against the documented author-controlled model.

### FC-SANDBOX-ISOLATION

**Untrusted policy execution and runtime containment.** JDM compilation, WASM loading, host imports,
ABI marshaling, memory isolation, worker boundaries, and confinement of compilation/evaluation
capabilities in the service, CLI, and browser.

**Hypothetical examples:** A policy expression reaches a host import that exposes files or network
access outside the intended evaluator interface. An input-length mismatch corrupts data passed
through a WASM host boundary. Reused evaluator memory exposes a prior workspace's policy inputs.
Pathological but confined computation is primarily `FC-RESOURCE-EXHAUSTION`; being compiled to WASM
alone proves neither containment nor a CPU bound.

## Untrusted input and browser-facing behavior

Grounding: [docs/Threat-Model.md][threat] (publish parsers and UI rendering),
[docs/design/API-Design.md][api], [docs/design/Native-Registry-Serving.md][native]
(address values as data), [docs/design/Helm-Charts-on-Docker-Repositories.md][helm],
[docs/guide/Deployment-Configuration-Risk-Profiles.md][profiles], and [AGENTS.md][agents].

### FC-INPUT-VALIDATION

**Runtime admission, schema closure, and type trust.** Security-relevant validation of bytes,
objects, enums, lengths, numeric values, extra properties, and nested state. TypeScript brands and
compile-time client coupling do not validate hostile wire input.

**Hypothetical examples:** A security gate depends on a mode-gated TypeBox wrapper and disappears in
`yolo`. An unknown body property reaches a privileged writer through object spreading. A negative,
overflowing, or non-finite number defeats a resource or expiry bound. A deserialized object supplies
prototype keys that alter a scope/matcher lookup. Both `yolo` and `pedantic` must preserve the safety
tier; mode selection alone is not a finding.

### FC-PARSER-DIFFERENTIAL

**Conflicting interpretations and unsafe structured decoding.** Agreement between upload envelopes,
archive members, extracted metadata, index parsers, policy inputs, and actual package clients.
Includes duplicate keys/members, encoding ambiguity, XML entity handling, and unsafe deserialization.

**Hypothetical examples:** Depot examines the first manifest in an archive while the client installs
the last. npm's JSON metadata declares dependencies different from the tarball used by downstream
tooling. A Ruby Marshal decoder instantiates behavior instead of decoding a restricted data subset.
An XML parser resolves external entities from an uploaded POM. A Cargo frame length causes trailing
bytes to be interpreted differently by validation and storage.

### FC-INJECTION

**Data becoming executable query or program syntax.** PostgreSQL/Drizzle raw fragments, QuestDB
SQL/DDL, search/filter translations, shell commands, subprocess arguments, templates, and expression
construction. Browser execution and generated client snippets have dedicated sink categories below.

**Hypothetical examples:** An audit filter is interpolated into QuestDB SQL. A SCIM filter or Maven
Solr query is translated into a raw SQL fragment without preserving literal boundaries. A signing
helper builds a shell command from a package filename. A user-controlled format or sort key selects
an arbitrary identifier rather than an admitted mapping. Intentional user-authored JDM expressions
are not injection unless they escape their authorized language or capability boundary.

### FC-ARCHIVE-FILESYSTEM

**Filesystem and object-key confinement.** Traversal, absolute paths, symlink/hardlink behavior,
temporary files, permissions, atomic replacement, cross-platform path interpretation, and S3 prefix
boundaries during upload, extraction, download, export, and CLI operations.

**Hypothetical examples:** An archive member escapes the staging root through a symlink followed by
a relative write. A generic artifact path or Windows drive path overwrites a local CLI configuration
file during download. A predictable temporary export file is replaced by another local user before
publication. Cleanup follows a link outside its scratch directory. An object-key normalization bug
lets one upload overwrite another upload's staging prefix.

### FC-HTTP-BOUNDARY

**HTTP message, intermediary, and response-boundary agreement.** Request smuggling/desynchronization,
body framing, duplicate headers, content encoding, redirect/error semantics, range handling, and
early rejection under Bun/Elysia and a real reverse proxy.

**Hypothetical examples:** Ingress and Bun disagree about a request's body boundary, allowing a
second request to inherit the first request's admission. Chunked or encoded bodies bypass a
Content-Length-only ceiling. An early refusal leaves unread body bytes wedging the connection and
shutdown. Framework range processing slices an already-sliced blob again. A refusal status changes
native-client fallback behavior in a way that bypasses the intended registry route.

### FC-BROWSER-CONTENT

**Untrusted content executing or impersonating trusted UI.** Stored/reflected/DOM XSS, unsafe HTML
or Markdown, URL schemes, embedded documents, content sniffing, and CSP-dependent sinks in the React
console and browser-viewable artifact responses.

**Hypothetical examples:** Package description markup executes in an owner's session. A policy trace
or highlighted source renderer bypasses normal React escaping. A package-controlled link is accepted
with an executable scheme. An uploaded HTML/SVG file is served in an active same-origin context
where the browser can exercise console authority. A relaxed CSP makes a previously inert injection
executable; the sink and deployment prerequisite are recorded separately.

### FC-BROWSER-REQUESTS

**Browser-origin and user-intent enforcement.** CSRF, login CSRF, CORS, cookie scope, cross-origin
messages, navigation targets, framing/clickjacking, and boundary checks before authentication
ceremonies perform mutations.

**Hypothetical examples:** A cookie-authenticated management mutation accepts a cross-site form
without the required Origin/CSRF gate. Credentialed CORS reflects an untrusted origin. A step-up
window accepts a `postMessage` from an unrelated origin or flow. A callback permits an external
return URL that carries ceremony material. A framed approval UI lets another site induce a
privileged confirmation.

### FC-OUTPUT-INJECTION

**Generated commands, configuration, exports, and human-facing output.** Context-specific escaping
must survive both the output language and the consuming client's substitutions. Includes shell,
TOML/YAML/INI/XML, Gradle/Ruby, `.netrc`, CSV formulas, terminal control sequences, and header text.

**Hypothetical examples:** A registry address remains shell-quoted but expands as configuration
syntax inside the package client. A newline inserts a second credential destination into a generated
config file. A CSV package field executes a spreadsheet formula when an auditor opens the export.
A package name inserts terminal controls or a misleading hyperlink into a denial message. URL
admission alone is not output escaping.

### FC-CLIENT-STATE

**Browser and SDK state isolation and action binding.** Workspace-scoped query keys, identity
switches, logout cleanup, in-flight callbacks, persisted state, optimistic changes, and the displayed
object/action matching the request ultimately sent.

**Hypothetical examples:** Switching workspaces shows private package data retained under a
workspace-free TanStack Query key. A delayed privileged response repopulates the UI after logout and
another user's login. A confirmation dialog displays workspace A but submits against workspace B
after a navigation race. An SDK maps an error envelope to successful data and drives a follow-on
security action on that false premise.

## Network trust, cryptography, and confidentiality

Grounding: [docs/Threat-Model.md][threat] (outbound transport boundaries),
[docs/design/Identity-Authz-and-Tokens.md][identity],
[docs/design/Storage-and-Metadata-Architecture.md][storage],
[docs/design/Event-Retention.md][retention], [docs/design/External-Facts.md][facts], and
[docs/guide/Deployment-Configuration-Risk-Profiles.md][profiles].

### FC-EGRESS-DESTINATION

**Server-side destination admission and SSRF.** URL-family rules, DNS resolution of all records,
connect-time pinning, redirects, IPv4/IPv6 spellings, ports, schemes, proxy environments, and
application transports hidden inside dependencies. Infrastructure transports have separate
operator-controlled contracts and still require explicit scope.

**Hypothetical examples:** An allowed hostname resolves to a mix of public and private addresses and
the connection selects an unchecked private address. An OIDC discovery fallback or TCP syslog path
bypasses the guarded adapter. A redirect reaches a metadata service without re-admission. An HTTP
proxy environment setting shifts DNS resolution to a proxy and defeats the stated pinning guarantee.

### FC-EGRESS-CREDENTIALS

**Destination-bound authority and data on outbound requests.** Permission to connect is not
permission to send an upstream password, API key, cookie, publishing credential, or sensitive
payload. Includes discovered authentication realms and credential caching.

**Hypothetical examples:** Docker's upstream challenge names a public attacker-controlled realm and
receives stored upstream credentials merely because its URL is network-admissible. A redirect
forwards Authorization to another origin. Credentials cached for one upstream are reused for another
on the same hostname but outside their approved scope. A private-network allowlist is treated as a
blanket grant to forward all workspace secrets there.

### FC-TRANSPORT-TRUST

**Peer authentication and confidentiality in transit.** TLS hostname/chain verification, trust
anchors, downgrade resistance, inbound termination, internal-plane transport, S3/SMTP/database
drivers, and client-side DNS/CA posture. A URL spelling alone does not establish the connected peer.

**Hypothetical examples:** A private issuer's registered CA is applied to unrelated destinations.
An HTTPS request follows a cleartext redirect carrying credential-bearing traffic where downgrades
are forbidden. An internal-plane endpoint is reachable from an untrusted segment over plaintext
despite the deployment's required isolation. A custom TLS connection pins an IP but validates the
wrong hostname or omits certificate validation.

### FC-CRYPTOGRAPHY-KEYS

**Cryptographic construction, purpose separation, and key custody.** Randomness, hash purpose,
constant-time secret comparison, authenticated encryption, signature verification, algorithm
selection, key identity, rotation, retirement, and initialized-key recovery.

**Hypothetical examples:** AES-GCM nonces are reused under a key. Ciphertext for one credential field
can be transplanted into a different authority-bearing context without detection. A retired signing
key remains accepted beyond its intended overlap. A malformed secret comparison throws into an
unsafe fallback. A compatibility MD5/SHA-1 value is incorrectly used as an authorization proof rather
than for its documented protocol purpose. Evaluate algorithms in their actual use, not by name alone.

### FC-SECRET-DISCLOSURE

**Exposure of credentials and secret-bearing material.** API serialization, logs, error bodies,
telemetry, URL paths/query strings, referrers, process arguments, build assets, crash dumps,
configuration exports, and at-rest permissions/encryption.

**Hypothetical examples:** Generic token-in-path requests reach access logs without ingress
redaction. A webhook URL containing embedded credentials appears in a change event. A UI bundle
includes a server secret through an environment substitution or wrong-tier import. A CLI debug error
prints an Authorization header. A signing-key administration response returns private material
instead of the intended fingerprint/presence representation.

### FC-INFERENCE-DISCLOSURE

**Unauthorized inference and enumeration without direct object access.** Status, timing, counts,
facets, errors, digest existence, auth discovery, metrics, and cache-hit differences that reveal
protected state beyond an explicitly permitted public disclosure.

**Hypothetical examples:** A checksum-deploy endpoint lets a user test whether another workspace
stores a proprietary artifact. Distinct unknown-versus-private errors expose private repository
names where the contract requires indistinguishability. A filtered search's facet counts disclose
excluded package families. An unauthenticated health response reveals key IDs, topology, or
configuration secrets. Documented audience discovery and deliberate anonymous-read disclosures need
their own contract-aware assessment.

### FC-CAPABILITY-LINKS

**Delegated read capabilities outside normal session checks.** Presigned blob URLs, token-bearing
downloads, export links, and one-time handoff URLs: entropy, audience/object binding, methods,
lifetime, replay, leakage, and issuance authorization.

**Hypothetical examples:** A presign endpoint accepts an arbitrary digest after authorizing only the
repository named in the URL. A signed link's object path can be changed without invalidating it.
A token-download redirect carries its token into a foreign destination. A response shared by an
intermediary reveals a private capability to another caller. Persistence of an already-issued S3 URL
until its documented expiry is an acceptance question, not automatically a revocation defect.

### FC-PRIVACY-RETENTION

**Collection, minimization, onward disclosure, and retention of sensitive non-secret data.** Private
package names, dependency graphs, actor consumption histories, external fact values, replay inputs,
exports, notifications, and retained backups. Authorization alone does not establish appropriate
handling or an asserted deletion guarantee.

**Hypothetical examples:** A default-redacted report includes per-person consumption history without
its required opt-in. A retention change expires UI access while an export remains available past the
promised deletion boundary. A replay sidecar preserves a field that its documented redaction rule
excludes. A workspace-specific telemetry filter sends another workspace's data externally. Recorded
fact-payload retention must be assessed against actual data classification and receiver custody.

## State, evidence, and availability

Grounding: [docs/design/Deployment-Topology.md][topology],
[docs/design/Idempotent-Publish-Design.md][idempotency],
[docs/design/Event-Retention.md][retention], [docs/design/SIEM-Forwarding.md][siem],
[docs/guide/Webhook-Receivers.md][receivers],
[docs/design/Privileged-Access-Management.md][pam], and [AGENTS.md][agents].

### FC-TRANSACTIONS-RACES

**Atomicity, TOCTOU, and relational invariants.** Authorization/state rechecks at the mutation
boundary, lock order, compare-and-swap, unique constraints, null semantics, savepoints, idempotency,
and database/blob failure ordering. Leadership-generation failures have their own category below.

**Hypothetical examples:** A service-account mint passes a liveness read, waits behind deactivation,
then commits a usable credential after the deactivation transaction. A nullable unique key admits
duplicate authority records. A savepoint callback emits an external event before the root transaction
rolls back. Two concurrent approvals each consume the same single-use request. A retry key can be
reused with a different principal or payload.

### FC-CACHE-COHERENCE

**Cache isolation, poisoning, freshness, and reuse eligibility.** Application caches, single-flight
results, ownership memos, serve tickets, negative caches, ETags, and intermediary caches must carry
the identity, scope, revisions, and absolute deadlines their security decisions depend on.

**Hypothetical examples:** An unscoped caller primes a derived document later served to a restricted
caller. An old in-flight fill overwrites newer policy/protection state after eviction. A reused fact
verdict acquires a fresh TTL on every outer-cache miss. An authenticated response lacks the credential
variation/private-cache contract and is served anonymously. A signed policy replacement with the
same numeric version reuses the prior artifact's allow decision.

### FC-COORDINATION-FENCING

**Leadership, work ownership, and takeover boundaries.** Control-plane lease generations,
transaction commit fences, worker/sweep ownership, cancellation, readiness, and process-local versus
fleet-wide coordination.

**Hypothetical examples:** A predecessor's paused transaction commits after a successor has completed
takeover because the writer bypasses the lease fence. A standby admits a mutation based only on
successful authentication. A sweep acts after losing its lock and deletes live state. A stale job
claim is reclaimed while the former worker still performs a non-idempotent effect. Distinguish these
defects from the documented overlap of already-admitted external effects across takeover.

### FC-INTERNAL-MESSAGING

**Service-to-service authority, message semantics, and replay.** Internal HTTP, SSE bus events,
invalidation hints, response trust, workspace routing, incarnation-bound cursors, resync completion,
and semantic validation beyond structural schemas.

**Hypothetical examples:** A generic event emitter accepts a writer-health message reserved for a
different credential channel. A malformed or foreign-incarnation replay cursor skips required
resynchronization. A hint directly replaces authoritative policy state instead of fetching a
verified snapshot. An old reconnect task marks a newer incarnation fully synchronized. A response
is trusted solely because the outbound request carried the internal shared secret.

### FC-EVIDENCE-INTEGRITY

**Truthfulness, attribution, completeness, and tamper resistance of security evidence.** Audit
events, request correlation, before/after state, policy replay, QuestDB rows, retention classes,
omission signals, and reporting. Distinguish observed actions, completed commits, delivery attempts,
and durable evidence.

**Hypothetical examples:** A client-supplied actor ID becomes authoritative audit attribution.
A mandatory mutation event is omitted on an alias route. An export silently drops failed records
and reports complete coverage. A replay substitutes today's policy or facts for the actual decision
inputs. A network peer with access outside the required QuestDB perimeter rewrites evidence that
reports present as authentic; the store's accepted trust model must be recorded with that exposure.

### FC-INTEGRATION-DELIVERY

**Webhook, SIEM, and notification authenticity and lifecycle.** Signed bytes, timestamp/ID binding,
receiver semantics, subscription isolation, rotation, retry identity, outboxes, disabled/deleted
destinations, and loop suppression. Destination and credential transport failures use the egress
categories as appropriate.

**Hypothetical examples:** Receiver tooling dispatches on an unsigned event header instead of the
signed body. Retries regenerate delivery IDs, defeating deduplication and repeating an external
security action. A queued event is signed with another subscription's secret. Redelivery re-renders
historical payloads under new mappings and changes their meaning. A notification reports successful
approval even though the corresponding transaction rolled back.

### FC-WITNESS-INTEGRITY

**Health evidence that gates elevated operations.** Dead-man registration, instance identity,
report credentials, lease expiry, sequence/freshness, fleet aggregation, and the independent local
writer-health refusal.

**Hypothetical examples:** A newly registered lease with no successful reports counts as healthy
and masks a failing fleet. A captured health report is replayed with a later timestamp but unchanged
sequence. A replica's failed writer is ignored because a healthy peer satisfies the fleet check.
An untrusted payload selects the reporting service identity. Interpret “proven” according to the
documented socket-write-barrier guarantee, not as proof that every audit row was committed.

### FC-RESOURCE-EXHAUSTION

**Adversarial resource amplification and availability loss.** CPU, memory, disk, descriptors,
connections, queues, database work, lock duration, recursion, decompression, regex processing,
serialization, SSE fan-out, and downstream request/egress cost. Consider work both before and after
authentication and across cancellation paths.

**Hypothetical examples:** A small archive expands into an unbounded allocation before policy runs.
A synchronous WASM evaluation monopolizes Bun's event loop despite an outer timer. Slow clients keep
artifact streams and database work alive after cancellation. Unique package requests overflow a
supposedly bounded memo or first-seen buffer. A metadata union multiplies upstream requests and
memory by versions, members, and concurrent callers.

### FC-ABUSE-BUDGETS

**Admission budgets, fairness, and amplification controls.** Rate-limit ordering, keys, trusted
client IPs, anonymous budgets, expensive public probes, authentication failure limits, storage
quotas, and distinction between process-local and deployment-wide limits.

**Hypothetical examples:** OIDC discovery is performed before the unauthenticated probe budget is
charged. Forged forwarded headers produce unlimited limiter keys. Alternating credential or route
aliases bypasses a budget intended to be shared. A nominal workspace limit is enforced per replica
but described as a fleet-wide ceiling. One caller monopolizes a shared anonymous bucket beyond the
documented fairness model. Record intended per-process multiplication rather than assuming it is a
bypass.

## Supply chain, clients, deployment, and assurance

Grounding: [package.json][manifest] and [AGENTS.md][agents];
[docs/guide/Deferred-Validation-Cards.md][deferred];
[docs/guide/CLI-Distribution-and-Updates.md][cli];
[docs/design/Deployment-Topology.md][topology];
[docs/guide/Deployment-Configuration-Risk-Profiles.md][profiles];
[docs/guide/QuestDB-Isolation.md][questdb]; and
[docs/design/Native-Registry-Serving.md][native].

### FC-DEPENDENCY-SUPPLY-CHAIN

**Security of the exact third-party code shipped or executed.** Lockfile resolutions, transitive
dependencies, tarball overrides, patched bundles, Bun and embedded runtimes, native libraries and
memory-safety defects, WASM artifacts, browser bundles, and executable development tools. Separate
advisory applicability from reachability and actual exploitation.

**Hypothetical examples:** A reachable parser vulnerability persists in a nested resolved dependency
although the top-level copy is patched. An Elysia upgrade moves executed code away from the patched
bundle and silently loses a required response-handling fix. A compromised overridden WASM tarball
changes evaluation semantics. A CLI build embeds an affected Bun runtime despite a newer runtime on
the server host. Manifest ranges alone cannot establish any of these claims.

### FC-BUILD-RELEASE

**Integrity of building, signing, and publishing Depot itself.** CI permissions, self-hosted runner
isolation, untrusted pull requests, lifecycle scripts, build caches, actions/images, artifact
provenance, release gating, and deployment-secret exposure during builds.

**Hypothetical examples:** Pull-request-controlled code executes on a runner holding release
credentials. A lower-trust job poisons a cache later used to compile release binaries. An artifact
upload from a different revision is promoted after CI passes on the intended revision. A container
layer retains a build secret. A mutable external build action substitutes artifacts while the
release's version metadata still appears correct.

### FC-CLI-DISTRIBUTION

**Trust and integrity of executable delivery and self-update.** Selection of serving origin,
manifest/target handling, size/digest verification, decompression, atomic replacement, platform
behavior, and rollback semantics on developer and CI machines.

**Hypothetical examples:** An updater verifies compressed bytes but executes different decompressed
bytes. A manifest target controls a filesystem path outside the fixed target map. A failed Windows
replacement leaves an attacker-writable executable in place. Origin selection bypasses the project
configuration trust gate and installs a matching malicious binary/manifest pair. Depot's intentional
convergence to the server version can include a downgrade; that alone is not an update bypass.

### FC-CLIENT-CONFIGURATION

**Local configuration authority and credential custody.** Discovered project files versus
explicitly trusted/home files, precedence, workspace selection, environment variables, local file
permissions, credential writes, logout, and the CLI's bundled import boundary.

**Hypothetical examples:** A cloned project's config silently redirects an exported token to another
origin. Login writes credentials into a discovered project file without the required explicit
decision. Saving a home credential merges attacker-controlled project entries into the trusted
store. Logout clears a different file from the one login wrote. A server-only dependency pulled into
the CLI introduces an unintended local execution or secret-handling surface.

### FC-CLIENT-RESOLUTION

**End-to-end package-manager routing and verification.** Generated client configuration, native
DNS/CA distribution, credential scoping, mirrors, fallback registries, lockfile URLs, and native
client trust roots. Server egress controls do not constrain a client's network behavior.

**Hypothetical examples:** A generated Go proxy list permits public fallback on a protection refusal
despite a Depot-only configuration contract. A native-host deployment lacks its required client DNS
override, sending Depot credentials to the public registry being impersonated. Docker Hub egress
remains open in a mirror deployment whose stated capture guarantee depends on blocking fallback.
Configuration intended to add Depot trust instead disables the client's existing verification.

### FC-DEPLOYMENT-PERIMETER

**Infrastructure reachability, privilege, and isolation.** Public versus internal listeners,
operations ports, database interfaces, blob buckets/volumes, cross-instance namespaces and secrets,
container privileges, host sockets/mounts, and real reverse-proxy trust placement.

**Hypothetical examples:** Public ingress routes `/_internal/*` or a native operations listener
contrary to the required topology. An S3 policy permits unauthenticated reads of private artifacts.
Distinct deployments share a blob namespace, allowing one instance's GC to delete the other's live
content. A runtime container's Docker socket or broad host mount turns a service compromise into host
control. A broad trusted-proxy range makes direct clients authoritative for forwarded addresses.

### FC-CONFIGURATION-POSTURE

**Security-relevant configuration admission and operational defaults.** Environment versus
database-owned settings, precedence, startup checks, test/debug flags, cross-service agreement,
readiness, disabled controls, and whether operators receive an accurate account of the posture
they selected.

**Hypothetical examples:** A production image honors an authentication-bypassing test hook outside
its required test environment. A retired bypass flag unexpectedly grants egress authority. A
standby takes over with conflicting public URLs and begins emitting credential-bearing links to a
different origin. An invalid configuration is silently coerced into weaker enforcement despite a
startup-refusal contract. A health check treats liveness as evidence of fully initialized security
state.

### FC-MIGRATION-RECOVERY

**Security continuity through upgrade, rollback, backup, and restoration.** Schema compatibility,
migration authority, journal integrity, data backfills, key custody, revived credentials, replay
ledgers, stored security revisions, and coherent recovery of relational/blob/evidence state.

**Hypothetical examples:** Restoring an old database resurrects revoked tokens while old clients can
still reach the deployment. A migration drops a uniqueness or scope constraint required for
authorization. Missing initialized policy-signing keys are silently regenerated, erasing the custody
failure. An older service writes fields that discard a newer credential's restrictive origin.
Independent database/blob restores cause an authorized version to resolve to the wrong surviving
content.

### FC-TEST-HARNESS

**Security exposures introduced by development, fixtures, benchmarks, and verification tooling.**
RunStack Markdown/shell execution, mock upstreams, Docker control, local mail/webhook inboxes,
test credentials, generated compose files, live-service lanes, and cleanup boundaries.

**Hypothetical examples:** An untrusted test fixture interpolates content into a host command while
the runner holds live Socket credentials. A fixture service with default credentials is exposed
beyond the intended local network. Generated compose output or captured logs disclose secrets into
CI artifacts. Cleanup resolves an attacker-influenced scratch path outside its designated tree.
Test-only code is accidentally included in a production image or mounted route composition.

### FC-ASSURANCE

**False security assurance and review-coverage integrity.** Mocks, source-scanning guardians,
inventories, selected test suites, build inputs, omission reporting, and claims that a security
property has been established. This is normally an assurance observation until linked to a concrete
security consequence; absence of a test is not itself an exploit.

**Hypothetical examples:** A guardian inventories the namespaced application but omits a native
registration that actually serves traffic. A security regression suite runs only in `pedantic`
while the failing gate is mode-dependent. An e2e result is attributed to new source although images
contain older compiled code. Lost container output or mock authorization behavior makes a bypass
test report success without exercising its assertion. A dependency scanner's incomplete inventory
is presented as a clean census.

## Ecosystem coverage lens

These are **hypothetical review prompts**, not additional finding categories or assertions that
each mechanism is vulnerable. Use the per-format registries and mounted routes as the actual scope
denominator, as directed by [AGENTS.md][agents]. Review each supported method and representation,
including routes served before ordinary repository resolution.

| Ecosystem | Concrete distinctions to carry into the audit | Likely category references |
| --- | --- | --- |
| npm | Scoped-name escaping; base64-in-JSON uploads; multi-version/tag envelopes; packument versus tarball identity; token/revocation aliases; web login; provenance forwarding. | `FC-COORDINATE-CANONICALIZATION`, `FC-PUBLISH-MUTATION`, `FC-TOKEN-LIFECYCLE`, `FC-PARSER-DIFFERENTIAL` |
| crates / Cargo | Length-prefixed publish framing; sparse-index names/checksums; index configuration and download templates; yank state; credential-provider destinations. | `FC-PARSER-DIFFERENTIAL`, `FC-ARTIFACT-INTEGRITY`, `FC-METADATA-PROJECTION`, `FC-EGRESS-CREDENTIALS` |
| Docker / OCI, including Helm | Namespaced versus native image identity; token realms and scopes; catalog/tags; manifest indexes; shared-layer membership and mounts; resumable uploads; chart classification versus verified extraction. | `FC-AUTHENTICATION`, `FC-OBJECT-ISOLATION`, `FC-PUBLISH-MUTATION`, `FC-TEMPORAL-GATES` |
| Go | Escaped module paths; version/info/mod/zip agreement; module-prefix ownership; sumdb lookup/tile relay; client key verification; private-path disclosure and fallback-sensitive status codes. | `FC-COORDINATE-CANONICALIZATION`, `FC-NAMESPACE-PROTECTION`, `FC-CLIENT-RESOLUTION`, `FC-ARTIFACT-INTEGRITY` |
| Maven | Group/artifact metadata ambiguity; snapshot mutability; POM/XML parsing; checksum/signature sidecars; Solr-style search translation; promotion signing. | `FC-PARSER-DIFFERENTIAL`, `FC-INJECTION`, `FC-PUBLISH-MUTATION`, `FC-PROMOTION-DEPUTY` |
| NuGet | Case/version normalization; service-index/resource URLs; registration/catalog projections and JSON-LD keys; nuspec/nupkg agreement; independent catalog hash acquisition. | `FC-COORDINATE-CANONICALIZATION`, `FC-METADATA-PROJECTION`, `FC-PARSER-DIFFERENTIAL`, `FC-ARTIFACT-INTEGRITY` |
| PyPI | Normalized project names; HTML/JSON Simple representations; wheel/sdist filenames and embedded metadata; PEP 658/714 sidecars; per-file ownership across composite members. | `FC-COORDINATE-CANONICALIZATION`, `FC-METADATA-PROJECTION`, `FC-ARTIFACT-INTEGRITY`, `FC-COMPOSITE-RESOLUTION` |
| RubyGems | Restricted Marshal decoding; gem archive structure; compact indexes; dependency metadata; credential aliases; credential-bearing URL and redirect handling. | `FC-PARSER-DIFFERENTIAL`, `FC-ARCHIVE-FILESYSTEM`, `FC-TOKEN-LIFECYCLE`, `FC-SECRET-DISCLOSURE` |
| apk | Concatenated compressed archive members; control-member versus data-member checks; APKINDEX identity and size; Depot-signed derived indexes; client repository-key configuration. | `FC-PARSER-DIFFERENTIAL`, `FC-ARTIFACT-INTEGRITY`, `FC-PROVENANCE-SIGNING`, `FC-CLIENT-RESOLUTION` |
| deb | Release/InRelease and package stanzas; suite/component/architecture boundaries; compressed index variants; digest/size completeness; signing and repository configuration. | `FC-METADATA-PROJECTION`, `FC-ARTIFACT-INTEGRITY`, `FC-PROVENANCE-SIGNING`, `FC-OUTPUT-INJECTION` |
| rpm | repomd/primary XML and advertised package locations; index-to-catalog versus package verification; signatures; generated `.repo` files and client variable expansion. | `FC-PARSER-DIFFERENTIAL`, `FC-EGRESS-DESTINATION`, `FC-ARTIFACT-INTEGRITY`, `FC-OUTPUT-INJECTION` |
| Composer | Provider/p2 metadata; `replace`/`provide` claims; archive/manifest agreement; development-version updates; dist TOFU pins; advisory/notify batches and client-cached documents. | `FC-NAMESPACE-PROTECTION`, `FC-PARSER-DIFFERENTIAL`, `FC-PUBLISH-MUTATION`, `FC-ARTIFACT-INTEGRITY` |
| Generic | Flat versus versioned coordinates; arbitrary filenames/paths; digest deployment; token-in-path downloads; per-file mutation/retention; browser MIME handling. | `FC-ARCHIVE-FILESYSTEM`, `FC-OBJECT-ISOLATION`, `FC-CAPABILITY-LINKS`, `FC-BROWSER-CONTENT` |

Protocol-specific behavior is not interchangeable. In particular, Go's standard module protocol
does not supply a client publish verb, Helm is content within Docker-format repositories, and a
server relay of a checksum log or signature is not server-side signature verification. Use
[docs/design/Storage-and-Metadata-Architecture.md][storage] for the integrity matrix,
[docs/design/Helm-Charts-on-Docker-Repositories.md][helm] for chart semantics, and
[docs/guide/Trusted-Publishing.md][publishing] for the exchange support registry and workflow.

## Cross-boundary and configuration coverage

Apply categories across the relevant combinations below; a success on one combination does not
establish the others. This is a coverage model, not an instruction to execute tests during
preparation.

| Dimension | Distinctions that can change the security result |
| --- | --- |
| Attacker position | Unauthenticated network caller; anonymous reader; entitlement holder; scoped user/service account; elevated insider; compromised IdP/CI workload; malicious upstream; internal-network peer; operator/build dependency compromise. |
| Authority surface | Console API, registry protocol, native operations, internal API, SCIM, fact-push, OIDC exchange, CLI, browser, worker, sweep, and direct infrastructure access. |
| Hosting and addressing | Internal/proxy/composite; namespaced/native; addressed versus owning repository; bound workspace/repository ID; origin versus literal base path; direct routes versus aliases and pre-resolver mounts. |
| Credential state | Session and login provenance; direct versus trusted-publishing standard token; elevation-bound and grant-manufactured token; entitlement; Docker JWT; SCIM/fact-push/writer-health families; expiry, revocation, scope, origin, and empty restrictions. |
| Enforcement state | `off`, `audit`, `soft_enforce`, `enforce`; policy failure mode; posture; quarantine/allowlist/approval; namespace trust; MRA thresholds/exemption classes; PAM freeze and witness settings. |
| Runtime and parser state | `yolo` versus `pedantic`; JSON/XML/binary/multipart/archives; declared versus streamed sizes; alternate methods/content types; untrusted extra properties; browser versus production policy engine. |
| Storage and response | Filesystem/S3; proxy/presigned redirect; metadata/artifact/sidecar; GET/HEAD/range/conditional responses; shared layers; active/trash/staging/export objects. |
| Time and consistency | Cold/warm/negative cache; leader/follower/coalesced request; expiry during I/O; revocation during a mutation; missing/late/reordered events; snapshot replacement; partial failure; cancellation; retry. |
| Lifecycle | Create/update/delete/restore; same ID versus replacement at the same slug; token/key rotation; grant activation/handoff/termination; publisher withdrawal; policy deactivation/republication; namespace trust changes. |
| Topology and recovery | Replica-local versus database-coordinated state; lease takeover; standby readiness; bus incarnation changes; process restart; mixed service versions; schema migration; database/blob restore; separate deployment instances. |
| Client and deployment | Real ingress rewriting and forwarded-header trust; native DNS/CA rollout; package-manager fallback; cached lockfiles/metadata; local project config; actual image/CLI/UI build graph; optional QuestDB; external receiver behavior. |

Useful **hypothetical chain shapes** include:

- Package-controlled metadata → unsafe generated client configuration → credential exfiltration or
  local command execution (`FC-OUTPUT-INJECTION`, `FC-CLIENT-CONFIGURATION`).
- Narrow credential → missed aggregate projection → sensitive evidence → further credential
  compromise (`FC-CREDENTIAL-SCOPE`, `FC-SECRET-DISCLOSURE`).
- Allowed upstream → unapproved authentication realm → external credential theft → malicious public
  release (`FC-EGRESS-CREDENTIALS`, `FC-PROMOTION-DEPUTY`).
- Authoritative policy/protection change → stale in-flight cache fill → prolonged old allow
  (`FC-CACHE-COHERENCE`, with the affected policy/namespace category).
- Influenceable fact/signal → incorrectly attributed automatic decision → excess elevation or
  security-state mutation (`FC-FACTS-SIGNALS`, `FC-PRIVILEGED-ACCESS` or
  `FC-GOVERNANCE-WORKFLOW`).
- Test/CI artifact contamination → trusted release → server or CLI compromise
  (`FC-TEST-HARNESS`, `FC-BUILD-RELEASE`, `FC-CLI-DISTRIBUTION`).

## Accepted risks and limits of inference

[docs/design/Accepted-Security-Risks.md][risks] records exact residuals, affected configurations,
protections, accountable roles, and reconsideration triggers.
[docs/guide/Deployment-Configuration-Risk-Profiles.md][profiles] records configuration-dependent
postures; [docs/guide/Deferred-Validation-Cards.md][deferred] records open validation obligations.
They are inputs to the audit, not blanket exclusions or proof that a deployment satisfies them.

For a scenario overlapping an acceptance:

1. Identify the precise record and invariant. Separate the deliberately permitted behavior from a
   failure of a claimed protection.
2. Re-evaluate its factual basis against the actual revision, runtime/dependency graph, exposed
   routes, deployment topology, client behavior, data sensitivity, and attacker authority.
3. Check the bound: scope, duration, replicas, retained data, and downstream effects. A local or
   single-consumer guarantee must not be silently interpreted as deployment-wide protection.
4. Check whether the accountable ownership and reconsideration conditions still fit the deployment
   and audit objectives. Organizational trust or procedural mitigations require supporting facts.
5. Record whether the result remains the exact accepted residual, exceeds its protections, invalidates
   an assumption, exposes an open product decision, or needs independent validation. Acceptance
   treatment does not determine category, technical severity, or evidentiary confidence.

Important distinctions to preserve:

- **Fail-open is scoped.** Default package-policy evaluation behavior is not a general authentication
  or authorization bypass allowance. Opt-in failure modes, namespace snapshot fallback, PAM, and
  autonomous posture changes have distinct contracts.
- **MRA is principally metadata visibility.** Exact artifact downloads are intentionally outside
  that age gate. Known-digest Docker shared layers also have different gating from manifests. Do not
  infer a promised byte-level quarantine or age guarantee from metadata behavior alone.
- **A digest match is not upstream authenticity or safety.** TOFU, upstream self-attestation,
  client verification, and Depot's signatures on derived indexes prove different things. The
  documented cold first-consumer stream window differs from serving a known mismatch to warm readers
  or followers.
- **Signed policy may still be stale.** Authenticity, complete installation, freshness, and behavior
  under update suppression are different claims. Policy signing does not authenticate every other
  internal-bus event.
- **Revocation depends on credential family.** Ordinary sign-out cache behavior, terminal grant
  cascades, publisher deletion versus already-minted tokens, and previously issued presigned URLs
  have different lifetime guarantees.
- **Evidence infrastructure has bounded claims.** Optional QuestDB, best-effort post-commit webhook
  enqueue, at-most-once delivery legs, syslog socket writes, and writer-health barriers do not imply
  complete, authenticated, durably ingested evidence or exactly-once external effects.
- **Facts and authorized insiders remain trust decisions.** Policy-defined null behavior, declared
  fact trust, owner recovery, namespace proxy trust, and permitted privileged configuration changes
  need assessment against actual customer constraints, rather than automatic treatment as either
  exploitable defects or harmless design choices.
- **Client and operator obligations are real dependencies.** Native public-host impersonation,
  Docker mirror fallback, DNS/CA rollout, datastore placement, and cross-instance isolation cannot
  be established from application guards or server egress rules alone.
- **Repository documentation is not deployment evidence.** Dependency advisories require the exact
  shipped graph and current advisory data; exposure requires deployment facts; protection claims
  require implementation evidence. A deferred card or a passing structural guardian closes neither
  question by itself.

## Repository reference map

All links are relative to `out/Finding-Categories.md`. These sources provide contracts and scope,
not evidence that any hypothetical example occurs.

| Repository source | Use in this taxonomy |
| --- | --- |
| [AGENTS.md][agents] | Package/runtime boundaries, security registries and guardians, safety-tier validation, production/test conventions. |
| [package.json][manifest] | Bun workspaces, build/test entrypoints, dependency override and patched-dependency inventory. |
| [docs/Threat-Model.md][threat] | Target/vector framing, adversaries, assets, trust boundaries, degraded modes, standing assumptions. |
| [docs/design/Identity-Authz-and-Tokens.md][identity] | Principal model, credential families, SSO/SCIM, scope, sessions, token exchange, identity lifecycle. |
| [docs/design/Privileged-Access-Management.md][pam] | Elevation scope, proof/custody, workflow, freeze, witness channel, use-time enforcement. |
| [docs/guide/Trusted-Publishing.md][publishing] | CI workload registration, matcher semantics, exchange behavior, withdrawal and issuer trust. |
| [docs/design/Native-Registry-Serving.md][native] | Endpoint reservations, identity, native mounts, bindings, listener separation, outward URLs and escaping. |
| [docs/design/Composite-Repositories.md][composite] | Ownership, member access, scoped views, dual-scope policy, caches, format-specific resolution. |
| [docs/design/Protected-Namespaces.md][namespaces] | Dependency-confusion controls, trust, admission, listing/batch/Go paths, propagation. |
| [docs/design/Storage-and-Metadata-Architecture.md][storage] | Blob backends, redirect capabilities, integrity/signing/provenance distinctions, reference accounting and GC. |
| [docs/design/Idempotent-Publish-Design.md][idempotency] | Publish partial-failure contracts, immutable/mutable distinctions, OCI upload reservation/commit state. |
| [docs/design/Helm-Charts-on-Docker-Repositories.md][helm] | Classification versus verification, archive metadata, immutability and age exemptions. |
| [docs/spec/Policy-and-Enforcement.md][enforcement] | Decision points, enforcement/failure modes, governance, and control-plane versus serving outcomes. |
| [docs/design/Policy-Authoring-and-Editing.md][authoring] | Compilation, policy tests/simulation, production versus browser engines, API admission. |
| [docs/design/Minimum-Release-Age.md][mra] | Timestamp semantics, cutoff drift, synchronous hiding, serve tickets, artifact exceptions. |
| [docs/design/External-Facts.md][facts] | Fact types, credential bindings, signed declarations, provenance, absolute freshness and replay. |
| [docs/design/Security-Plane.md][security] | Analysis identity, signals, evidence, quarantine and customer-facing security capabilities. |
| [docs/design/API-Design.md][api] | API contracts, errors, correlation, idempotency, client/server coupling. |
| [docs/design/Search-Design.md][search] | Literal shared search versus format-specific search grammars, scope intersection and projections. |
| [docs/design/Deployment-Topology.md][topology] | Lease fencing, readiness, replicas, internal-plane placement, external-effect residuals and instance isolation. |
| [docs/design/Event-Retention.md][retention] | Compact facts versus replay payloads, retention classes, loss/omission visibility and sensitive data. |
| [docs/design/SIEM-Forwarding.md][siem] | Delivery legs, retries, formatting, scopes, and the limits of delivered/proven evidence. |
| [docs/guide/Webhook-Receivers.md][receivers] | Signed raw-byte contract, replay/deduplication, redirects, rotation and receiver semantics. |
| [docs/guide/CLI-Distribution-and-Updates.md][cli] | Origin trust, project/home configuration, credentials, binary distribution and atomic updates. |
| [docs/guide/QuestDB-Isolation.md][questdb] | Required evidence-store placement and interface-specific trust assumptions. |
| [docs/guide/Deployment-Configuration-Risk-Profiles.md][profiles] | Security-relevant configuration defaults, authority, failure behavior and operator obligations. |
| [docs/design/Accepted-Security-Risks.md][risks] | Exact accepted residuals, in-force protections, affected configurations, ownership and reconsideration. |
| [docs/guide/Deferred-Validation-Cards.md][deferred] | Unexecuted dependency, deployment, native-ingress and client DNS/CA validation obligations. |

[agents]: /opt/depot/AGENTS.md
[manifest]: /opt/depot/package.json
[threat]: /opt/depot/docs/Threat-Model.md
[identity]: /opt/depot/docs/design/Identity-Authz-and-Tokens.md
[pam]: /opt/depot/docs/design/Privileged-Access-Management.md
[publishing]: /opt/depot/docs/guide/Trusted-Publishing.md
[native]: /opt/depot/docs/design/Native-Registry-Serving.md
[composite]: /opt/depot/docs/design/Composite-Repositories.md
[namespaces]: /opt/depot/docs/design/Protected-Namespaces.md
[storage]: /opt/depot/docs/design/Storage-and-Metadata-Architecture.md
[idempotency]: /opt/depot/docs/design/Idempotent-Publish-Design.md
[helm]: /opt/depot/docs/design/Helm-Charts-on-Docker-Repositories.md
[enforcement]: /opt/depot/docs/spec/Policy-and-Enforcement.md
[authoring]: /opt/depot/docs/design/Policy-Authoring-and-Editing.md
[mra]: /opt/depot/docs/design/Minimum-Release-Age.md
[facts]: /opt/depot/docs/design/External-Facts.md
[security]: /opt/depot/docs/design/Security-Plane.md
[api]: /opt/depot/docs/design/API-Design.md
[search]: /opt/depot/docs/design/Search-Design.md
[topology]: /opt/depot/docs/design/Deployment-Topology.md
[retention]: /opt/depot/docs/design/Event-Retention.md
[siem]: /opt/depot/docs/design/SIEM-Forwarding.md
[receivers]: /opt/depot/docs/guide/Webhook-Receivers.md
[cli]: /opt/depot/docs/guide/CLI-Distribution-and-Updates.md
[questdb]: /opt/depot/docs/guide/QuestDB-Isolation.md
[profiles]: /opt/depot/docs/guide/Deployment-Configuration-Risk-Profiles.md
[risks]: /opt/depot/docs/design/Accepted-Security-Risks.md
[deferred]: /opt/depot/docs/guide/Deferred-Validation-Cards.md
