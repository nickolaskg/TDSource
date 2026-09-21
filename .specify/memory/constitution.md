# The Document Source (TDS) Constitution

<!--
Sync Impact Report
- Version: 1.1.0
- Ratified: 2026-08-30
- Scope: All TDS specifications, plans, implementation tasks, reviews, tests,
  database migrations, infrastructure changes, and AI-agent actions.
- Amendment: approved the team-scoped administration, default Webex-space
  routing, silent unauthorized-command handling, space-sharing, access-request,
  invitation, deactivation, organization-wide visibility, and attribution model.
-->

## Purpose and authority

The Document Source (TDS) is a private, single-organization TD SYNNEX
knowledge system. It turns authorized Webex group-thread discussions into
human-moderated, source-grounded Q&A documents for a permissioned library.
TDS is not a public website, a general chat archive, an unmoderated AI
publisher, or a cross-library answer synthesizer.

This constitution governs all future work. Requirements stated directly by the
user are authoritative. The project documents in `docs/` are the product
source of truth; later decision addenda supersede earlier recommendations where
they conflict. `web/docs/requirements-decisions.md` records reconciled
decisions and blocking decisions. The Figma Make export is visual reference
only and MUST NOT define production authentication, authorization, data, or
workflow behavior.

Every feature specification and implementation plan MUST identify the relevant
constitutional principles, affected permissions, data classification, failure
paths, tests, and unresolved decisions. An AI agent MUST NOT silently reinterpret
requirements, change a confirmed workflow, substitute a mock for an
authoritative data source, or weaken a guardrail merely to complete a task.

## Principle 1 — Preserve the authoritative workflow and architecture

TDS MUST preserve this authoritative flow:

`Webex command -> signed event validation -> provider-neutral capture -> immutable source snapshot -> redaction -> structured LLM draft -> human moderation -> approved version -> access-controlled search/library`.

- The primary capture path MUST be an exact `@<capture-identity> document` or
  `@<capture-identity> update` command posted as a reply in a Webex group-space
  thread. The command's parent identifies the root message. Browser room
  browsing is diagnostic or a tightly controlled fallback only; it MUST NOT
  become authoritative capture state or the normal capture workflow.
- `document` MUST create an initial immutable source snapshot. `update` MUST
  retrieve the complete current thread, append a new immutable snapshot and
  review, and MUST NOT overwrite source history or replace a published version
  before human approval.
- Code MUST keep provider-neutral domain concepts separate from Webex, LLM,
  persistence, storage, and transport details. Provider payloads MUST be
  normalized at adapters before entering domain workflows.
- The browser (`web/src`) MUST NOT contain authorization rules, service-role
  database access, provider secrets, webhook verification, or business-state
  transitions. Cloudflare Worker handlers MUST remain thin transport boundaries;
  domain modules and explicit provider/repository ports own policy and workflow.
- Supabase access MUST be mediated by server-side application services. Browser
  database access is deny-by-default. One organization is supported per
  deployment, but core records SHOULD retain an organization identifier where
  practical to preserve a safe future migration path.
- Long-running retrieval, attachment intake, redaction, and LLM work MUST be
  durable, retryable background processing. Webhook delivery MUST be
  acknowledged quickly and idempotently.

## Principle 2 — Authentication, authorization, and least privilege

- Every TDS user MUST authenticate through Webex OAuth; anonymous or public
  library access is prohibited. Webex proves identity, while TDS owns account
  status, team membership, roles, and resource authorization.
- Approved email domains MUST be configuration, compared case-insensitively
  against the complete domain following the final `@`. `tdsynnex.com` is the
  current MVP approved domain. Subdomains and lookalikes MUST NOT be accepted
  unless explicitly configured.
- Authorization MUST be deny-by-default and enforced on every server query,
  mutation, download, transcript operation, and search operation. A role in one
  team MUST NOT grant a role or access in another team.
- Basic Users MAY access only permitted published knowledge and explicitly
  permitted attachments/transcripts; they MUST NOT moderate or administer.
  Moderators MAY capture and moderate only through teams that grant that role.
  Administrative capabilities are team-specific. Any Team Admin MAY create a
  team, manage that team's configuration, or view non-secret shared integration
  status; this MUST NOT grant access to another team's pending review queue.
- Unauthorized Webex command actors MUST be ignored before thread retrieval or
  persistence and MUST receive no bot reply. A shared-team Moderator/Admin MAY
  capture only through an active approved space grant; the result routes to the
  space's single default capture/review team.
- Suspension, deactivation, role change, or team removal MUST revoke resulting
  access immediately, invalidate relevant sessions, and invalidate cached
  browser data. The final active administrator MUST be protected from actions
  that leave TDS without an active administrator.
- OAuth MUST use Authorization Code with PKCE, validate state and nonce, use
  secure short-lived session handling, and avoid exposing tokens to browser
  JavaScript. OAuth redirect URIs MUST be exact configured values.

## Principle 3 — Secrets, infrastructure, and external integrations

- Cloudflare Workers plus Vite/React/TypeScript is the current deployment and
  UI architecture. Supabase PostgreSQL, private storage, and PostgreSQL
  full-text search are the MVP persistence/search choices. Replacing a provider
  MUST happen through a port/adapter and an approved migration plan, not by
  spreading vendor-specific calls across features.
- OAuth client secrets, Webex access/refresh tokens, webhook secrets, Supabase
  service credentials, LLM API keys, encryption keys, and raw provider errors
  are server-only. They MUST NOT be committed, logged, embedded in `VITE_*`
  variables, returned to clients, included in test fixtures, or placed in
  screenshots and documentation.
- Local secrets MUST remain in ignored `.dev.vars` or equivalent secure local
  configuration. Deployed secrets MUST use the hosting provider's secret store.
  Configuration examples MAY name required variables but MUST contain no live
  values.
- Webex webhook intake MUST verify `X-Spark-Signature` over the exact raw body
  with the configured HMAC-SHA1 secret before parsing or accepting an event.
  The Worker MUST re-fetch authoritative messages, room data, and identity from
  Webex; it MUST NOT trust browser-submitted or webhook payload content as the
  captured source.
- A standard Webex bot token MUST NOT be represented as sufficient to read a
  complete unmentioned thread. The capture identity MUST be an approved,
  organization-managed, least-privilege messaging identity (or a later approved
  Service App) and be limited to approved rooms. Its encrypted OAuth tokens
  MUST be server-only, revocable, and replaceable without code changes.
- All external calls MUST have explicit timeouts, bounded retries where safe,
  idempotency behavior, typed/validated responses, and safe failure states.
  Transient failure MUST create an authorized staff-visible processing failure,
  never an invented success or partially published document.

## Principle 4 — Privacy, immutable source, search, attachments, and deletion

- The original captured transcript and source-message ordering are immutable.
  Corrections and updates MUST create new versions/snapshots rather than mutate
  source evidence. Derived drafts and published versions are distinct from
  source data.
- Source transcripts and copied attachments MUST use private storage and
  authorization checks on every preview and download. Public object URLs are
  prohibited. Attachment ingestion MUST enforce the confirmed 25 MB per-file
  maximum and MUST NOT invent a per-Q&A aggregate limit.
- Before making any attachment available, implementation MUST follow the final
  approved type/signature, macro, scanning, filename, and removal-retention
  policies. Until those decisions exist, agents MUST NOT broaden attachment
  formats, allow executable or macro-enabled content, or claim production-grade
  attachment security.
- Transcript visibility for Basic Users MUST default to private and require an
  explicit publication decision. Admins and Moderators retain authorized source
  review access subject to retention policy.
- Search MUST apply access controls before matching and before serializing a
  response. Hidden transcript text MAY contribute to a match only for a
  document the caller may access; responses MUST NOT leak hidden transcript
  excerpts, highlights, autocomplete values, counts, raw matching fields, or
  restricted-document existence.
- Permanent Q&A deletion MUST purge related database rows, transcripts,
  attachments, generated content, search/index data, cached previews, and
  processing artifacts without a TDS tombstone. Rejected items MUST move to
  Rejected after 30 days awaiting review and purge after 30 additional days.
  Backup deletion timing remains unresolved and MUST be explicitly planned
  before production sensitive-data use.
- Audit records MUST be append-only to ordinary users, minimize sensitive
  content, and record actor, action, target, time, and appropriate metadata.
  Deletion MUST NOT be disguised as archival; confirmation UX MUST state the
  effect, reversibility, and retained/purged data.

## Principle 5 — AI/LLM safeguards and human moderation

- No real transcript or attachment-derived text MAY be sent to an LLM until
  organization-tested redaction patterns and an approved provider data-handling
  agreement are configured. Missing approval or configuration MUST fail closed.
- Redaction MUST create a separate sanitized LLM-bound value and MUST NEVER
  overwrite the immutable source. At minimum it MUST target quote, serial,
  contract, subscription, purchase-order, and sales-order identifiers. Rules
  SHOULD use typed placeholders and versioned, testable organization-specific
  patterns.
- The LLM adapter MUST accept sanitized provider-neutral input and return
  schema-validated structured output. Each factual claim or generated section
  MUST retain evidence references to immutable source message IDs.
- Generated content MUST only reorganize and summarize source-supported facts.
  It MUST NOT add external knowledge, inferred commands, assumptions, invented
  steps, or unsupported facts. When the source lacks a solution, the draft MUST
  be Unresolved rather than manufactured as resolved.
- AI output is always a draft. It MUST NOT publish, alter a published version,
  grant access, or approve tags without a Moderator or Admin action. A malformed
  or unsupported output MUST be rejected or retried safely and remain visible
  to authorized staff as a processing issue.
- LLM runs MUST record non-secret reproducibility metadata, including provider,
  model, prompt-template version, redaction-rule version, timestamp, and
  evidence mapping. Future "Ask TDS" or semantic search remains out of MVP and
  MUST NOT be introduced without an approved specification; any future answer
  MUST cite only permitted approved TDS documents.

## Principle 6 — Quality, testing, observability, and delivery discipline

- Every behavior change MUST include proportionate automated tests. At minimum,
  test exact command parsing, webhook signature validation, OAuth state/nonce
  failures, domain matching, team-scoped authorization, idempotency, immutable
  updates, redaction, LLM schema/evidence validation, visibility-safe search,
  lifecycle transitions, and deletion scope whenever affected.
- Tests MUST use synthetic/minimized data. They MUST NOT require or record real
  Webex conversations, credentials, production identifiers, or sensitive
  attachments.
- Before merge or deployment, agents MUST run and report relevant `pnpm`
  typecheck, lint, test, and production build checks, plus focused Worker/API,
  migration, and responsive UI checks according to the changed risk. Tests,
  type checks, lint rules, CI gates, and security controls MUST NOT be removed,
  skipped, weakened, or rebaselined solely to make a change pass.
- APIs MUST return stable, documented, safe error codes and user-appropriate
  messages. Internal diagnostics MAY be logged server-side but MUST NOT reveal
  secrets, raw transcripts, attachments, token material, hidden search terms,
  authorization internals, or provider payloads.
- Logging and audit events MUST make capture, background processing, retry,
  moderation, access control, and destructive-action outcomes diagnosable.
  Health endpoints MAY report integration configuration presence but MUST NEVER
  disclose secret values.
- Dependencies MUST be justified, maintained, pinned through the existing pnpm
  lockfile, and compatible with the Cloudflare Worker runtime. Agents MUST NOT
  add a dependency, privileged service, broad OAuth scope, telemetry product,
  or external data transfer without an approved need and review of its security
  and data-handling implications.
- Code MUST be small, typed, modular, readable, and maintainable. Duplicated
  policy logic, untyped `any` at trust boundaries, hidden side effects,
  hard-coded identity values, and UI-only authoritative state are prohibited.
  Refactors MUST preserve behavior or include an explicit approved migration.

## Principle 7 — Documentation, compatibility, and safe change control

- Specifications MUST distinguish confirmed requirements, recommendations, and
  unresolved decisions. An implementation MUST NOT convert a recommendation or
  mock behavior into production policy without explicit approval.
- Changes to workflows, trust boundaries, configuration, schemas, APIs,
  deployment, provider scopes, retention, or permissions MUST update relevant
  documentation, examples, and operational runbooks in the same change.
- Database changes MUST be forward-only, reviewable migrations with explicit
  authorization/RLS effects, rollback or remediation strategy, and data-impact
  tests. Production data MUST NOT be destroyed, silently reinterpreted, or made
  public by a schema migration.
- Backward compatibility MUST be preserved for published documents, approved
  API clients, webhook retries, and queued processing unless an approved
  migration plan states the break, affected data, rollout, recovery, and owner.
- Every destructive or access-changing operation MUST require explicit user
  confirmation with an impact summary; irreversible actions SHOULD require a
  stronger typed confirmation. Bulk operations MUST enumerate impact, be
  tracked, report partial failures, and preserve final-admin protections.
- Each feature MUST be developed on a dedicated Git branch, not directly on
  `main`, and merged only after review, validation, and deployed-checkpoint
  testing. Agents MUST preserve user changes, avoid destructive Git recovery
  commands, and MUST NOT commit secrets, generated builds, copied source
  conversations, or unrelated modifications.

## Unresolved decisions that block or constrain implementation

The following are deliberately not invented by this constitution. A feature
touching one MUST stop at a safe scaffold or obtain an explicit product decision:

1. **Permanent user deletion.** Historical attribution/audit treatment is not
   decided; permanent account deletion MUST NOT ship until it is.
2. **Backup purge timing.** The timing and restore safeguards for permanently
   deleted material are not defined.
3. **Attachment policy.** Aggregate limits, exact formats/signatures,
   macro/legacy handling, malware-scanning provider, and attachment-removal
   retention are not decided.
4. **Taxonomy and filtering.** Category hierarchy and the meaning of author
   filtering remain undecided.
5. **LLM/redaction governance.** Organization-tested redaction patterns and a
   provider data-handling agreement are mandatory before real-source processing.
6. **Verification ownership.** Who may set or refresh Verified and Last
   Verified remains unresolved beyond the confirmed approval labels.

## Governance

This constitution has priority over convenience, prototype behavior, and
implementation shortcuts. A conflict or exception MUST be raised in the
feature specification and approved by the product owner before implementation.
Any amendment MUST state the affected principles, rationale, migration impact,
security/privacy impact, version bump, and updated ratification date. Minor
clarifications use a patch version; added or materially expanded guardrails use
a minor version; removed or weakened protections require a major version and
explicit product-owner approval.

**Version:** 1.1.0
**Ratified:** 2026-08-30  
**Last Amended:** 2026-08-31
