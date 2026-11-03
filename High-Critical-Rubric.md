# Refining existing High items into Critical or High

## Assignment boundary

This pass assesses **only items labeled `high` in the frozen starting ledger**. Each assigned item must finish as exactly `critical` or `high`. Keep an item `high` if it does not meet the Critical threshold, even if you would otherwise question its original rating. Do not reassess, relabel, or supply decisions for any Medium or Low item.

Read only your supplied High-only inventory extract for classification. Do not load the master ledger, original all-band prefix extracts, or original companion ratings to expand your assignment. Source code and canonical documents may be consulted to understand an assigned item's actual responsibility.

The field continues to estimate **likely credible blast radius conditional on a vulnerability in the item**: impact to Socket, customers/downstream users, and data. It is not a probability, confirmed finding severity, CVSS score, or review-effort estimate. Optionality and privileged prerequisites are scheduling considerations; the impact analysis still needs a real supported consumer and propagation path.

## The distinguishing threshold

| Decision | Required consequence |
| --- | --- |
| `critical` | An affirmative, item-specific path to **loss of a deployment/organization trust root, arbitrary execution in a production service or privileged release environment, systemic control of distributed executable content, or catastrophic compromise of the shared authoritative data foundation**. The consequence must escape ordinary principal/repository/workspace/object containment or compromise an equally powerful root asset. |
| `high` | Every assigned item that does not meet that exceptional threshold. This includes serious but bounded account/workspace/repository/content compromise, private artifact disclosure, restricted credential theft, ordinary server-side request forgery, privileged-browser or local CLI compromise without a demonstrated root role, substantial evidence loss, and recoverable service-wide denial of service. |

**Critical is reserved for a demonstrated scope of responsibility, not the worst chain that could be imagined from a High item.** Shared usage, security-themed names, raw input, a parser, a cryptographic operation, or a dangerous-sounding error are not sufficient by themselves. There are no quotas or required Critical examples for a prefix. When the exceptional blast radius is uncertain or depends on unsupported assumptions, retain `high` and explain the ambiguity in your handoff.

## Qualifying Critical mechanisms

An item may qualify through a mechanism such as these, provided its actual role and consumers support it:

- **Identity or deployment authority roots:** arbitrary principal impersonation that reaches deployment-global authority; unrestricted minting or conversion into deployment-wide authority; initial deployment takeover; corruption of a shared authentication/authorization foundation that defeats otherwise independent tenant/object boundaries. Compromise limited to a particular workspace role or scoped publisher remains `high`.
- **Shared key custody:** disclosure, substitution or unauthorized use of deployment-wide signing, session or encryption roots; loss of custody that permits forging authority/policy across the deployment or decrypting its protected secrets. A per-subscription HMAC secret, repository signing key, scoped API token, or one upstream credential is not automatically such a root.
- **Production or privileged release execution:** a credible arbitrary-code/command/write primitive in a production service host or privileged build/release runner, with the actual process's access to shared secrets, data or released artifacts. Parser differential, malformed archive, CPU exhaustion, and a theoretical dependency RCE do not establish this mechanism on their own.
- **Systemic executable distribution:** compromise of the trusted Depot release/update/distribution chain or a shared artifact foundation that can substitute content broadly across independent repositories/consumers. A scoped package/version substitution or a copyable command affecting an ordinary workstation remains `high` absent an explicit wider root role; do not assume every package is ubiquitous or every developer holds release-root credentials.
- **Shared authoritative data catastrophe:** unrestricted bulk disclosure or destructive control across the deployment's protected primary data, credentials or content namespace, or corruption of a central commit/migration/GC boundary capable of catastrophic data destruction requiring disaster recovery. A repository/object-specific error, a bounded restore failure, evidence-only loss, or a process outage that ordinary restart/retry can recover remains `high` unless the item directly establishes the stronger consequence.

These are alternative qualifying mechanisms, not a requirement to imagine all of them for each row. A small routine can be Critical when it owns a real root. A large, widely used subsystem can contain mostly High items when its individual operations remain contained.

## Applying independent controls correctly

1. Identify the **specific failing property**, asset, actor input and consumer from the full item.
2. Let the property under review fail. Retain genuinely independent controls, including credential origin restrictions, tenant binding, scoped permission checks, signature verification, protected storage ownership and sandbox isolation outside this item's responsibility.
3. Follow ordinary supported propagation. If the same helper actually gates both reads and writes, that shared adoption matters. If code executes in a real privileged runner, its actual privileges matter. An imagined future caller or an unrelated second vulnerability does not establish Critical impact.
4. State the **root or shared foundation reached**, its scope, and why containment outside this item does not stop that particular consequence.
5. Distinguish a missing authoritative control from an advisory or redundant check. Do not assume a UI visibility defect bypasses server authorization, a missed invalidation defeats an independent use-time check, or loss of telemetry grants further authority.
6. If that Critical case cannot be made specifically, retain `high`. Do not downgrade to Medium/Low, and do not revisit their existing rows.

## Calibration

| Assigned High item | Critical discriminator |
| --- | --- |
| Token/session verification | `critical` for arbitrary identities including deployment-root authority; `high` when independent provenance/scope restrictions confine the capability to a particular publisher, repository or workspace. |
| Signing/encryption functionality | `critical` for deployment-wide custody or authority roots; `high` for bounded signing/credential contexts with independent wider containment. |
| Package metadata or artifact integrity | `critical` for a shared foundation or distribution trust root that supports broad substitution; `high` for a bounded package/version/workspace consequence. |
| SSRF or redirect admission | `critical` only with a concrete route to root credentials or privileged execution/control; `high` for ordinary internal reachability or scoped credential exfiltration without that additional established effect. |
| Browser or CLI injection | `critical` only when the actual consumer holds an explicit release/deployment-root role or the distribution mechanism itself propagates compromise systemically; otherwise retain `high`. |
| Parser/body/concurrency limits | Shared-process memory/CPU exhaustion remains `high`; a concrete server execution primitive or catastrophic persistent shared-state corruption can qualify as `critical`. |
| Lease, migration or garbage collection | `critical` for catastrophic shared authoritative-data destruction or unrestricted cross-boundary writes; `high` for contention, repeated work, bounded corruption or recoverable availability loss. |
| Audit, SIEM or witness channels | Broad evidence/visibility failure remains `high` unless the item directly compromises root authority, root secrets, or the shared primary-data foundation; do not assume a separate hidden takeover. |

## Output contract

Write only `out/high-criticality/<PREFIX>.tsv`, with actual tabs and this exact header:

```tsv
inventory_id	criticality
```

Include every supplied eligible ID exactly once in input order. Allowed values are only `critical` and `high`. No additional IDs, columns, explanations or Markdown fences belong in the TSV. Do not edit the master, inventory, previous companions, other prefixes or Medium/Low rows. A helper may serialize explicit per-ID decisions or validate completeness; it must not assign labels by keywords or blanket defaults.

In the return message, give the counts and a few difficult examples. For a Critical example, name the actual root/shared asset and propagation path; for a retained High, name the containment or missing exceptional-impact evidence. Explain an unused band without manufacturing examples.

The parent mechanically joins this High-only result and checks that protected Medium/Low rows and every non-criticality field remain unchanged.
