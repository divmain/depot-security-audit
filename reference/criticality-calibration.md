# Criticality calibration notes

These are selected consistency checks on the initial per-prefix judgments under the [initial three-band rubric](../Criticality-Rubric.initial.md). The High labels in this historical record precede the separate [High/Critical refinement](../High-Critical-Rubric.md). They are not confirmed findings or an independent second audit of every row.

| Item | Band | Consequence and containment used in calibration |
| --- | --- | --- |
| `AUTH-033` | `high` | Session-cookie authority can survive a row-deletion-only defense; the property under review is continuity of authentication authority, not merely a status display. |
| `FED-083` | `high` | The scoped user lookup is also part of identity mutation paths. A shared isolation failure has a wider consequence than a single read response. |
| `IAM-163` | `medium` | The projection can misrepresent security settings or reveal ciphertext; an independent encryption boundary still protects the usable credential. This is distinct from exposing the plaintext secret or key. |
| `OIDC-060` | `medium` | Early issuer decoding retains independent signature, issuer-binding and egress checks. A decoding defect is not automatically an authenticated token forgery. |
| `GOV-053` | `medium` | Break-glass cleanup and announcements can fail while use-time expiry independently prevents extending the grant. |
| `HTTP-134` | `high` | Request-body capture has a documented temporary debugging workflow in `docs/guide/Debugging-Registry-API.md`. When deliberately instrumented, it handles sensitive request bodies and shared-process allocations. The classification is conditional on that supported instrumentation; current production registration is not asserted. |
| `PYRC-122` | `low` | No production consumer was identified for the Marshal decoder. The item asks about reachability and bounds; a hypothetical future integration alone does not establish a current customer-wide effect. Reclassify if an actual consumer is established. |
| `WEB-032` | `low` | Presentation gating leaves independent server authorization in place. A hidden/disabled-control defect does not acquire the server's authority. |
| `WEB-175` | `high` | Package-controlled text can enter generated policy expressions that a user publishes. The actual client-side responsibility influences authoritative policy, despite server-side permission checks. |
| `CLI-083` | `high` | A display value enters a copyable shell command. The output is an execution boundary rather than ordinary terminal prose. |
| `BUILD-197` | `medium` | Database clone/drop operations are contained by independently provisioned disposable test infrastructure; failures affect that workflow and its assurance. |
| `BUILD-223` | `high` | Downloaded containerd code subsequently executes with privileged runner-host access. Development/test placement does not contain that execution authority. |
| `DATA-263` | `low` | The clock orders browsing; separate tuple-generation clocks govern metadata drift. A browse-order defect does not automatically change policy currency. |
| `NET-078` | `medium` | Stale download templates can disrupt a package workflow while expanded URLs still pass independent destination and credential checks. |

Optional but supported use is distinguished from a consumer that has not been identified. Likewise, a test-only component is rated according to its actual access to secrets, host privileges, artifacts and shared infrastructure. Neither "optional", "test", "UI", "read-only", nor a security-themed title determines a band by itself.

The [initial per-area summary](criticality-summary.initial.tsv) preserves that distribution without enforcing a quota. The [initial merge report](criticality-merge-report.json) records its ID coverage and field preservation. Current ratings live in the master ledger and the High/Critical refinement report.
