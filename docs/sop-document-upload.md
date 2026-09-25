# SOP document upload and review

Branch: `feature/sop-document-upload`.

The SOP workspace at `/sops` is an additional capture path, separate from Webex
conversation capture. Active Moderators and Admins can choose a team in which
they hold that role, select documents, add notes, and generate an unpublished
procedure using the configured `LLM_PROVIDER` and `LLM_MODEL`.

## Current behavior

- Extracted document text and notes are sent to the configured AI provider for SOP parsing. PDF pages
  are sent with their visual content. DOCX paragraphs/tables and XLSX
  sheet/cell values are first extracted and normalized on the server. Supported
  embedded PNG/JPEG/WebP images remain in the browser review draft but are not sent
  for Office-only AI validation because the current structured response does not
  consume them. Optional wording suggestions remain separately controlled;
  the provider parse is no longer optional. Office image placement, charts,
  drawing shapes, and number/date formatting are not preserved; export to PDF
  when those are important. Formulas are never executed or recalculated.
  Cached formula values may be stale.
- Each generated step references uploaded source IDs. These are document-level
  citations, not verified page/cell references or proof of factual correctness.
- The result has a purpose, prerequisites, ordered steps, warnings, and questions.
  Users can edit it, preview it, and download an unpublished Markdown draft.
- Files remain in browser memory during generation and are never uploaded as binary
  attachments to Supabase. After review, **Submit for review** persists the
  generated markdown snapshot, draft version, source reference, and selected team
  to Supabase, invalidates the review cache, and opens that item in the durable
  moderator review queue. Leaving the page before submission discards the browser
  draft; refreshing or signing out after submission does not.
- Submission stores the validated, binary-free source blocks separately from the
  editable AI draft. Review and library pages use those blocks for faithful text,
  list, and table presentation. Knowledge Chat can retrieve the validated text
  from those approved blocks without exposing restricted Webex transcripts;
  `source_messages.source_markdown` remains the immutable transcript context
  where transcript visibility permits it.

## Provider configuration and access

Run `pnpm dev` and sign in through the existing local Webex flow. The local
`.dev.vars` needs the existing authentication/Supabase settings and local
`APP_ORIGIN`. Choose one provider configuration; keys remain server-only:

```dotenv
# Hosted Gemini
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GEMINI_AI_API=...

# Local Ollama
LLM_PROVIDER=ollama
LLM_MODEL=qwen2.5vl:3b
LLM_BASE_URL=http://127.0.0.1:11434
LLM_CONTEXT_TOKENS=16384
```

The Ollama adapter supports extracted Office text and embedded PNG/JPEG/WebP
images. Ollama vision models do not accept the raw PDF part used by this importer,
so PDF generation currently requires Gemini or a future local PDF renderer.
Apply migrations `202609210018_submit_sop_review.sql` and
`202609210019_fix_sop_review_team.sql` before testing durable SOP submission. The
local UI requires real authentication;
there is no bypass account or mock product data.

The SOP endpoints are available in local development and production. Every
request requires the normal signed TDS session. Generation is limited to active
Moderators and Admins in the selected team, and mutations require a same-origin
browser request. Provider credentials remain server-only. Existing text
redaction applies to extracted Office text and notes; PDF/image redaction is not
implemented, so provider handling must remain consistent with the organization's
approved AI data policy.

Server checks include same-origin submission, fresh active team roles before
generation and before returning the draft, file signatures/container checks,
bounded multipart reads, expanded ZIP/XML limits, macro/object rejection, and
validated structured output/source references. Only one request per account per
Worker isolate can be in progress. The isolate-level concurrency guard prevents
duplicate work within one Worker instance; provider quotas remain the production
rate boundary. Provider errors never return raw response bodies.

Limits for this synchronous endpoint: 5 documents, 25 MB per file and
25 MB total uploaded bytes, 20 embedded images per Office document, 6,000 note
characters, 180-second total provider deadline. The aggregate transport limit is not a
decision about the eventual production attachment policy. Encrypted files,
legacy `.doc`/`.xls`, macro-enabled files, and unsupported embedded image formats
are rejected with conversion guidance. Word documents with unresolved tracked changes must have those changes accepted/rejected or be exported to final PDF first.

## Next milestone

Add durable background generation jobs so long provider requests can continue
independently of a browser request. Webex submission can later call the same
normalized SOP processing capability.

## Review-queue troubleshooting

- **Draft generated but no queue item:** select **Submit for review** on the
  generated draft. Generation alone is intentionally browser-only.
- **Submission returns `SUBMISSION_FAILED`:** confirm migration `202609210018`
  is applied and that the Worker is using a valid Supabase server key.
- **Submission succeeds but an older item is missing its team:** apply
  `202609210019`; the queue also falls back to `document_teams` for rows created
  before the backfill.
Do not wire a generated draft directly into published knowledge.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Tests cover Office
text and screenshot extraction, rejected input, source validation, role/team and
origin enforcement, and provider failure. Live smoke tests must use synthetic
documents only. CI/CD remains pending organization approval of Cloudflare access.

## Completed validation (2026-09-18)

- 88 automated tests passed; lint, TypeScript checking, and production build passed.
- Browser checks with synthetic API responses passed for file validation, draft editing/export (including extraction warnings), sidebar and Back/Forward state preservation, provider-error recovery, mobile overflow, dark mode, and Basic-user route denial.
- The running local Worker returned 401 for unauthenticated SOP requests.
- Real Gemini calls succeeded for synthetic PDF, DOCX, and XLSX sources. Word and Excel tests verified a code available only in embedded screenshot content was read correctly.
- Production generation uses the same authenticated, source-validating pipeline as local development; live provider availability and quota remain operational dependencies.

## Provider reliability follow-up

Gemini 2.5 Flash uses a bounded 1,024-token thinking budget. HTTP 500, 502, and 503 responses receive one retry after one second; both attempts share the 180-second deadline. Cancellation, network failures, and quota errors are not automatically retried. The UI shows elapsed time and distinct safe errors while retaining inputs. Stage timing logs contain no source contents or filenames.

The user-authorized DOCX browser test extracted successfully in 15 ms, but Gemini returned HTTP 503 on both attempts after 56 seconds total. Error recovery was verified in the signed-in browser; successful generation of that document remains blocked by provider availability.
