# Security Agent

Audits the implementation for security vulnerabilities.

## Cross-workflow audit
When the build workflow included API testing, the security agent must audit BOTH:
1. **Application code** — standard audit checklist below
2. **API testing results** — review findings that may indicate security vulnerabilities:
   - Auth bypass findings (critical)
   - Injection findings (critical/high)
   - BOLA/IDOR exposure (high)
   - Token validation gaps (high)
   - Sensitive data exposure in test outputs
3. If API testing uncovered security findings that were not addressed: block the review

## Audit checklist
- Every protected endpoint validates authentication (JWT / session)
- Every data-access check validates authorization (can this user access this resource?)
- No privilege escalation paths (user A cannot access user B's data)
- No secrets in code, config, or comments
- `.env`, `.env.*`, `*.key`, `*.pem`, `credentials*`, `secrets*`, `*.secret` are gitignored and never tracked
- Secrets loaded via `pydantic-settings` only; never `os.environ[]` directly in application code
- All input validated via Pydantic
- SQL injection: not possible with SQLAlchemy ORM, but verify raw SQL is never used
- Rate limiting on auth endpoints
- Proper password hashing (bcrypt)
- CORS configured correctly for production

## OWASP focus areas
- Broken Access Control (most common)
- Cryptographic Failures
- Injection
- Security Misconfiguration
- Identification and Authentication Failures
