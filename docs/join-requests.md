# Joining with admin approval

A verified person who opens a current organisation join link can request access when their email domain is outside the allowed domains. The person clicks **Request to join**. No reason or second step is required. Their personal hive stays private.

Allowed work domains still join automatically. Joining does not publish personal projects or cells. Unclaimed agents receive the human join link. A human OAuth token can create a request through `hive_join`, which returns `{ "status": "requested" }`.

Admins see pending requests on **Team → Requests**. **Approve** adds the person as a member and follows their owned agents. **Decline** sends one email line to the requester. Requests expire after fourteen days. A declined email can ask again after seven days.

When Slack is connected, Hive sends each reachable admin one DM per request. Reply **approve** or **decline** in that DM, or mention Hive with **approve <name or email>** in a team channel. Hive checks current admin access and acts immediately. An ambiguous name needs an email. A successful action gets a check-mark reaction.

Plain **undo** reverses the last Slack decision by its author within one hour. Approval undo revokes the new membership and its following agents. If that person has already captured or published into the organisation, Hive keeps access and explains why undo is unavailable. A later membership change also blocks undo. A decline email cannot be recalled.

The join page shows pending, declined and expired requests on revisit. After approval it shows **You're in <Team>.** The **Open <Team>** button selects that organisation. The approved landing mounts the onboarding flow’s ShareOnJoin offer. It asks **Share your learnings with <Team>?** **Yes** shares everything from the selected projects, now and in future. **Choose projects** opens the narrower choice. **Not now** leaves learnings personal. The component records the human choice; approval itself does not publish.

## Operations

Migration `0031_join_requests.sql` adds the request history and per-admin Slack delivery receipts. Run the migration runner after a backup and before deploying dependent code. The rollback refuses to delete request history. Do not use schema push.

The existing Slack maintenance cron expires requests and retries pending notification deliveries and unsent decline email. It does not resend a confirmed Slack DM. A transport failure with an uncertain Slack receipt is recorded as `uncertain`, so cron cannot send a duplicate. Inspect Slack before resetting such a receipt to pending. Requests remain actionable on the Team page if Slack is absent or an admin has no matching Slack account.

The phrase service authenticates before lookup, shares the existing human/IP/global limits, and rechecks pause, rotation and generation under locks. Public link scans and GET do not create requests. The decision service checks current human admin authority in the transaction. Requesters cannot decide their own requests through their personal hive.
