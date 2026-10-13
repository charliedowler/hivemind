# Shared human fixture API

Import from `../fixtures/humans.mjs`:

- `human(ctx, { email, name, domain? })` returns `{ memberId, teamId, cookie, token? }`. Uses real HTTP email/password signup, the mail sink verification code, email verification and password login. `teamId` is the personal hive. No seeded identity fallback is planned. `domain` is optional fixture metadata; the email determines enrollment.
- `claim(ctx, email)` follows the latest claim URL delivered to that email and returns `{ memberId, teamId, cookie }`.
- `bootstrapWithClaim(ctx, email, extra = {})` bootstraps, claims and returns the human fields plus `{ credential, agentId, bootstrap }`.
- `mailFor(ctx, email)` returns mail events addressed to the email.

Inputs use invented `example.com` addresses. Eligible work-domain cases use reserved `*.example.test`: the product correctly classifies `example.com` and all its subdomains as public email domains. This exception is approved by the parent; domain policy is unchanged. Helpers throw on missing mail or unsuccessful HTTP responses. Each caller supplies a unique email. The helper never seeds human identity or membership. Credentials are optional in `human`; callers needing an agent token should call bootstrapWithClaim or bootstrap after a human login followed by claim approval/polling.
