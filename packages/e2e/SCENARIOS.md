# Hive end-to-end matrix

The normative contract is the 13 October onboarding plan, including Addendum 5, revised A11 and A12. Each scenario records its requests, responses, configuration, sink events and database counts. Product assertions fail the run; unsupported external surfaces are reported as blocked, never passed.

| Layer | Named scenarios | Evidence |
| --- | --- | --- |
| Isolation | disposable database, server provenance, external network guard, scratch homes, abort cleanup, real-config fingerprints | migration log, health, rejected requests, before/after hashes |
| Bootstrap | fresh git email, typed email, existing claimed owner, second machine, claim/domain follow, header needs no second auth | installed config, mail, HTTP MCP, owner/agent counts |
| Human OAuth | explicit gohive login with agent revocation, callback/PKCE and completion origin, person-wide consent across two organisations, retired AgentID routes return 404 | redirect chain, token scope, invitations, retirement HTTP responses |
| Join | domain phrase, outside-domain request, admin Slack notification, approve, decline, undo, expiry | mail, Slack, admin HTTP, memberships |
| Creation/invites | human create, repeat/concurrent create, generated phrase/domain, member invite, person-wide invitations, status prompt | HTTP, phrase rows, CLI output |
| Publication | Yes at organisation scope, Choose projects, Not now, future capture, withdrawal/search/snapshot | grant rows, personal originals, audience reads |
| Installer | Claude-only marker, Codex bearer/instructions/no hooks, min-release-age refusal, double-auth regression | real installed files and tool trace |
| Hooks | SessionStart, no selection, fail-to-pass PostToolUse, PreCompact, Stop dedupe, SubagentStop | stdin, JSONL, hook output, HTTP upload trace |
| Capture boundaries | selected/unselected/missing/contradictory repo, private only, organisation search privacy, chat refusal | model-call counts, database rows, MCP responses |
| Capture contract | observation/evidence inference, correction, two downvotes/history, outcome mapping, one vote per actor | MCP, receipts, rows |
| Privacy | credentials, personal data, customer data rejected before any model call; recognised credential redaction as a positive control | real category-provider payloads, rejection and boundary-call counts |
| Output | forbidden vocabulary, ISO times, undo hints, extra confirmations, one missing-detail question | inspected human-facing output (not raw protocol metadata) |
| Real agents | Claude fresh/existing/second machine/join/share, Codex onboarding, actual Bash fail/pass, no selection, unanswered question | CLI versions, stream transcripts, native tool/hook calls, sandbox cleanup |

## Execution layers

1. Start a fresh local PostgreSQL database and apply the repository migrations. Start Next with test-owned replacements only at external model/transport boundaries.
2. Run deterministic scenarios through real routes, installed scripts and MCP HTTP. Fake CLIs model configuration writes only in this credential-free path.
3. Run real installed Claude Code and Codex in per-scenario homes containing copied authentication files only. Pre-answer ordinary questions in prompts and include one missing-detail variant. The native interactive UI is not inferred from a scripted policy.
4. Record product failures with exact steps and expected/actual evidence. Fix harness faults and rerun. Keep real and deterministic results separate.

The local default is `pnpm e2e:real`; `pnpm e2e:fast` needs no local credentials. Pure server cases run deterministically even in the real matrix. Installer behavior is chosen by the version of the locally built installer, not by guessing from API presence.
