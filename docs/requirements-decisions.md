# Requirement reconciliation and open decisions

Later addenda supersede earlier recommendations where they conflict.

## Resolved by the addenda

- Spaces are not categorically excluded, and pinned spaces cannot have capture disabled. Publication remains independently Basic-visible or staff-only.
- The per-attachment limit is 25 MB. The earlier suggested 100 MB combined limit is not approved and is not enforced by this scaffold.
- Rejected Q&As are permanently purged after their retention window with no TDS audit tombstone. The earlier recommendation to retain a tombstone is superseded.
- Hidden transcript text remains searchable for otherwise permitted documents. Search results may reveal that a match exists but must expose only visible published fields.
- `@<bot-name> update` retrieves the complete current thread and creates a new review/source snapshot. It does not replace the currently published version before approval.
- `@<bot-name> document` and `@<bot-name> update` are the primary capture interface. They are posted as replies in the relevant thread so the command's parent identifies the source root. Reviewers receive automatically generated queue items; they are not expected to browse and manually select conversations in TDS.
- For the MVP, `<bot-name>` may be the display name of a dedicated, organization-managed Webex messaging user rather than a standard Webex bot. This is necessary because a bot token can read only messages that mention the bot and therefore cannot independently retrieve complete thread evidence.
- Verified or Unresolved is set at approval from the reviewer's resolution decision. Outdated and Deprecated are later staff edits; no review-by date is required.
- Roles are team-specific and access may be granted independently by multiple teams.
- Each team has its own Admins; there is no organization-wide content Admin for
  the MVP. Any Team Admin may create a team and becomes its initial Admin. A user
  may hold different roles in multiple teams.
- Only a team's Moderators/Admins see that team's pending reviews. Approved
  space-sharing grants expose existing and future published documents to the
  recipient team but do not expose the source/default team's pending queue.
- Every Webex space has one default capture/review team for bot routing even when
  multiple teams have access. Authorized staff from a shared team may issue a
  capture, but it routes to the default team's review queue.
- Basic, inactive, suspended, unregistered, and otherwise unauthorized bot
  command actors are silently ignored before thread retrieval or persistence.
- Team Admins may discover active teams/spaces, request or directly grant
  multi-space access, approve/deny requests for their default spaces, and revoke
  grants. Grants cover existing and future approved documents.
- Approved Q&As are organization-wide by default: all active users may read
  them and active Moderators/Admins may revise them. A reviewer from the
  assigned review team MAY explicitly keep a Q&A private to that team during
  moderation. Team-private Q&As remain available to teams covered by an active
  sharing grant. Pending reviews, original Webex conversations, and source
  attachments do not become organization-wide merely because the approved Q&A
  is organization-wide.
- Team Admins may rename/deactivate teams, manage spaces, invite Basic or
  Moderator users, revoke invitations, and separately promote members to Admin.
  Deactivated teams are hidden from new requests; users and approved documents
  remain. Archive and permanent document deletion are separate actions.
- Approved document views retain immutable original approver and current last
  updater attribution. Relevant administrative and document actions are audited.
- Audit history is grouped by local calendar date. Every date section is
  collapsed by default and MAY be expanded independently so a large audit log
  remains usable without removing or hiding recorded events.

## Initial administration setup

The first active administrator MUST complete the TDS setup wizard before using the application. The wizard names the administrator's team, creates pending Basic User or Moderator team invitations from entered email addresses, and records the Webex spaces approved for that team. Invitations are not delivered by email in the MVP; they activate automatically when an invited person next completes an approved-domain Webex sign-in. Space selection is persisted in Supabase and is the capture authorization policy; `WEBEX_ALLOWED_CAPTURE_ROOM_IDS` is no longer used. New teams use the same guided mini-wizard.

The complete approved settings, sharing, capture-routing, invitation, lifecycle,
and access-request rules are recorded in `docs/team-settings-access.md`.

## Blocking product decisions before the affected features are completed

1. **Permanent user deletion history:** decide whether historical attribution is anonymized, retained with identity, or purged. Account deletion must not ship before this is settled.
2. **Backup deletion timing:** define when backups cease to be able to restore permanently purged Q&A data.
3. **Attachments:** set a combined per-Q&A limit, enumerate exact image/Office extensions and signatures, decide macro/legacy formats, select malware scanning, and define removal retention.
4. **Taxonomy and filtering:** decide category hierarchy and which author identity the author filter represents.
5. **Redaction/provider:** provide organization-tested identifier patterns and approve an LLM/provider data-handling agreement before any real transcript is processed.

## Safe scaffold assumptions

- React + TypeScript + Vite is used as the practical lightweight front-end default described in the requirements.
- PostgreSQL full-text/ranked retrieval is the first Knowledge Chat implementation. Answers are generated only from published, accessible, non-deprecated records. The additive `knowledge_chunks` migration provides the vector-search foundation for semantic retrieval once embedding ingestion is enabled.
- Browser database access is denied. The API uses a server-only credential and performs immediate account/team authorization on every request.
- Categories remain flat in the initial schema/UI boundary until hierarchy is decided.
- Published and archived documents remain until authorized permanent deletion; no unapproved expiration policy is invented.
- The Webex spaces browser is diagnostic/fallback functionality. It does not supersede webhook-driven capture, and its local UI state is not authoritative.
- The automated capture identity is least privilege, belongs to the organization, is added only to approved rooms, and uses encrypted server-side OAuth tokens. It is not a system administrator.
- A specifically authorized project-owner account may act as the temporary test capture identity while the dedicated organization account is pending. No personal identifier is hard-coded, and production rollout remains blocked until the temporary identity is replaced or explicitly approved for production.

## User session policy

- A successful Webex OAuth sign-in creates a revocable server-side TDS session;
  the browser stores only an opaque secure cookie. Webex access and refresh
  credentials remain encrypted at rest on the Worker/Supabase boundary.
- The approved usability/security balance for the MVP is a seven-day sliding
  inactivity window and a thirty-day absolute window. The absolute window is
  shortened automatically if Webex returns a shorter refresh-token lifetime.
- The opaque browser identifier rotates every twenty-four hours. A five-minute
  grace period for the immediately previous identifier prevents ordinary
  parallel page requests from causing an accidental sign-out.
- TDS refreshes Webex credentials on the server before access-token expiry.
  Users normally authenticate again only after the absolute limit, prolonged
  inactivity, explicit logout, credential refresh failure, or administrative
  suspension.
- TDS account status and team roles remain live database decisions on every
  authenticated request; session longevity never extends revoked permissions.
- Retention automation for expired/revoked session rows is an unresolved
  operations decision. Those rows contain encrypted credentials and token
  hashes, not approved knowledge or audit history, and MUST be purged on a
  defined schedule before the MVP is scaled broadly.
