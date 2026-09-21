# The Document Source implementation guardrails

These instructions are authoritative for work in this repository. Read
`docs/architecture.md` and `docs/requirements-decisions.md` before changing a
workflow or security boundary. For team administration, invitations, Webex-space
routing, sharing, access requests, or settings work, also read
`docs/team-settings-access.md` in full before acting.

## Preserve the product workflow

- TDS is bot-triggered automation. Its primary capture path is an exact command
  posted as a reply inside the relevant Webex thread:
  `@<capture-identity> document` or `@<capture-identity> update`.
- A successful command retrieves only that thread's root message and replies,
  creates an immutable source snapshot, starts the approved processing pipeline,
  and makes the resulting draft available in the moderator review queue.
- Moderators and administrators should open TDS to find pending reviews already
  waiting. Do not design the primary workflow around browsing rooms, scrolling
  through messages, selecting content, or manually initiating each capture in
  the web application.
- The Webex spaces UI is a diagnostic and tightly controlled fallback surface.
  It must not become the normal capture workflow or the source of authoritative
  capture state.

## Webex automation identity

- A standard Webex bot can receive a message that mentions it but cannot read
  the rest of an unmentioned conversation. Never claim that a bot token alone
  captures complete thread evidence.
- The preferred MVP is a dedicated, organization-managed, least-privilege Webex
  messaging user provisioned solely for TDS. It is mentioned in commands, added
  only to approved rooms, and authorizes the existing OAuth integration.
- Until that identity is approved, the project owner's existing organization
  account is authorized as a test-only capture identity. Do not hard-code the
  person's email, name, or provider ID. Persist the selected identity as server
  configuration so it can be replaced without code changes, and never describe
  the temporary account as the production identity.
- The dedicated account is not an organization administrator. Credential and
  MFA custody remain with the organization's Webex administrators.
- The signed webhook uses the dedicated account's delegated OAuth authorization
  to fetch the command, root, and replies. Access and refresh tokens must be
  encrypted at rest, server-only, revocable, absent from browser JavaScript,
  logs, Git, and client responses, and stored only after explicit approval.
- A Webex Service App may replace the dedicated user only after an administrator
  confirms that its approved scopes and messaging identity support room
  membership, mentions, webhooks, and complete thread retrieval.

## Capture invariants

- Verify `X-Spark-Signature` over the exact raw webhook body using HMAC-SHA1 and
  the server-only shared secret before accepting an event.
- Acknowledge valid webhook deliveries quickly and perform retrieval/processing
  asynchronously. Webhook retries and duplicate commands must be idempotent.
- Parse only the exact `document` and `update` commands after removing the
  provider-supplied mention markup. Do not infer a command from ordinary prose.
- Resolve the command message's `parentId` as the thread root. Reject or safely
  explain commands that are not replies in a thread.
- Re-fetch source data from Webex with the authorized server-side identity. Do
  not trust message text, room titles, actor identity, or thread membership sent
  by a browser.
- Enforce active TDS account status, team membership, room membership/policy,
  and command authorization before storing or processing content.
- `document` creates the first immutable snapshot. `update` creates another
  immutable snapshot and review; it never overwrites source history or replaces
  the currently published version before approval.
- Post a safe acknowledgement or actionable error back to the same Webex thread
  only after the actor is authorized. Basic, inactive, suspended, unregistered,
  and unauthorized actors MUST be ignored without a reply or capture side effect.
  Never expose secrets, raw provider errors, hidden content, or authorization
  details in those responses.

## Review and AI boundary

- Captured source is not published knowledge. Human review is mandatory.
- Do not send real transcripts to an LLM until organization-tested redaction
  rules and an approved provider/data-handling agreement are configured.
- Generated drafts must retain evidence links to immutable source messages.
- Approve/reject actions and review-queue counts must use durable server data,
  not preview fixtures or browser-only state.

## Delivery discipline

- Use a new Git branch for every feature or milestone; never begin feature work
  on `main`. Give the user beginner-friendly branch commands at each transition.
- Preserve user changes and secrets. Never commit `.env`, `.dev.vars`, provider
  tokens, webhook secrets, generated build output, or copied conversation data.
- Validate changes with typecheck, lint, tests, production build, and focused
  live checks proportional to risk before deployment or merge.
