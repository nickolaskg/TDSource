# Team settings, sharing, and access model

**Status:** Approved product decisions and implementation context
**Approved through:** 2026-08-31
**Implementation branch:** `feature/team-settings-access`

This document is the durable implementation context for the TDS team settings
milestone. It records approved behavior, security boundaries, implementation
phases, and the resume point. Later user decisions supersede this document where
they explicitly conflict.

## Product model

TDS has no organization-wide content administrator role for the MVP. Authority
is team-specific:

- Every team has one or more Admins. An existing Team Admin MAY create another
  team through a guided mini-wizard and becomes its initial Admin.
- Admins MAY invite Basic Users or Moderators. Admin status MUST be granted only
  by a separate promotion action after membership exists.
- A user MAY belong to multiple teams and MAY have a different role in each.
- Team roles MUST NOT leak pending reviews or administrative data across teams.
- Any Team Admin MAY view non-secret integration health and register or
  re-register the shared Webex webhook. Secrets remain server-only.
- The final Admin of an active team MUST be protected from demotion/removal
  until another Admin exists or the team is deliberately deactivated.

## Team lifecycle

- Initial setup and new-team creation use a guided flow for team name, pending
  invitations, and Webex-space selection.
- Team Admins MAY rename or deactivate their team. Deactivated teams are hidden
  from new access requests and team pickers but remain in historical audit data.
- Team deactivation removes the team's active memberships. Users remain active
  TDS users, retain memberships in other teams, and retain access to published
  knowledge they otherwise may read. A user with no team shows as unassigned.
- Approved documents from a deactivated team remain searchable. If no active
  team retains staff authority over them, Moderators/Admins from any active team
  MAY revise them. This orphan-document authority MUST be explicit server policy,
  not inferred in the UI.
- Team deactivation is reversible. Team permanent deletion is not approved for
  the MVP and MUST NOT be substituted for deactivation.

## Invitations and membership

- Pending invitations are keyed by normalized email and team. Only the complete
  `tdsynnex.com` domain is approved for now.
- An invitation assigns `basic` or `moderator`. A matching Webex OAuth sign-in
  redeems every valid pending invitation for that email and activates the user.
- Admins MAY list pending/accepted/revoked invitations, revoke a pending invite,
  and copy the ordinary secure TDS sign-in URL. No invitation token or email
  provider is part of the MVP. "Resend" means showing/copying that sign-in URL.
- Revoked invitations MUST NOT activate. Invitation creation, revocation,
  redemption, role change, promotion, demotion, and removal MUST be audited.

## Webex spaces and capture routing

- A Webex space MAY be assigned to multiple teams for access. No team owns the
  Webex space itself.
- Each space MUST have exactly one active **default capture/review team** for
  unambiguous bot routing. This is routing authority, not ownership of Webex.
- The default team receives new pending reviews from that space. Its Admins and
  Moderators see and moderate those reviews; unrelated teams MUST NOT see them.
- The default team's Admins MAY grant another team access while adding the team
  to the space or later in Space management. A recipient Team Admin MAY also
  request access to one or more discoverable active teams/spaces.
- An approved space-sharing grant covers existing and future approved documents
  from the selected spaces. Recipient Basic Users may read; recipient Moderators
  and Admins may revise approved documents. Pending review remains segmented to
  the default capture/review team unless an explicit future requirement changes
  it.
- A source Team Admin MAY revoke a grant. Recipient access ends immediately;
  historical audit records remain.
- Removing one team's assignment MUST NOT stop capture if the space still has a
  valid default team and remains configured. Changing/removing the default team
  requires selecting a replacement or explicitly disabling new capture.

## Bot authorization

The Webex event's authoritative `personId`/email MUST be resolved to the TDS user
linked through Webex OAuth. Webex room roles do not grant TDS authority.

- Basic, inactive, suspended, unregistered, or unauthorized users MUST be
  ignored silently when they post `@<bot-name> document` or `update`: no Webex
  reply, thread retrieval, capture row, LLM call, or audit record.
- A Moderator/Admin in the default capture team MAY capture.
- A Moderator/Admin in another team MAY capture into the default team's review
  queue only when their team has an active approved sharing grant for that
  space. Otherwise the command is silently ignored.
- Once authorized, the document is routed to the space's default capture/review
  team, regardless of which authorized team enabled the actor to issue it.
- Authorization MUST be checked before retrieving or persisting the thread.

## Knowledge visibility and attribution

- A document may be visible to its directly related teams, teams with an active
  sharing grant, or the entire organization.
- New and currently unpublished Q&As default to organization-wide publication.
  The assigned review team's Moderator/Admin MAY mark the Q&A team-private on
  the review card before approval. Previously published private Q&As MUST NOT be
  made organization-wide by a migration without a new human visibility action.
- An organization-wide approved Q&A is readable by every active TDS user. Only
  active Moderators/Admins may revise it. Global publication applies to the
  approved Q&A, not the pending review, original Webex conversation, participant
  details, or source attachments.
- Review-team Moderators/Admins MAY change an approved Q&A between
  organization-wide and team-private. Every approval and later visibility
  change MUST record the selected visibility in audit history. Team-private
  Q&As remain readable by teams covered by an active space-sharing grant.
- Every approved document/version display MUST show immutable
  `originally approved by <person>` and current `last updated by <person>`
  attribution. Approval, edit, status change, archive, restore, and deletion
  actions MUST be audited.
- Archive is reversible and separate from deletion. Permanent deletion is an
  explicit purge and MUST require a strong confirmation describing irreversibility.
  It must follow the constitution's complete-purge rules; backup purge timing
  remains unresolved and blocks claiming immediate removal from backups.

## Access requests

- Only Team Admins MAY request or approve team-to-team access for the MVP.
- Admins MAY discover active teams and their available space names even without
  document access, and MAY select multiple spaces in one request.
- Only an Admin of the default/source team MAY approve or deny a request.
- An approval grants existing and future published knowledge for the selected
  spaces. A revocation removes access immediately.
- Requests and grants require pending/approved/denied/revoked states, actor and
  timestamps, optional safe administrative notes, and append-only audit events.

## Settings information architecture

The Settings area MUST use separate team-aware sections:

1. **Team profile** — select current administered team, rename, status, create a
   new team, deactivate/reactivate with impact confirmation.
2. **Members & invitations** — active members, per-team roles, invite Basic or
   Moderator, promote to Admin separately, revoke pending invitations, copy the
   normal TDS sign-in URL, and protect the last Admin.
3. **Webex spaces** — list spaces available to the capture identity, assignments,
   the default capture/review team, add/remove assignments, and capture state.
4. **Knowledge sharing** — outgoing and incoming space grants, organization-wide
   document visibility controls, and revocation.
5. **Access requests** — discover active teams/spaces; submit, approve, deny, and
   audit multi-space requests.
6. **Integrations** — shared Webex OAuth/capture identity/webhook, Supabase, and
   LLM health. Status and safe actions only; never secret values.
7. **Audit history** — team-scoped invitation, membership, role, space, sharing,
   request, moderation, visibility, archive, and deletion events grouped by
   local calendar date. Date sections are collapsed by default and expand
   independently.

Knowledge sharing is permission configuration. Integrations is technical service
health; the two sections are not redundant.

## Implementation phases and resume point

Implement this milestone in small checkpoints; do not weaken team scoping to
finish a UI screen.

### Existing uncommitted foundation on this branch

- Safe handling for failed draft generation and published updates.
- Direct dashboard-to-review navigation and a separate processing-issue surface.
- Initial-admin setup UI and migration draft.
- Pending invitations that redeem on matching Webex sign-in.
- Supabase-backed approved space policies replacing the room-ID secret.
- A preliminary live integration-status settings panel.

The milestone migrations are:

- `202608310009_preserve_published_updates.sql`
- `202608310010_initial_admin_setup.sql`
- `202608310011_team_settings_and_sharing.sql`

They were applied manually through the Supabase SQL Editor on 2026-08-31 to
project `cqajrqnticedbxmngfwt`, in order and with an explicit transaction around
each migration. All three transactions completed successfully. Because SQL
Editor execution does not automatically populate Supabase CLI migration
history, a future CLI-linking task MUST baseline/repair migration history before
using automated `db push`; it MUST NOT blindly replay migrations `001`–`011`.

Post-migration verification confirmed:

- the invitation, sharing-grant, and access-request tables exist;
- the initial-setup, review-team, and default-capture columns exist;
- all 13 required Settings/invitation/sharing RPC names exist and are executable
  by `service_role`;
- no existing document is missing `review_team_id`; and
- three existing team-space policies are marked as default capture routes.

### Implemented checkpoint (2026-08-31)

- Added forward-only schema and RPC definitions for default capture teams,
  invited roles and revocation, team creation/deactivation, shared-space grants,
  multi-space access requests, organization-wide visibility, document
  attribution, last-Admin protection, and registered-user membership.
- Changed Webex authorization to route authorized default/shared-team staff to
  the default team and silently ignore Basic or unauthorized actors before full
  thread retrieval or any response.
- Segmented pending review authorization by `review_team_id` and changed pending
  update review state to use the capture request, preserving the currently
  published document during approval/rejection/failure.
- Added Settings APIs and the seven-section responsive Settings experience,
  including the new-team mini-wizard, invitations, membership/roles, Webex
  spaces, grants, requests, integration status, and team-scoped audit history.
- Added organization-wide visibility controls and original-approver/last-updater
  attribution to the approved document view.
- Added pure authorization tests for default/shared capture routing, Basic-user
  denial, pending-review segmentation, and shared revision rights.
- Validation passed: typecheck, lint, 23 tests, production build, and a local
  mobile-shell overflow check. Authenticated Settings UI testing remains a live
  rollout gate because deployment secrets are not copied into local development.

### Next rollout checkpoint

1. Sign in locally as a Team Admin and confirm OAuth, invitation redemption,
   Settings loading, and current team/space routing after the applied migration.
2. Deploy this branch only after the local checks succeed.
3. Run synthetic live checks for team creation,
   invitations, space routing, grants, requests, audit, organization visibility,
   and a silently ignored Basic-user Webex command.
4. Confirm Cloudflare reports `SESSION_ENCRYPTION_KEY` and
   `WEBEX_WEBHOOK_SECRET` as active rather than pending, then register/re-register
   the signed webhook from Integrations.
5. Permanent document deletion remains intentionally unavailable until backup
   purge timing is approved; Archive is implemented as the recoverable action.

### Local role-loading regression diagnosed (2026-08-31)

- The Settings navigation remains intentionally visible only when
  `/api/auth/session` returns an Admin role for at least one active team.
- The connected Supabase project contains an active Admin membership for the
  founding TDS account, and the filtered active-team membership query returns
  that role correctly. The database assignment and query are not the fault.
- The previous OAuth path treated Supabase as optional, created a Webex-only
  session without an application user or team roles, and the client consequently
  hid every Administration link without explaining why.
- The completed local configuration still failed because `SUPABASE_URL` was not
  declared in `wrangler.jsonc`'s required Worker bindings. Wrangler loaded the
  declared Supabase server key from `.dev.vars` but silently omitted the valid
  URL entry. Adding `SUPABASE_URL` to the binding declaration and restarting the
  development server changed `/api/health` to report both Supabase bindings and
  `supabaseConfigured: true`.
- Authentication now fails closed when Supabase is unavailable: OAuth cannot
  start, callbacks report `service_not_configured`, session reads return an
  explicit `APPLICATION_DATA_NOT_CONFIGURED` response, and protected API
  sessions cannot silently operate without application identity and roles.
- Local testing requires both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the
  ignored `.dev.vars` file. Never commit or print the server key. Restart the
  local Worker and sign in again after changing either value or Wrangler's
  binding declarations.
- Validation after the fix: typecheck and lint passed; all 25 tests passed; the
  production build passed and reproduced the expected missing-local-secret
  warning until `.dev.vars` is completed.

### Settings loader regression diagnosed (2026-08-31)

- Both Settings and People & Teams use `/api/admin/settings`. The loader failed
  because live room discovery called Webex with `rooms?max=100&sortBy=title`;
  Webex returned HTTP 400 for the unsupported `sortBy=title` value, while
  `rooms?max=100` returned HTTP 200.
- Room discovery now uses the supported request and sorts titles locally.
- A temporary Webex room-list failure no longer prevents team, member,
  invitation, sharing, request, or audit data from loading. The visible Webex
  space list contains only current group rooms returned for the TDS bot; stale
  persisted spaces are retained internally for document history but are not
  presented as selectable rooms. When discovery is unavailable, Settings shows
  no spaces and displays a scoped warning. Mutations requiring live room
  validation still fail explicitly.
- The Settings effect now depends on the stable requested team ID rather than
  the mutable URL-search object, preventing repeated failed API calls.
- The migrated organization currently has not completed initial setup. The next
  fresh Admin session is expected to show the setup wizard before normal
  Settings navigation.
- Validation after this fix: typecheck, lint, 25 tests, and production build
  passed.

### Required validation before deployment

- Migration review and safe application order.
- Tests proving pending-review segmentation across multiple teams.
- Tests proving Basic/unauthorized bot commands have no observable side effects.
- Tests for shared-space capture routing and grant revocation.
- Tests for multi-team roles, last-Admin protection, invitation redemption and
  revocation, deactivation, organization-wide read/staff revision, attribution,
  access-request approval, and audit events.
- Typecheck, lint, complete tests, production build, responsive UI checks, and
  a synthetic Webex/Supabase smoke test.

### Team Admin setup invitations (2026-09-01)

- Any active Team Admin MAY issue a seven-day, single-use setup invitation to
  an approved-domain email. Moderators and Basic Users MUST NOT see, create,
  replace, revoke, inspect, or redeem another person's Admin invitation.
- Only a SHA-256 token hash is stored. The raw link is returned once, and
  issuing a replacement revokes the previous active link for that email.
- Opening a link establishes an encrypted, HttpOnly, same-site setup context
  and removes the raw token from browser history before Webex authorization.
- The authenticated Webex email MUST exactly match the invited email. A link
  alone grants no role, and an inactive invited account MAY access only the
  setup flow until completion.
- Final submission atomically creates one team, assigns the invitee as its
  first Admin, activates that user, records Basic/Moderator invitations, assigns
  selected bot-visible spaces, redeems the link, and writes audit events.
- At least one bot-visible Webex space is required. Existing default capture
  routing MUST NOT be silently displaced; a newly assigned team becomes default
  only when the selected space has no active default.
- Settings shows pending, setup-started, completed, expired, and revoked status.
  Admins MAY revoke an active link or issue a replacement, but a completed link
  can never be reused.

### Global knowledge default and daily audit groups (2026-09-01)

- Migration `202609010015_global_knowledge_default.sql` changes the database
  default for new documents, updates currently unpublished reviews, introduces
  audited visibility-aware moderation, and allows review-team Moderators/Admins
  to change published visibility.
- The review queue displays the intended publication audience. The review dialog
  defaults to organization-wide and offers an explicit team-private checkbox;
  the selected value is submitted atomically with approval.
- Existing published private Q&As are not backfilled. A later human action is
  required to make one organization-wide.
- Audit history groups the existing team-scoped events by the viewer's local
  calendar date. Native date sections are collapsed by default and retain every
  event and timestamp when expanded.
- The migration has been schema-validated, but its visibility behavior is not
  active in production. Production was verified with a `false` column default
  and zero unpublished records changed. For rollout, deploy the compatible
  Worker/UI first, apply migration `015` immediately afterward, and run both
  organization-wide and team-private approval smoke tests. A brief fail-closed
  moderation error is preferable to publishing without the reviewer control.

## Still unresolved

- Backup purge timing for permanently deleted content.
- Permanent user-account deletion and treatment of historical identity.
- Attachment aggregate/type/scanning/retention policy.
- Final organization-tested redaction rules and approved LLM data agreement.
- Whether approved access-request notes are required or optional; implementation
  MAY support an optional non-sensitive note but MUST NOT require one yet.
