# High-only refinement calibration

This pass gives each prefix assessor only its originally High items. Each decision is `critical` or `high`; Medium/Low items are excluded from assessment. The threshold is fixed in [High/Critical Rubric](../High-Critical-Rubric.md), and the starting eligible/protected sets are recorded in [the snapshot manifest](high-criticality-input-manifest.json).

The examples below retain item-specific rationales from the assessments. They illustrate the narrower root/systemic threshold and do not assert that any vulnerability exists.

| Assigned item | Decision | Exceptional scope or surviving containment |
| --- | --- | --- |
| `AUTH-002` | `critical` | Failure of the shared cookie-signing root can support forged sessions for deployment-global administrators. |
| `OIDC-095` | `critical` | The audited secret generator also supplies the unscoped bootstrap global-admin credential. Its shared root consumer establishes the stronger scope; ordinary scoped publisher minting alone does not. |
| `HTTP-083` / `NPMCR-032` | `critical` | A restricted credential belonging to a global-admin identity can become an unrestricted descendant if the audited mint-confinement boundary fails. The independent global-admin flag then resolves deployment authority. |
| `REG-127` / `POL-161` | `critical` | Snapshot trust admission protects compiled JavaScript passed to the production loader's `new Function`; a substitution admitted through that boundary reaches process execution rather than only policy outcomes. |
| `BIN-095` / `OPS-030` | `critical` | The custody boundary protects shared encryption and policy/Docker signing roots, with authority across otherwise independent workspaces. |
| `BIN-014` / `OPS-284` | `critical` | Global GC eligibility or shared-namespace isolation can destroy authoritative shared CAS content; independent per-repository addressing alone does not contain that deletion mechanism. |
| `BUILD-035` / `BUILD-267` | `critical` | Release execution or custody of both CLI binaries and their trusted digest manifests reaches a systemic executable-distribution channel. |
| `WEB-328` / `WEB-333` | `critical` | The actual client workflows change a deployment administrator's password or identity-wide administrator grant. Target/secret binding affects a named deployment-root action even with server authorization intact. |
| `WEB-396` | `critical` | Deployment public-URL configuration supplies emailed authentication-capability destinations across independent identities, including administrators. |
| `OIDC-071` | `high` | Failed workload JWT verification still encounters independent registered publisher, service-account, repository/package and provenance constraints. Arbitrary deployment-root authority is not established. |
| `PAM-115` | `high` | Step-up proof binding operates on an independently authenticated session; its failure does not by itself establish arbitrary root identity. |
| `EVID-094` | `high` | False writer health can preserve already-conferred elevations while independent approvals, grant scope and expiry still constrain authority. |
| `DIST-419` | `high` | Repository signing-key custody does not itself establish compromise of the shared deployment encryption root. |
| `GMN-341` | `high` | ZIP interpretation/exhaustion concerns do not establish host writes, production code execution or catastrophic shared-data destruction. |
| `HTTP-012` | `high` | Lease admission and transaction commit fencing are separate controls; failure of the former does not automatically defeat the latter. |

Recoverable resource exhaustion, evidence-plane damage, a scoped credential or package compromise, and ordinary workstation/browser execution remain serious High targets when the exceptional root/systemic consequence is unestablished. Critical examples are not required for every prefix, and no target distribution is enforced.

The [refinement summary](high-criticality-summary.tsv) records only the original High split. The [merge report](high-criticality-merge-report.json) records complete eligibility coverage, unchanged Medium/Low rows, preserved non-criticality fields and row order. The initial companions and [three-band calibration](criticality-calibration.md) remain historical provenance.
