---
name: security-review
description: Review secrets, authorization and attack surface.
---
# Security review

## Steps
1. Secrets: none in cleartext; gitignored; `*.example` provided.
2. Authorization: least privilege; check access and auth paths.
3. Attack surface: unvalidated input, injections, network exposure, tokens.

## Output
Findings by severity + fixes. Anything risky → a policy gate.
