# The Document Source

Production scaffold for TD SYNNEX's private Webex-to-knowledge-base application.

The product is bot-triggered automation: a user replies in a Webex thread with
`@<capture-identity> document` or `@<capture-identity> update`; TDS verifies the
signed webhook, retrieves only that thread through an authorized organization
capture identity, creates an immutable snapshot, and ultimately places a draft
in the moderator review queue. The web-based room browser is diagnostic and is
not the intended day-to-day capture workflow. See `AGENTS.md` for non-negotiable
implementation guardrails.

## Local setup

1. Copy `.env.example` to `.env` for browser-safe settings.
2. Copy `.dev.vars.example` to `.dev.vars` for local Worker settings. Real authentication and server integrations are required; the application no longer supplies mock records.
3. Install with `pnpm install`.
4. Run `pnpm dev` for the local Cloudflare preview or `pnpm build` for a production bundle.

The Vite development server and Worker API share one origin. Use `pnpm deploy`
to deploy the Worker and static assets after authenticating Wrangler. Store
production credentials with `wrangler secret put`; do not add them to `.env`.

The deployed Webex integration must register
`https://the-document-source.nickolaskg.workers.dev/api/auth/webex/callback`
as an exact redirect URI. OAuth uses Authorization Code with PKCE, validates the
returned state and nonce, restricts sign-in to configured email domains, and
stores only an encrypted short-lived identity session in the browser cookie.

Development and production both load authoritative server data. Empty integrations produce honest loading, empty, or configuration states rather than representative records.

See `docs/architecture.md` for module boundaries and `docs/requirements-decisions.md` for reconciled requirements and unresolved product decisions.

## SOP local preview

Admins and Moderators can open **Create SOP** to upload PDF, DOCX, or XLSX sample documents and generate an editable procedure using the existing Gemini integration. See docs/sop-document-upload.md for local setup, supported content, limits, and the next milestone.
