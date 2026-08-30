---
name: security-review
description: Review a change for secrets, authorization and attack surface against OWASP ASVS + Top 10.
capability: security
inputs: The change under review (diff/branch), the affected code, config, and dependency manifests.
outputs: A severity-ranked findings report with a Pass / Pass-with-follow-ups / Block verdict.
standard: OWASP ASVS + Top 10
---
# Security review

Scoped, standards-based review of a change to catch security defects before merge or deploy.

## When to use
When a change touches authentication, authorization, secrets, input handling, injection surfaces,
sensitive-data flows, outbound network calls, or dependencies — or whenever the workflow reaches a
security step or a `policy.md` security gate.

## Method
Scope to the diff and its trust boundaries (new inputs, new auth/authz checks, new secrets, new outbound
calls, new dependencies). Walk each area, mapping findings to OWASP Top 10 (2021) and ASVS 5.0:

1. **Authentication & session** (Top-10 A07; ASVS Authentication) — credential handling, MFA where
   required, session lifetime/rotation/invalidation, no auth bypass introduced.
2. **Authorization / access control** (A01) — every new endpoint/action enforces least privilege and
   object-level checks; no IDOR, no missing server-side authz, no privilege escalation.
3. **Secrets & cryptography** (A02) — no secrets in cleartext, source, logs, or fixtures; `.gitignore`
   covers them and a `*.example` is provided; strong algorithms, no hard-coded keys, TLS in transit.
4. **Input validation & injection** (A03) — untrusted input is validated/encoded/parameterised; check
   SQL/NoSQL/command/LDAP injection and XSS on every new sink; no string-built queries.
5. **Sensitive-data exposure & misconfiguration** (A02, A05) — PII minimised and protected, safe error
   messages, secure defaults, no debug/verbose leakage, correct security headers/CORS.
6. **Vulnerable & outdated dependencies** (A06) — new/updated packages checked for known CVEs and
   maintenance; pin and justify additions.
7. **Design, integrity & SSRF** (A04, A08, A10) — threat-model the change for insecure design, unsafe
   deserialization / unsigned update or CI paths, and outbound requests reachable by user-controlled
   URLs (SSRF).
8. **Logging & monitoring** (A09) — security-relevant events are logged without leaking secrets/PII.

Assign each finding a severity (Critical / High / Medium / Low / Info) calibrated to the project's target
ASVS level, and a concrete remediation.

## Output contract
Write findings as a report / task comments alongside the change (granular, one line at a time), each
finding carrying: severity, the Top-10 category, the ASVS requirement id where applicable, location
(file:line), and remediation. End with an explicit verdict: **Pass**, **Pass with follow-ups**, or
**Block**. Report to the orchestrator and group chat with:

```
::spectoflow role=security kind=review msg=<verdict + counts by severity>
::spectoflow role=security kind=finding msg=<severity> <Top-10 cat> <file:line> — <issue>
```

A security-sensitive change routes to the `policy.md` human-approval gate; the skill never self-approves.

## Quality bar
- [ ] Every OWASP Top 10 (2021) category A01–A10 is explicitly marked **Considered** or **N/A**.
- [ ] Each finding has severity + Top-10 category + remediation (+ ASVS id where applicable).
- [ ] Secrets checked: none in cleartext/source/logs; gitignored; `*.example` present.
- [ ] Authz checked on every new endpoint/action (least privilege, object-level).
- [ ] Injection/XSS checked on every new sink; inputs validated/parameterised.
- [ ] New/updated dependencies screened for known vulnerabilities.
- [ ] A clear verdict is stated; no open Critical/High without a recorded human decision.

## References
- OWASP Top 10:2021 — https://owasp.org/Top10/2021/ (A01 Broken Access Control, A02 Cryptographic
  Failures, A03 Injection, A04 Insecure Design, A05 Security Misconfiguration, A06 Vulnerable and
  Outdated Components, A07 Identification and Authentication Failures, A08 Software and Data Integrity
  Failures, A09 Security Logging and Monitoring Failures, A10 Server-Side Request Forgery).
- OWASP Application Security Verification Standard (ASVS) 5.0.0 (2025-05-30) —
  https://owasp.org/www-project-application-security-verification-standard/
