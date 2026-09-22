# TDS production scaffold

## Boundaries

The production application is intentionally separate from `design/figma-make-export`. The prototype remains a visual reference and is not imported by, copied into, or modified by this application.

The scaffold uses these boundaries:

- `src/domain`: provider-neutral document and team-access concepts shared by the client.
- `src/features`: route-level product slices. UI state is local only when it is non-authoritative.
- `server/modules`: authentication, capture parsing, redaction, moderation, search, and other business capabilities.
- `server/ports`: replaceable Webex, LLM, and persistence contracts. Provider objects must be normalized before they enter domain workflows.
- `server/routes`: thin HTTP transport handlers. Routes must authenticate, call a capability, and shape safe responses; they must not contain the authorization model.
- `supabase/migrations`: PostgreSQL schema, indexes, and deny-by-default browser access.

## Security posture

- Webex establishes identity; TDS owns account status and team-specific roles.
- In an empty deployment, the first approved OAuth identity bootstraps the organization and initial team administrator. Later first-time users are inactive and unassigned until an administrator grants access.
- The browser never receives the Supabase service-role key, OAuth client secret, Webex bot token, or LLM key.
- User login sessions are revocable server-side records. The browser receives
  only a random opaque `HttpOnly`, `Secure`, `SameSite=Lax` cookie; its SHA-256
  hash is stored for lookup, while Webex access and refresh tokens are encrypted
  with `SESSION_ENCRYPTION_KEY` before storage. Raw Webex tokens MUST NOT be
  returned to browser code or written to logs.
- A normal session has a seven-day sliding inactivity limit and a thirty-day
  absolute limit, further capped by Webex's returned refresh-token lifetime.
  Its browser identifier rotates after twenty-four hours with a five-minute
  previous-token grace period for concurrent requests. TDS refreshes Webex
  credentials server-side before expiry and immediately revokes the session on
  refresh failure, logout, suspension, idle expiry, or absolute expiry.
- Account status and team roles are loaded from authoritative TDS records on
  every authenticated request. Extending the login window MUST NOT cache or
  preserve a permission that an administrator has revoked. Legacy sealed
  eight-hour cookies are accepted temporarily during rollout but are never
  renewed into another legacy cookie.
- All resource authorization is evaluated against the team relationship that grants access. A role in one team does not grant rights in another.
- Every Webex space has one default capture/review team even when multiple teams
  have approved sharing grants. Pending reviews are visible only to the default
  team's Moderators/Admins. Shared teams receive approved-document access, not
  the source team's pending queue.
- Approved Q&A content is organization-wide by default. A review-team
  Moderator/Admin may select team-private visibility before approval or change
  it later; that decision is authoritative server data and is audited. Global
  Q&A visibility MUST NOT expose the pending review, raw Webex conversation,
  participant details, or source attachments to otherwise unauthorized users.
- Bot actors are resolved from authoritative Webex identity to TDS membership.
  Unauthorized actors are ignored before thread retrieval and receive no bot
  response. An out-of-team Moderator/Admin may capture only through an active
  approved space-sharing grant; the capture still routes to the default team.
- Original source snapshots are immutable in application behavior. Thread updates create a new snapshot and review; the published version remains active until approval creates a new version.
- Redaction creates a separate LLM-bound value and never mutates source text.
- Hidden transcript text may contribute to a permitted document match, but search responses must only contain visible published fields. No hidden source snippet, highlight, autocomplete value, or raw match payload may leave the API.
- Permanent Q&A deletion must be implemented as a tracked purge across rows, private storage, indexes, previews, processing artifacts, and backups according to the still-open backup policy. It may not leave a tombstone.

## Authoritative capture flow

The primary workflow begins in Webex, not in the TDS room browser:

1. A user replies inside the relevant conversation thread with the exact command
   `@<capture-identity> document` or `@<capture-identity> update`.
2. Webex delivers a signed message-created webhook. TDS validates the signature,
   resolves the command actor and team/room policy, and acknowledges delivery
   quickly before asynchronous processing.
3. TDS uses a dedicated, organization-managed Webex messaging identity's
   delegated OAuth authorization to retrieve the command, root, and replies.
   A standard bot token is insufficient because bots can read only messages in
   which they are mentioned.
4. TDS stores an immutable snapshot and idempotent capture request. `update`
   appends a snapshot; it never replaces a published version before approval.
5. After the approved redaction and generation stages, a durable draft appears
   automatically in the moderator review queue. Human approval remains required.
6. TDS posts a safe acknowledgement or actionable error to the source thread.

The `/spaces` experience is for diagnostics and controlled fallback use. It is
not the normal moderator capture path, and browser-only capture indicators are
never authoritative.

The preferred MVP capture identity is a dedicated least-privilege organization
user added only to approved rooms. Access and refresh tokens are encrypted at
rest and server-only. A Service App is an allowed later replacement only after
its messaging scopes and identity behavior are confirmed by a Webex admin.
During the test phase, the project owner's organization account may fill this
role with explicit authorization. The selection is stored as data rather than
hard-coded identity information and must be replaced before production rollout.

## Integration gates

Adapters remain disabled until values are provided for Webex OAuth/bot, Supabase, and an approved LLM. The health endpoint reports configuration presence without returning any secret. Production and local development fail closed when a required integration is missing; neither environment substitutes mock product records.

## Data-loading and latency guardrails

- Route navigation MUST NOT issue duplicate requests merely to normalize URL
  state. Settings subsection changes reuse the already-authorized team payload;
  a new core request is required only when the selected team changes or a
  mutation explicitly invalidates it.
- Live Webex room discovery is loaded separately from core team settings and
  only when a room-dependent experience is opened. Display discovery MAY be
  cached in a Worker isolate for up to 60 seconds; membership-changing
  mutations MUST perform fresh Webex validation.
- Independent Supabase reads SHOULD run concurrently. New endpoints MUST avoid
  serial network request chains when later reads do not depend on earlier data.
- Successful, access-controlled GET responses MAY be deduplicated in volatile
  browser memory for a short period. This cache MUST NOT use persistent browser
  storage, MUST be cleared or invalidated after related mutations, and MUST NOT
  weaken server-side authorization.
- Administrative loading endpoints MUST expose safe `Server-Timing` phases so
  Supabase, Webex, and application latency can be distinguished without logging
  secrets or source content.
- Cloudflare Smart Placement is enabled to reduce repeated round trips to
  regional upstream services. Placement is an optimization only; correctness
  MUST NOT depend on a particular Worker location.

## Near-term slices

### Knowledge Chat and retrieval

Knowledge Chat is a server-only retrieval-augmented generation path. The API
rechecks the signed TDS session, resolves the same organization and team access
set used by the library, filters to current published `verified` or `unresolved`
documents, and redacts content before sending it to the configured LLM provider.
`LLM_PROVIDER` selects Gemini or a local Ollama server, while `LLM_MODEL` swaps
models without changing application code. Responses include
the approved document titles used as citations and never expose raw hidden
transcripts to Basic users.

The first slice uses ranked retrieval over published version fields and visible
source messages so existing approved content works before embeddings are loaded.
Migration `202609180017_rag_knowledge_chunks.sql` adds the access-filtered
pgvector table and RPC. Embedding generation and chunk backfill remain a later
deployment step; they must use the same lifecycle and visibility predicates.

1. Implement the approved team settings and sharing model in
   `team-settings-access.md`; preserve the remaining deletion constraints.
2. Monitor encrypted, revocable Webex OAuth sessions in production and add an
   operational purge schedule for expired/revoked session rows before moving
   beyond MVP scale.
3. Add Supabase repositories and server-side authorization/query tests.
4. Implement the dedicated Webex capture identity, signed webhook intake, exact `document`/`update` parsing, idempotent jobs, immutable thread snapshots, and safe Webex acknowledgements. Add attachment intake only after its open policies are resolved.
5. Add configurable redaction, an approved LLM adapter, structured evidence validation, and the moderation editor.
6. Add approval/versioning, rejection timers/purge, access-safe full-text search, favorites, change requests, administration, and audit operations.
