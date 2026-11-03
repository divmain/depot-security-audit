# Security audit finding record

Copy this template for a demonstrated issue or a clearly labeled candidate needing validation. Keep hypothetical taxonomy examples out of the findings ledger.

## Identity and status

- **Finding ID / title:**
- **Status:** candidate / confirmed / needs validation / documented design exposure
- **Inventory item ID(s):**
- **Finding category ID(s):** from [Finding Categories](Finding-Categories.md)
- **Reviewer / date / source revision / working-tree changes:**
- **Affected versions, deployment modes, formats, and configurations:**
- **Evidence confidence:** reproduced / source-proven / partial / hypothesis

## Security claim

- **Expected invariant and canonical contract:**
- **Observed behavior:**
- **Minimum attacker access and controlled inputs:**
- **Boundary crossed:** canonical `TB*`, local `LB-*`, objects/identities involved
- **Impact:** confidentiality, integrity, availability, authority, external effects, and affected population
- **Severity and rationale:** prerequisites, exposure, repeatability, blast radius, persistence/recovery; optional scoring scheme/vector if required by the audit program

## Root cause and evidence

- **Source locations:** file, function, line range, revision
- **Data/control flow:** entry point through validation/authority to sink or state transition
- **Reproduction setup:** synthetic identities/objects, relevant flags, topology/backend, initial state
- **Steps and inputs:** minimal reproducible sequence or precise concurrency schedule
- **Positive/negative controls:** what establishes reachability and distinguishes the violation
- **Expected vs observed outputs and durable effects:** responses, records, blobs, outbound traffic, events
- **Evidence artifacts:** redacted transcripts, focused regression test, traces, hashes, commands/results
- **Unexecuted steps / alternative explanations / falsifying evidence:**

## Existing protections and risk context

- **Protections evaluated and why they do or do not prevent this case:**
- **Applicable accepted-risk entry:** exact residual, in-force protections, owner, reconsideration trigger
- **Disposition:** implementation defect / protection regression / exceeded accepted bound / deployment mismatch / deliberate exposure requiring risk review
- **Related inventory IDs, shared root causes, and duplicate findings:**

## Remediation and closure criteria

- **Smallest change that restores the invariant:**
- **Compatibility constraints:** frozen protocol/CLI/URL contracts, supported modes, failure doctrine
- **Regression proof:** decisive test or deployment experiment, including alternate entry points
- **Required guardians, inventories, documentation, migration, or rollout checks:**
- **Residual risk after the proposed change:**
- **Owner / validation follow-up:**
