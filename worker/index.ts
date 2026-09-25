import { isCurrentKnowledge, libraryLifecycleFilter, mutateKnowledgeLifecycle } from "../server/modules/knowledge/lifecycle.js";
import { handleSopRequest, localOrigin } from "../server/modules/sops/generate.js";
import { storageSteps, validateSopSubmission } from "../server/modules/sops/submit-review.js";

import { isApprovedEmail } from "../server/modules/auth/email-domain.js";
import { parseCaptureCommand, type CaptureCommand } from "../server/modules/capture/command.js";
import { redactForLlm } from "../server/modules/redaction/redact.js";
import { resolveCaptureReviewTeam } from "../server/modules/access/team-policy.js";
import { embeddingConfigured, embeddingModel, embeddingProvider, integrationStatus, llmConfigured, supabaseSecret } from "../server/modules/config/integration-status.js";
import { LlmProviderError, requestLlmJson } from "../server/modules/llm/provider.js";
import { buildConversationContext, buildKnowledgeContext, buildRetrievalQuery, chatHistory, chatQuestion, mergeRankedKnowledge, parseChatResponse, rankKnowledge, type KnowledgeRecord } from "../server/modules/knowledge/chat.js";
import { buildKnowledgeChunks } from "../server/modules/rag/chunks.js";
import { createEmbedding, EmbeddingProviderError } from "../server/modules/rag/embeddings.js";
import { indexKnowledgeVersion } from "../server/modules/rag/indexing.js";
import { retrieveKnowledgeChunks } from "../server/modules/rag/retrieval.js";

interface Env {
  APP_ORIGIN?: string;
  APPROVED_EMAIL_DOMAINS?: string;
  SESSION_COOKIE_NAME?: string;
  SESSION_ENCRYPTION_KEY?: string;
  WEBEX_CLIENT_ID?: string;
  WEBEX_CLIENT_SECRET?: string;
  WEBEX_REDIRECT_URI?: string;
  WEBEX_BOT_ACCESS_TOKEN?: string;
  WEBEX_BOT_NAME?: string;
  WEBEX_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_CONTEXT_TOKENS?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  GEMINI_AI_API?: string;
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_BASE_URL?: string;
  EMBEDDING_API_KEY?: string;
  RAG_VECTOR_ENABLED?: string;
  RAG_BACKFILL_ADMIN_EMAILS?: string;
}

interface OAuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
}

interface AdminSetupContext {
  invitationId: string;
  tokenHash: string;
  expiresAt: number;
}

interface SessionIdentity {
  subject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  appUserId?: string;
  organizationId?: string;
  accountStatus?: AccountStatus;
  teamRoles?: TeamGrant[];
  accessToken: string;
  accessTokenExpiresAt: number;
  issuedAt: number;
  expiresAt: number;
}

interface UserSessionRow {
  id: string;
  organization_id: string;
  user_id: string;
  current_token_hash: string;
  previous_token_hash: string | null;
  previous_token_valid_until: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_expires_at: string;
  refresh_expires_at: string;
  webex_subject: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  idle_expires_at: string;
  absolute_expires_at: string;
  token_rotated_at: string;
  last_seen_at: string;
  refresh_claimed_at: string | null;
  revoked_at: string | null;
  created_at: string;
  users: { id: string; status: AccountStatus; organization_id: string } | Array<{ id: string; status: AccountStatus; organization_id: string }>;
}

interface ResolvedSession {
  session: SessionIdentity;
  replacementCookie?: string;
  durableSessionId?: string;
}

type AccountStatus = "inactive" | "active" | "suspended";
type TeamRole = "basic" | "moderator" | "admin";
type AdminSetupInvitationStatus = "pending" | "setup_started" | "completed" | "expired" | "revoked";

interface TeamGrant {
  teamId: string;
  teamName: string;
  role: TeamRole;
}

export function adminSetupInvitationStatus(invitation: { expires_at: string; started_at: string | null; redeemed_at: string | null; revoked_at: string | null }, now = Date.now()): AdminSetupInvitationStatus {
  if (invitation.redeemed_at) return "completed";
  if (invitation.revoked_at) return "revoked";
  if (Date.parse(invitation.expires_at) <= now) return "expired";
  return invitation.started_at ? "setup_started" : "pending";
}

interface AppIdentity {
  userId: string;
  organizationId: string;
  accountStatus: AccountStatus;
  teamRoles: TeamGrant[];
}

interface OrganizationRow { id: string; }
interface UserRow { id: string; status: AccountStatus; organization_id?: string; webex_person_id?: string; }
interface TeamRow { id: string; name: string; status?: "active" | "archived"; }
interface MembershipRow { role: TeamRole; teams: TeamRow | TeamRow[] | null; }

interface WebexMessage {
  id?: string;
  roomId?: string;
  parentId?: string;
  personId?: string;
  personEmail?: string;
  personDisplayName?: string;
  text?: string;
  markdown?: string;
  created?: string;
}

interface WebexRoom { id?: string; title?: string; type?: string; }
interface WebexPerson { id?: string; avatar?: string; }
interface WebexList<T> { items?: T[]; }

interface WebexTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

interface WebexUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
}

interface CaptureIdentityRow {
  organization_id: string;
  user_id: string;
  webhook_id?: string | null;
  access_token_ciphertext?: string;
  refresh_token_ciphertext?: string;
  access_expires_at?: string;
  refresh_expires_at?: string | null;
}

interface WebexWebhookPayload {
  id?: string;
  resource?: string;
  event?: string;
  data?: { id?: string; roomId?: string; personId?: string };
}

export function webhookEventId(payload: WebexWebhookPayload): string | undefined {
  return payload.data?.id;
}

interface CaptureRpcResult {
  documentId: string;
  snapshotId: string;
  captureId?: string;
  sequence: number;
  changed: boolean;
  duplicate?: boolean;
  alreadyExists?: boolean;
  upToDate?: boolean;
}

interface GeneratedDraft {
  title: string;
  problem: string;
  summary: string;
  steps: string[];
  warnings: string[];
  evidence: { problem: number[]; summary: number[]; steps: number[][]; warnings: number[][] };
}

const OAUTH_COOKIE = "__Host-tds_oauth";
const ADMIN_SETUP_COOKIE = "__Host-tds_admin_setup";
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_SETUP_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_ROTATION_SECONDS = 24 * 60 * 60;
const SESSION_ROTATION_GRACE_SECONDS = 5 * 60;
const SESSION_ACTIVITY_TOUCH_SECONDS = 15 * 60;
const WEBEX_REFRESH_WINDOW_SECONDS = 60 * 60;
const BOT_ROOMS_CACHE_MS = 60 * 1000;
const WEBEX_AUTHORIZE_URL = "https://webexapis.com/v1/authorize";
const WEBEX_TOKEN_URL = "https://webexapis.com/v1/access_token";
const WEBEX_USERINFO_URL = "https://webexapis.com/v1/userinfo";

let botRoomsCache: { expiresAt: number; result: { rooms: Array<{ id: string; title: string }>; available: boolean } } | null = null;

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ "cache-control": "no-store", location, "x-content-type-options": "nosniff" });
  cookies.forEach((value) => headers.append("set-cookie", value));
  return new Response(null, { status: 302, headers });
}

async function supabaseRequest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = supabaseSecret(env);
  if (!baseUrl || !secret) throw new Error("Supabase is not configured");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("apikey", secret);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) {
    const failure = await response.text();
    let code = "UNKNOWN";
    try { code = (JSON.parse(failure) as { code?: string }).code || code; } catch { /* non-JSON gateway response */ }
    console.error("Supabase request failed", path.split("?")[0], response.status, code);
    throw new Error(`Supabase request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  const responseText = await response.text();
  return responseText ? JSON.parse(responseText) as T : undefined as T;
}

async function findOrganization(env: Env): Promise<OrganizationRow | null> {
  const rows = await supabaseRequest<OrganizationRow[]>(env, "organizations?select=id&order=created_at.asc&limit=1");
  return rows[0] || null;
}

async function createOrganization(env: Env): Promise<OrganizationRow> {
  const rows = await supabaseRequest<OrganizationRow[]>(env, "organizations?select=id", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: "TD SYNNEX" }),
  });
  if (!rows[0]) throw new Error("Supabase did not return the created organization");
  return rows[0];
}

async function upsertUser(
  env: Env,
  organizationId: string,
  profile: { subject: string; email: string; displayName: string },
  statusForNewUser: AccountStatus,
): Promise<UserRow> {
  const subjectFilter = `organization_id=eq.${organizationId}&webex_oidc_subject=eq.${encodeURIComponent(profile.subject)}`;
  let existing = await supabaseRequest<UserRow[]>(env, `users?${subjectFilter}&select=id,status&limit=1`);
  if (!existing[0]) {
    existing = await supabaseRequest<UserRow[]>(env, `users?organization_id=eq.${organizationId}&email=eq.${encodeURIComponent(profile.email)}&select=id,status&limit=1`);
  }
  const timestamp = new Date().toISOString();
  const rows = existing[0]
    ? await supabaseRequest<UserRow[]>(env, `users?id=eq.${existing[0].id}&select=id,status`, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          webex_oidc_subject: profile.subject,
          email: profile.email,
          display_name: profile.displayName,
          last_signed_in_at: timestamp,
          updated_at: timestamp,
        }),
      })
    : await supabaseRequest<UserRow[]>(env, "users?select=id,status", {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          organization_id: organizationId,
          webex_person_id: profile.subject,
          webex_oidc_subject: profile.subject,
          email: profile.email,
          display_name: profile.displayName,
          status: statusForNewUser,
          last_signed_in_at: timestamp,
          updated_at: timestamp,
        }),
      });
  if (!rows[0]) throw new Error("Supabase did not return the signed-in user");
  return rows[0];
}

async function ensureBootstrapTeam(env: Env, organizationId: string, userId: string): Promise<void> {
  const teams = await supabaseRequest<TeamRow[]>(
    env,
    `teams?organization_id=eq.${organizationId}&name=eq.${encodeURIComponent("TDS MVP")}&select=id,name&limit=1`,
  );
  let team = teams[0];
  if (!team) {
    const created = await supabaseRequest<TeamRow[]>(env, "teams?select=id,name", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ organization_id: organizationId, name: "TDS MVP" }),
    });
    team = created[0];
  }
  if (!team) throw new Error("Supabase did not return the bootstrap team");
  await supabaseRequest<void>(env, "team_memberships?on_conflict=team_id,user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ team_id: team.id, user_id: userId, role: "admin" }),
  });
}

async function getTeamRoles(env: Env, userId: string): Promise<TeamGrant[]> {
  const memberships = await supabaseRequest<MembershipRow[]>(
    env,
    `team_memberships?user_id=eq.${userId}&teams.status=eq.active&select=role,teams!inner(id,name,status)`,
  );
  return memberships.flatMap(({ role, teams }) => {
    const team = Array.isArray(teams) ? teams[0] : teams;
    return team ? [{ teamId: team.id, teamName: team.name, role }] : [];
  });
}

async function provisionAppIdentity(
  env: Env,
  profile: { subject: string; email: string; displayName: string },
): Promise<AppIdentity | null> {
  if (!integrationStatus(env).supabaseConfigured) return null;
  let organization = await findOrganization(env);
  const isBootstrapUser = !organization;
  if (!organization) organization = await createOrganization(env);
  const user = await upsertUser(env, organization.id, profile, isBootstrapUser ? "active" : "inactive");
  if (isBootstrapUser) await ensureBootstrapTeam(env, organization.id, user.id);
  if (!isBootstrapUser) await supabaseRequest<void>(env, "rpc/redeem_pending_team_invitations", { method: "POST", body: JSON.stringify({ p_organization_id: organization.id, p_user_id: user.id, p_email: profile.email }) });
  const refreshed = await supabaseRequest<UserRow[]>(env, `users?id=eq.${user.id}&select=id,status,organization_id&limit=1`);
  return { userId: user.id, organizationId: organization.id, accountStatus: refreshed[0]?.status || user.status, teamRoles: await getTeamRoles(env, user.id) };
}

async function persistCaptureIdentity(
  env: Env,
  appIdentity: AppIdentity,
  tokens: WebexTokenResponse,
): Promise<boolean> {
  if (!env.SESSION_ENCRYPTION_KEY || !tokens.access_token || !tokens.refresh_token) return false;
  if (!appIdentity.teamRoles.some(({ role }) => role === "admin")) return false;
  const existing = await supabaseRequest<CaptureIdentityRow[]>(
    env,
    `webex_capture_identities?organization_id=eq.${appIdentity.organizationId}&select=organization_id,user_id,webhook_id&limit=1`,
  );
  if (existing[0] && existing[0].user_id !== appIdentity.userId) return false;
  const now = Date.now();
  await supabaseRequest<void>(env, "webex_capture_identities?on_conflict=organization_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      organization_id: appIdentity.organizationId,
      user_id: appIdentity.userId,
      access_token_ciphertext: await seal(tokens.access_token, env.SESSION_ENCRYPTION_KEY),
      refresh_token_ciphertext: await seal(tokens.refresh_token, env.SESSION_ENCRYPTION_KEY),
      access_expires_at: new Date(now + Math.max(0, tokens.expires_in || 0) * 1000).toISOString(),
      refresh_expires_at: tokens.refresh_token_expires_in
        ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
        : null,
      enabled: true,
      updated_at: new Date(now).toISOString(),
    }),
  });
  return true;
}

async function getCaptureIdentityToken(env: Env): Promise<{ row: CaptureIdentityRow; accessToken: string }> {
  if (!env.SESSION_ENCRYPTION_KEY) throw new Error("Session encryption is not configured");
  const rows = await supabaseRequest<CaptureIdentityRow[]>(env,
    "webex_capture_identities?enabled=eq.true&select=organization_id,user_id,webhook_id,access_token_ciphertext,refresh_token_ciphertext,access_expires_at,refresh_expires_at&limit=1");
  const row = rows[0];
  if (!row?.access_token_ciphertext || !row.refresh_token_ciphertext || !row.access_expires_at) throw new Error("Capture identity is not enrolled");
  let accessToken = await unseal<string>(row.access_token_ciphertext, env.SESSION_ENCRYPTION_KEY);
  if (!accessToken) throw new Error("Capture access token could not be decrypted");
  if (Date.parse(row.access_expires_at) > Date.now() + 60_000) return { row, accessToken };
  const refreshToken = await unseal<string>(row.refresh_token_ciphertext, env.SESSION_ENCRYPTION_KEY);
  if (!refreshToken || !env.WEBEX_CLIENT_ID || !env.WEBEX_CLIENT_SECRET) throw new Error("Capture refresh token is unavailable");
  const response = await fetch(WEBEX_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.WEBEX_CLIENT_ID, client_secret: env.WEBEX_CLIENT_SECRET, refresh_token: refreshToken }),
  });
  if (!response.ok) throw new Error(`Webex token refresh failed with status ${response.status}`);
  const refreshed = await response.json() as WebexTokenResponse;
  if (!refreshed.access_token) throw new Error("Webex token refresh was incomplete");
  accessToken = refreshed.access_token;
  const replacementRefresh = refreshed.refresh_token || refreshToken;
  const now = Date.now();
  await supabaseRequest<void>(env, `webex_capture_identities?organization_id=eq.${row.organization_id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({
      access_token_ciphertext: await seal(accessToken, env.SESSION_ENCRYPTION_KEY),
      refresh_token_ciphertext: await seal(replacementRefresh, env.SESSION_ENCRYPTION_KEY),
      access_expires_at: new Date(now + Math.max(0, refreshed.expires_in || 0) * 1000).toISOString(),
      refresh_expires_at: refreshed.refresh_token_expires_in ? new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString() : row.refresh_expires_at,
      updated_at: new Date(now).toISOString(),
    }),
  });
  return { row, accessToken };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), plaintext);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return toBase64Url(combined);
}

async function unseal<T>(value: string, secret: string): Promise<T | null> {
  try {
    const combined = fromBase64Url(value);
    if (combined.length <= 12) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: combined.slice(0, 12) },
      await encryptionKey(secret),
      combined.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function sessionCookieName(env: Env): string {
  return env.SESSION_COOKIE_NAME?.trim() || "__Host-tds_session";
}

function appOrigin(request: Request, env: Env): string {
  const configured = env.APP_ORIGIN?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

function approvedDomains(env: Env): string[] {
  return (env.APPROVED_EMAIL_DOMAINS || "tdsynnex.com").split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean);
}

const durableSessionSelect = "id,organization_id,user_id,current_token_hash,previous_token_hash,previous_token_valid_until,access_token_ciphertext,refresh_token_ciphertext,access_expires_at,refresh_expires_at,webex_subject,email,display_name,avatar_url,idle_expires_at,absolute_expires_at,token_rotated_at,last_seen_at,refresh_claimed_at,revoked_at,created_at,users!inner(id,status,organization_id)";

export function isOpaqueSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{64}$/.test(value);
}

export function durableSessionDeadlines(now: number, refreshTokenExpiresInSeconds = SESSION_ABSOLUTE_TTL_SECONDS): { refreshExpiresAt: number; absoluteExpiresAt: number; idleExpiresAt: number } {
  const refreshExpiresAt = now + Math.max(1, refreshTokenExpiresInSeconds) * 1000;
  const absoluteExpiresAt = Math.min(now + SESSION_ABSOLUTE_TTL_SECONDS * 1000, refreshExpiresAt);
  return {
    refreshExpiresAt,
    absoluteExpiresAt,
    idleExpiresAt: Math.min(now + SESSION_IDLE_TTL_SECONDS * 1000, absoluteExpiresAt),
  };
}

function sessionCookieMaxAge(absoluteExpiresAt: string): number {
  return Math.max(1, Math.floor((Date.parse(absoluteExpiresAt) - Date.now()) / 1000));
}

async function createDurableUserSession(
  env: Env,
  identity: { subject: string; email: string; displayName: string; avatarUrl?: string; appIdentity: AppIdentity },
  tokens: WebexTokenResponse,
): Promise<{ token: string; maxAge: number }> {
  if (!env.SESSION_ENCRYPTION_KEY || !tokens.access_token || !tokens.refresh_token) throw new Error("Webex did not provide durable session credentials");
  const now = Date.now();
  const { refreshExpiresAt, absoluteExpiresAt, idleExpiresAt } = durableSessionDeadlines(now, tokens.refresh_token_expires_in);
  const accessExpiresAt = Math.min(now + Math.max(1, tokens.expires_in || SESSION_TTL_SECONDS) * 1000, refreshExpiresAt);
  const token = randomToken(48);
  const created = await supabaseRequest<Array<{ id: string }>>(env, "user_sessions?select=id", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: identity.appIdentity.organizationId,
      user_id: identity.appIdentity.userId,
      current_token_hash: await sha256Hex(token),
      access_token_ciphertext: await seal(tokens.access_token, env.SESSION_ENCRYPTION_KEY),
      refresh_token_ciphertext: await seal(tokens.refresh_token, env.SESSION_ENCRYPTION_KEY),
      access_expires_at: new Date(accessExpiresAt).toISOString(),
      refresh_expires_at: new Date(refreshExpiresAt).toISOString(),
      webex_subject: identity.subject,
      email: identity.email,
      display_name: identity.displayName,
      avatar_url: identity.avatarUrl || null,
      idle_expires_at: new Date(idleExpiresAt).toISOString(),
      absolute_expires_at: new Date(absoluteExpiresAt).toISOString(),
    }),
  });
  if (!created[0]) throw new Error("Supabase did not create the durable session");
  return { token, maxAge: Math.max(1, Math.floor((absoluteExpiresAt - now) / 1000)) };
}

async function revokeDurableSession(env: Env, sessionId: string): Promise<void> {
  await supabaseRequest<void>(env, `user_sessions?id=eq.${sessionId}&revoked_at=is.null`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString(), refresh_claimed_at: null, updated_at: new Date().toISOString() }),
  });
}

async function durableSessionById(env: Env, sessionId: string): Promise<UserSessionRow | null> {
  const rows = await supabaseRequest<UserSessionRow[]>(env, `user_sessions?id=eq.${sessionId}&select=${durableSessionSelect}&limit=1`);
  return rows[0] || null;
}

async function refreshDurableSession(env: Env, row: UserSessionRow): Promise<UserSessionRow | null> {
  const now = Date.now();
  if (Date.parse(row.access_expires_at) > now + WEBEX_REFRESH_WINDOW_SECONDS * 1000) return row;
  if (Date.parse(row.refresh_expires_at) <= now || !env.WEBEX_CLIENT_ID || !env.WEBEX_CLIENT_SECRET || !env.SESSION_ENCRYPTION_KEY) {
    await revokeDurableSession(env, row.id); return null;
  }
  const claimed = await supabaseRequest<boolean>(env, "rpc/claim_user_session_refresh", { method: "POST", body: JSON.stringify({ p_session_id: row.id }) });
  if (!claimed) {
    if (Date.parse(row.access_expires_at) > now) return row;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const refreshedByPeer = await durableSessionById(env, row.id);
      if (refreshedByPeer && Date.parse(refreshedByPeer.access_expires_at) > Date.now()) return refreshedByPeer;
    }
    return null;
  }
  try {
    const refreshToken = await unseal<string>(row.refresh_token_ciphertext, env.SESSION_ENCRYPTION_KEY);
    if (!refreshToken) throw new Error("Webex refresh token could not be decrypted");
    const response = await fetch(WEBEX_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.WEBEX_CLIENT_ID, client_secret: env.WEBEX_CLIENT_SECRET, refresh_token: refreshToken }),
    });
    if (!response.ok) throw new Error(`Webex session refresh failed with status ${response.status}`);
    const tokens = await response.json() as WebexTokenResponse;
    if (!tokens.access_token) throw new Error("Webex session refresh was incomplete");
    const nextRefreshToken = tokens.refresh_token || refreshToken;
    const refreshExpiresAt = tokens.refresh_token_expires_in
      ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString()
      : row.refresh_expires_at;
    const accessExpiresAt = new Date(Math.min(Date.now() + Math.max(1, tokens.expires_in || SESSION_TTL_SECONDS) * 1000, Date.parse(refreshExpiresAt))).toISOString();
    const replacement: UserSessionRow = {
      ...row,
      access_token_ciphertext: await seal(tokens.access_token, env.SESSION_ENCRYPTION_KEY),
      refresh_token_ciphertext: await seal(nextRefreshToken, env.SESSION_ENCRYPTION_KEY),
      access_expires_at: accessExpiresAt,
      refresh_expires_at: refreshExpiresAt,
      refresh_claimed_at: null,
    };
    await supabaseRequest<void>(env, `user_sessions?id=eq.${row.id}`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({
        access_token_ciphertext: replacement.access_token_ciphertext,
        refresh_token_ciphertext: replacement.refresh_token_ciphertext,
        access_expires_at: accessExpiresAt,
        refresh_expires_at: refreshExpiresAt,
        refresh_claimed_at: null,
        updated_at: new Date().toISOString(),
      }),
    });
    return replacement;
  } catch (error) {
    console.warn("Durable Webex session refresh failed", error instanceof Error ? error.message : "Unknown error");
    await revokeDurableSession(env, row.id);
    return null;
  }
}

async function resolveDurableSession(request: Request, env: Env, options: { requireActive?: boolean; rotate?: boolean } = {}): Promise<ResolvedSession | null> {
  const token = readCookie(request, sessionCookieName(env));
  if (!token || !isOpaqueSessionToken(token) || !env.SESSION_ENCRYPTION_KEY) return null;
  const tokenHash = await sha256Hex(token);
  const rows = await supabaseRequest<UserSessionRow[]>(env, `user_sessions?or=(current_token_hash.eq.${tokenHash},previous_token_hash.eq.${tokenHash})&select=${durableSessionSelect}&limit=1`);
  let row = rows[0];
  if (!row || row.revoked_at) return null;
  const now = Date.now();
  const usingCurrentToken = row.current_token_hash === tokenHash;
  const usingValidPreviousToken = row.previous_token_hash === tokenHash && Boolean(row.previous_token_valid_until) && Date.parse(row.previous_token_valid_until!) > now;
  if (!usingCurrentToken && !usingValidPreviousToken) return null;
  if (Date.parse(row.idle_expires_at) <= now || Date.parse(row.absolute_expires_at) <= now) {
    await revokeDurableSession(env, row.id); return null;
  }
  const relatedUser = Array.isArray(row.users) ? row.users[0] : row.users;
  if (!relatedUser || relatedUser.organization_id !== row.organization_id || relatedUser.status === "suspended") {
    await revokeDurableSession(env, row.id); return null;
  }
  if (options.requireActive && relatedUser.status !== "active") return null;
  const refreshedRow = await refreshDurableSession(env, row);
  if (!refreshedRow) return null;
  row = refreshedRow;
  if (Date.parse(row.access_expires_at) <= Date.now()) return null;
  const accessToken = await unseal<string>(row.access_token_ciphertext, env.SESSION_ENCRYPTION_KEY);
  if (!accessToken) { await revokeDurableSession(env, row.id); return null; }

  const absoluteExpiresAt = Date.parse(row.absolute_expires_at);
  if (Date.parse(row.last_seen_at) <= now - SESSION_ACTIVITY_TOUCH_SECONDS * 1000) {
    const idleExpiresAt = new Date(Math.min(now + SESSION_IDLE_TTL_SECONDS * 1000, absoluteExpiresAt)).toISOString();
    await supabaseRequest<void>(env, `user_sessions?id=eq.${row.id}`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ last_seen_at: new Date(now).toISOString(), idle_expires_at: idleExpiresAt, updated_at: new Date(now).toISOString() }),
    });
    row = { ...row, last_seen_at: new Date(now).toISOString(), idle_expires_at: idleExpiresAt };
  }

  let replacementCookie: string | undefined;
  if (options.rotate && usingCurrentToken && Date.parse(row.token_rotated_at) <= now - SESSION_ROTATION_SECONDS * 1000) {
    const nextToken = randomToken(48);
    const nextHash = await sha256Hex(nextToken);
    const rotated = await supabaseRequest<Array<{ id: string }>>(env, `user_sessions?id=eq.${row.id}&current_token_hash=eq.${row.current_token_hash}&select=id`, {
      method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({
        previous_token_hash: row.current_token_hash,
        previous_token_valid_until: new Date(now + SESSION_ROTATION_GRACE_SECONDS * 1000).toISOString(),
        current_token_hash: nextHash,
        token_rotated_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
    });
    if (rotated[0]) replacementCookie = cookie(sessionCookieName(env), nextToken, sessionCookieMaxAge(row.absolute_expires_at));
  }

  return {
    durableSessionId: row.id,
    replacementCookie,
    session: {
      subject: row.webex_subject,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || undefined,
      appUserId: row.user_id,
      organizationId: row.organization_id,
      accountStatus: relatedUser.status,
      teamRoles: await getTeamRoles(env, row.user_id),
      accessToken,
      accessTokenExpiresAt: Date.parse(row.access_expires_at),
      issuedAt: Date.parse(row.created_at),
      expiresAt: absoluteExpiresAt,
    },
  };
}

async function resolveSession(request: Request, env: Env, options: { requireActive?: boolean; rotate?: boolean } = {}): Promise<ResolvedSession | null> {
  if (!env.SESSION_ENCRYPTION_KEY || !integrationStatus(env).supabaseConfigured) return null;
  const value = readCookie(request, sessionCookieName(env));
  if (!value) return null;
  if (isOpaqueSessionToken(value)) return resolveDurableSession(request, env, options);

  const session = await unseal<SessionIdentity>(value, env.SESSION_ENCRYPTION_KEY);
  if (!session?.appUserId || session.expiresAt <= Date.now() || session.accessTokenExpiresAt <= Date.now()) return null;
  const users = await supabaseRequest<UserRow[]>(env, `users?id=eq.${session.appUserId}&select=id,status,organization_id&limit=1`);
  if (!users[0] || users[0].status === "suspended" || (options.requireActive && users[0].status !== "active")) return null;
  session.accountStatus = users[0].status;
  session.organizationId = users[0].organization_id;
  session.teamRoles = await getTeamRoles(env, session.appUserId);
  return { session };
}

async function revokeSessionFromRequest(request: Request, env: Env): Promise<void> {
  const token = readCookie(request, sessionCookieName(env));
  if (!token || !isOpaqueSessionToken(token) || !integrationStatus(env).supabaseConfigured) return;
  const tokenHash = await sha256Hex(token);
  await supabaseRequest<void>(env, `user_sessions?or=(current_token_hash.eq.${tokenHash},previous_token_hash.eq.${tokenHash})&revoked_at=is.null`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString(), refresh_claimed_at: null, updated_at: new Date().toISOString() }),
  });
}

function authErrorRedirect(request: Request, env: Env, code: string, cookies: string[] = []): Response {
  const target = new URL(readCookie(request, ADMIN_SETUP_COOKIE) ? "/admin-setup" : "/", appOrigin(request, env));
  target.searchParams.set("auth_error", code);
  return redirect(target.toString(), cookies);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function startOAuth(request: Request, env: Env): Promise<Response> {
  const integrations = integrationStatus(env);
  if (!integrations.webexOAuthConfigured) {
    return json({ code: "WEBEX_OAUTH_NOT_CONFIGURED", message: "Webex OAuth is not configured for this environment." }, 503);
  }
  if (!integrations.supabaseConfigured) {
    return json({ code: "APPLICATION_DATA_NOT_CONFIGURED", message: "TDS data and permissions are not configured for this environment." }, 503);
  }
  const verifier = randomToken(48);
  const state = randomToken();
  const nonce = randomToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const transaction: OAuthTransaction = { state, nonce, verifier, expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000 };
  const sealed = await seal(transaction, env.SESSION_ENCRYPTION_KEY!);
  const authorization = new URL(WEBEX_AUTHORIZE_URL);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: env.WEBEX_CLIENT_ID!,
    redirect_uri: env.WEBEX_REDIRECT_URI!,
    scope: "openid email profile spark:people_read spark:rooms_read spark:messages_read spark:kms",
    state,
    nonce,
    code_challenge: toBase64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  }).toString();
  return redirect(authorization.toString(), [cookie(OAUTH_COOKIE, sealed, OAUTH_TTL_SECONDS)]);
}

async function exchangeCode(code: string, transaction: OAuthTransaction, env: Env): Promise<WebexTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.WEBEX_CLIENT_ID!,
    client_secret: env.WEBEX_CLIENT_SECRET!,
    redirect_uri: env.WEBEX_REDIRECT_URI!,
    code,
    code_verifier: transaction.verifier,
  });
  const response = await fetch(WEBEX_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    body,
  });
  if (!response.ok) throw new Error(`Webex token exchange failed with status ${response.status}`);
  return await response.json() as WebexTokenResponse;
}

async function getUserInfo(accessToken: string): Promise<WebexUserInfo> {
  const response = await fetch(WEBEX_USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Webex user info failed with status ${response.status}`);
  return await response.json() as WebexUserInfo;
}

export function normalizeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const avatar = new URL(value);
    return avatar.protocol === "https:" ? avatar.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function getWebexAvatar(accessToken: string): Promise<string | undefined> {
  try {
    const person = await webexTokenData<WebexPerson>("people/me", accessToken);
    return normalizeAvatarUrl(person.avatar);
  } catch (error) {
    console.warn("Webex profile picture could not be loaded", error instanceof Error ? error.message : "Unknown error");
    return undefined;
  }
}

async function finishOAuth(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const expiredCookie = clearCookie(OAUTH_COOKIE);
  if (!integrationStatus(env).supabaseConfigured) {
    return authErrorRedirect(request, env, "service_not_configured", [expiredCookie]);
  }
  if (requestUrl.searchParams.has("error")) return authErrorRedirect(request, env, "access_denied", [expiredCookie]);
  const code = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const transactionCookie = readCookie(request, OAUTH_COOKIE);
  if (!code || !returnedState || !transactionCookie || !env.SESSION_ENCRYPTION_KEY) {
    return authErrorRedirect(request, env, "invalid_callback", [expiredCookie]);
  }
  const transaction = await unseal<OAuthTransaction>(transactionCookie, env.SESSION_ENCRYPTION_KEY);
  if (!transaction || transaction.expiresAt <= Date.now() || transaction.state !== returnedState) {
    return authErrorRedirect(request, env, "invalid_state", [expiredCookie]);
  }
  try {
    const tokens = await exchangeCode(code, transaction, env);
    if (!tokens.access_token || !tokens.id_token) throw new Error("Webex token response was incomplete");
    const idClaims = decodeJwtPayload(tokens.id_token);
    if (idClaims?.nonce !== transaction.nonce) throw new Error("Webex nonce did not match");
    const [profile, avatarUrl] = await Promise.all([getUserInfo(tokens.access_token), getWebexAvatar(tokens.access_token)]);
    const email = profile.email?.trim().toLowerCase();
    if (!profile.sub || !email || profile.email_verified !== true) {
      return authErrorRedirect(request, env, "unverified_email", [expiredCookie]);
    }
    if (!isApprovedEmail(email, approvedDomains(env))) {
      return authErrorRedirect(request, env, "domain_not_allowed", [expiredCookie]);
    }
    const displayName = profile.name?.trim() || [profile.given_name, profile.family_name].filter(Boolean).join(" ").trim() || email;
    const appIdentity = await provisionAppIdentity(env, { subject: profile.sub, email, displayName });
    if (!appIdentity) throw new Error("TDS application identity could not be provisioned");
    await persistCaptureIdentity(env, appIdentity, tokens);
    const durableSession = await createDurableUserSession(env, {
      subject: profile.sub,
      email,
      displayName,
      avatarUrl,
      appIdentity,
    }, tokens);
    const destination = readCookie(request, ADMIN_SETUP_COOKIE) ? "/admin-setup" : "/";
    return redirect(new URL(destination, appOrigin(request, env)).toString(), [
      expiredCookie,
      cookie(sessionCookieName(env), durableSession.token, durableSession.maxAge),
    ]);
  } catch (error) {
    console.error("Webex OAuth callback failed", error instanceof Error ? error.message : "Unknown error");
    return authErrorRedirect(request, env, "oauth_failed", [expiredCookie]);
  }
}

async function getSession(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_ENCRYPTION_KEY) return json({ authenticated: false }, 401);
  if (!integrationStatus(env).supabaseConfigured) {
    return json({ authenticated: false, code: "APPLICATION_DATA_NOT_CONFIGURED", message: "TDS data and permissions are not configured for this environment." }, 503);
  }
  const name = sessionCookieName(env);
  const value = readCookie(request, name);
  const resolved = await resolveSession(request, env, { rotate: true });
  if (!resolved) {
    return json({ authenticated: false }, 401, value ? { "set-cookie": clearCookie(name) } : undefined);
  }
  const { session } = resolved;
  return json({
    authenticated: true,
    user: {
      email: session.email,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
      accountStatus: session.accountStatus,
      teamRoles: session.teamRoles || [],
    },
  }, 200, resolved.replacementCookie ? { "set-cookie": resolved.replacementCookie } : undefined);
}

async function readSession(request: Request, env: Env): Promise<SessionIdentity | null> {
  const resolved = await resolveSession(request, env, { requireActive: true });
  return resolved?.session || null;
}

async function webexJson(path: string, session: SessionIdentity): Promise<Response> {
  const response = await fetch(`https://webexapis.com/v1/${path}`, {
    headers: { accept: "application/json", authorization: `Bearer ${session.accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    return json({ code: "WEBEX_REAUTH_REQUIRED", message: "Reconnect Webex to grant the required read permissions." }, 401);
  }
  if (!response.ok) {
    console.error("Webex API request failed", path.split("?")[0], response.status);
    return json({ code: "WEBEX_API_ERROR", message: "Webex data could not be loaded." }, 502);
  }
  return new Response(response.body, { status: 200, headers: jsonHeaders });
}

async function webexData<T>(path: string, session: SessionIdentity): Promise<T> {
  const response = await fetch(`https://webexapis.com/v1/${path}`, {
    headers: { accept: "application/json", authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) throw new Error(`Webex API request failed with status ${response.status}`);
  return await response.json() as T;
}

async function webexTokenData<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`https://webexapis.com/v1/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Webex server request failed with status ${response.status}`);
  const responseText = await response.text();
  return responseText ? JSON.parse(responseText) as T : undefined as T;
}

export async function verifyWebhookSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{40}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = Array.from(signed, (byte) => byte.toString(16).padStart(2, "0")).join("");
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  return difference === 0;
}

export function normalizeBotCommand(message: WebexMessage, botName: string): CaptureCommand | null {
  const markdownWithoutMentions = (message.markdown || "").replace(/<@person(?:Id|Email):[^>]+>/gi, "").trim();
  if (/^(document|update)$/i.test(markdownWithoutMentions)) return markdownWithoutMentions.toLowerCase() as CaptureCommand;
  const text = (message.text || "").trim();
  const parsed = parseCaptureCommand(text.startsWith("@") ? text : `@${text}`, botName);
  if (parsed) return parsed.command;
  const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const remaining = text.replace(new RegExp(`^@?${escaped}\\s+`, "i"), "").trim();
  return /^(document|update)$/i.test(remaining) ? remaining.toLowerCase() as CaptureCommand : null;
}

export function normalizedSourceMessages(
  root: WebexMessage,
  replies: WebexMessage[],
  roomId: string,
  botName: string,
  botPersonId?: string,
): Array<Record<string, string | undefined>> {
  return [root, ...replies.filter((message) => message.parentId === root.id)]
    .filter((message) => message.id && message.created && message.roomId === roomId)
    .filter((message) => message.personId !== botPersonId && !normalizeBotCommand(message, botName))
    .sort((left, right) => Date.parse(left.created!) - Date.parse(right.created!))
    .map(({ id, parentId, personId, personEmail, personDisplayName, text, markdown, created }) => ({ id, parentId, personId, personEmail, personDisplayName, text, markdown, created }));
}

export function validateGeneratedDraft(value: unknown, messageCount: number): GeneratedDraft {
  if (!value || typeof value !== "object") throw new Error("Generated draft was not an object");
  const draft = value as Partial<GeneratedDraft>;
  if (![draft.title, draft.problem, draft.summary].every((item) => typeof item === "string" && item.trim().length > 0)) throw new Error("Generated draft text was incomplete");
  if (!Array.isArray(draft.steps) || !draft.steps.every((item) => typeof item === "string")) throw new Error("Generated steps were invalid");
  if (!Array.isArray(draft.warnings) || !draft.warnings.every((item) => typeof item === "string")) throw new Error("Generated warnings were invalid");
  const evidence = draft.evidence;
  if (!evidence || !Array.isArray(evidence.problem) || !Array.isArray(evidence.summary) || !Array.isArray(evidence.steps) || !Array.isArray(evidence.warnings)) throw new Error("Generated evidence was invalid");
  const indices = [...evidence.problem, ...evidence.summary, ...evidence.steps.flat(), ...evidence.warnings.flat()];
  if (!indices.every((index) => Number.isInteger(index) && index >= 1 && index <= messageCount)) throw new Error("Generated evidence referenced an invalid message");
  return draft as GeneratedDraft;
}
// Backward-compatible export for existing callers while provider names become neutral.
export const validateGeminiDraft = validateGeneratedDraft;

export async function retryWebexDraft<T>(request: () => Promise<T>, wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1_000))): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof LlmProviderError) || !error.retryable) throw error;
    await wait();
    return request();
  }
}

async function generateLlmDraft(env: Env, messages: Array<Record<string, string | undefined>>): Promise<GeneratedDraft> {
  if (!llmConfigured(env)) throw new Error("AI provider is not configured");
  const transcript = messages.map((message, index) => `[M${index + 1}] ${message.markdown || message.text || "[Attachment or rich content]"}`).join("\n\n");
  const sanitized = redactForLlm(transcript).sanitizedText;
  const schema = {
    type: "object", required: ["title", "problem", "summary", "steps", "warnings", "evidence"],
    properties: {
      title: { type: "string" }, problem: { type: "string" }, summary: { type: "string" },
      steps: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } },
      evidence: { type: "object", required: ["problem", "summary", "steps", "warnings"], properties: {
        problem: { type: "array", items: { type: "integer" } }, summary: { type: "array", items: { type: "integer" } },
        steps: { type: "array", items: { type: "array", items: { type: "integer" } } }, warnings: { type: "array", items: { type: "array", items: { type: "integer" } } },
      } },
    },
  };
  const output = await retryWebexDraft(() => requestLlmJson({
    env,
    systemPrompt: "Create a concise internal knowledge draft using only the supplied source. Do not invent facts. Preserve uncertainty. Each evidence index is the 1-based source message number supporting that field. Every non-empty step and warning must have a corresponding evidence array.",
    parts: [{ text: `Convert this synthetic Webex test thread into a review draft:\n\n${sanitized}` }],
    schema,
  }));
  return validateGeneratedDraft(output, messages.length);
}

function evidenceToProviderIds(draft: GeneratedDraft, messages: Array<Record<string, string | undefined>>): Record<string, unknown> {
  const ids = (indices: number[]) => indices.map((index) => messages[index - 1]?.id).filter(Boolean);
  return { problem: ids(draft.evidence.problem), summary: ids(draft.evidence.summary), steps: draft.evidence.steps.map(ids), warnings: draft.evidence.warnings.map(ids) };
}

function isSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  const expected = appOrigin(request, env);
  if (!origin) return false;
  if (origin === expected) return true;
  // Local development commonly switches between localhost and 127.0.0.1.
  // Keep production origin checks exact while accepting those equivalent loopback aliases.
  try {
    const actualUrl = new URL(origin);
    const expectedUrl = new URL(expected);
    return localOrigin(origin) && localOrigin(expected) && actualUrl.protocol === expectedUrl.protocol && actualUrl.port === expectedUrl.port;
  } catch {
    return false;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function captureWebexThread(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN", message: "Request origin was not accepted." }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) {
    return json({ code: "UNAUTHENTICATED", message: "Sign in again before capturing a thread." }, 401);
  }
  let organizationId = session.organizationId;
  if (!organizationId) {
    const users = await supabaseRequest<UserRow[]>(env, `users?id=eq.${session.appUserId}&select=id,status,organization_id&limit=1`);
    organizationId = users[0]?.organization_id;
  }
  if (!organizationId) return json({ code: "ACCOUNT_NOT_FOUND", message: "The TDS account could not be resolved." }, 403);
  const team = session.teamRoles?.[0];
  if (!team) return json({ code: "TEAM_REQUIRED", message: "An active team assignment is required." }, 403);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ code: "INVALID_CONTENT_TYPE", message: "JSON is required." }, 415);
  }
  const body = await request.json() as { roomId?: unknown; rootMessageId?: unknown };
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  const rootMessageId = typeof body.rootMessageId === "string" ? body.rootMessageId.trim() : "";
  if (!roomId || !rootMessageId || roomId.length > 512 || rootMessageId.length > 512) {
    return json({ code: "INVALID_CAPTURE", message: "A valid Webex space and root message are required." }, 400);
  }
  try {
    const [room, root, replyList] = await Promise.all([
      webexData<WebexRoom>(`rooms/${encodeURIComponent(roomId)}`, session),
      webexData<WebexMessage>(`messages/${encodeURIComponent(rootMessageId)}`, session),
      webexData<WebexList<WebexMessage>>(
        `messages?roomId=${encodeURIComponent(roomId)}&parentId=${encodeURIComponent(rootMessageId)}&max=100`,
        session,
      ),
    ]);
    if (room.id !== roomId || root.id !== rootMessageId || root.roomId !== roomId || root.parentId || !root.created) {
      return json({ code: "INVALID_THREAD_ROOT", message: "The selected message is not a valid thread root in this space." }, 400);
    }
    const messages = [root, ...(replyList.items || []).filter((message) => message.parentId === rootMessageId)]
      .filter((message) => message.id && message.created && message.roomId === roomId)
      .sort((left, right) => Date.parse(left.created!) - Date.parse(right.created!))
      .map(({ id, parentId, personId, personEmail, personDisplayName, text, markdown, created }) => ({
        id, parentId, personId, personEmail, personDisplayName, text, markdown, created,
      }));
    if (messages.length === 0 || messages.length > 101) throw new Error("Webex returned an invalid thread size");
    const documentId = await supabaseRequest<string>(env, "rpc/capture_webex_thread", {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_user_id: session.appUserId,
        p_team_id: team.teamId,
        p_space_provider_id: roomId,
        p_space_name: room.title?.trim() || "Untitled Webex space",
        p_root_message_id: rootMessageId,
        p_messages: messages,
        p_transcript_sha256: await sha256Hex(JSON.stringify(messages)),
      }),
    });
    return json({ documentId, messageCount: messages.length, status: "captured" }, 201);
  } catch (error) {
    console.error("Webex capture failed", error instanceof Error ? error.message : "Unknown error");
    return json({ code: "CAPTURE_FAILED", message: "The Webex thread could not be captured." }, 502);
  }
}

async function postBotReply(env: Env, roomId: string, parentId: string, markdown: string): Promise<void> {
  if (!env.WEBEX_BOT_ACCESS_TOKEN) return;
  await webexTokenData("messages", env.WEBEX_BOT_ACCESS_TOKEN, {
    method: "POST", body: JSON.stringify({ roomId, parentId, markdown }),
  });
}

async function teamAuthorizedForWebexSpace(env: Env, organizationId: string, userId: string, roomId: string): Promise<TeamRow | null> {
  const memberships = await supabaseRequest<MembershipRow[]>(env,
    `team_memberships?user_id=eq.${userId}&role=in.(moderator,admin)&teams.status=eq.active&select=role,teams!inner(id,name,status)`);
  const teams = memberships.map(({ teams }) => Array.isArray(teams) ? teams[0] : teams).filter((team): team is TeamRow => Boolean(team));
  if (teams.length === 0) return null;
  const spaces = await supabaseRequest<Array<{ id: string }>>(env,
    `source_spaces?organization_id=eq.${organizationId}&provider=eq.webex&provider_space_id=eq.${encodeURIComponent(roomId)}&select=id&limit=1`);
  const sourceSpace = spaces[0];
  if (!sourceSpace) return null;
  const policies = await supabaseRequest<Array<{ team_id: string }>>(env,
    `team_space_policies?source_space_id=eq.${sourceSpace.id}&is_default_capture=eq.true&select=team_id&limit=1`);
  const defaultTeamId = policies[0]?.team_id;
  if (!defaultTeamId) return null;
  const defaultTeams = await supabaseRequest<TeamRow[]>(env, `teams?id=eq.${defaultTeamId}&status=eq.active&select=id,name,status&limit=1`);
  const defaultTeam = defaultTeams[0]; if (!defaultTeam) return null;
  const grants = await supabaseRequest<Array<{ recipient_team_id: string }>>(env,
    `space_sharing_grants?source_team_id=eq.${defaultTeamId}&recipient_team_id=${inFilter(teams.map(({ id }) => id))}&source_space_id=eq.${sourceSpace.id}&status=eq.active&select=recipient_team_id`);
  const routed = resolveCaptureReviewTeam(defaultTeamId, memberships.flatMap(({ role, teams: related }) => {
    const team = Array.isArray(related) ? related[0] : related;
    return team ? [{ teamId: team.id, role }] : [];
  }), grants.map(({ recipient_team_id }) => recipient_team_id));
  return routed ? defaultTeam : null;
}

async function processWebexWebhook(payload: WebexWebhookPayload, env: Env): Promise<void> {
  const commandMessageId = webhookEventId(payload);
  const roomId = payload.data?.roomId;
  if (!commandMessageId || !roomId || payload.resource !== "messages" || payload.event !== "created") return;
  if (!env.WEBEX_BOT_ACCESS_TOKEN || !env.WEBEX_BOT_NAME) throw new Error("Webex bot is not configured");
  let rootId = "";
  let actorAuthorized = false;
  try {
    const commandMessage = await webexTokenData<WebexMessage>(`messages/${encodeURIComponent(commandMessageId)}`, env.WEBEX_BOT_ACCESS_TOKEN);
    const command = normalizeBotCommand(commandMessage, env.WEBEX_BOT_NAME);
    rootId = commandMessage.parentId || "";
    if (commandMessage.roomId !== roomId || !commandMessage.personId) return;
    const captureIdentity = await getCaptureIdentityToken(env);
    let actors = await supabaseRequest<UserRow[]>(env,
      `users?organization_id=eq.${captureIdentity.row.organization_id}&webex_person_id=eq.${encodeURIComponent(commandMessage.personId)}&status=eq.active&select=id,status,organization_id,webex_person_id&limit=1`);
    if (!actors[0] && commandMessage.personEmail) {
      actors = await supabaseRequest<UserRow[]>(env,
        `users?organization_id=eq.${captureIdentity.row.organization_id}&email=eq.${encodeURIComponent(commandMessage.personEmail.trim().toLowerCase())}&status=eq.active&select=id,status,organization_id,webex_person_id&limit=1`);
      if (actors[0] && actors[0].webex_person_id !== commandMessage.personId) {
        await supabaseRequest<void>(env, `users?id=eq.${actors[0].id}`, {
          method: "PATCH", headers: { prefer: "return=minimal" },
          body: JSON.stringify({ webex_person_id: commandMessage.personId, updated_at: new Date().toISOString() }),
        });
      }
    }
    const actor = actors[0];
    if (!actor?.organization_id) return;
    const team = await teamAuthorizedForWebexSpace(env, actor.organization_id, actor.id, roomId);
    if (!team) return;
    actorAuthorized = true;
    if (!rootId) {
      const botName = env.WEBEX_BOT_NAME?.trim() || "TDS";
      await postBotReply(env, roomId, commandMessageId, `Reply inside the conversation thread you want to capture, then use \`@${botName} document\` or \`@${botName} update\`.`);
      return;
    }
    if (!command) {
      const botName = env.WEBEX_BOT_NAME?.trim() || "TDS";
      await postBotReply(env, roomId, rootId, `${botName} did not recognize that command. Reply in a thread with \`@${botName} document\` or \`@${botName} update\`.`);
      return;
    }
    if (captureIdentity.row.organization_id !== actor.organization_id) throw new Error("Capture identity organization did not match actor");
    const [room, root, replyList, botPerson] = await Promise.all([
      webexTokenData<WebexRoom>(`rooms/${encodeURIComponent(roomId)}`, captureIdentity.accessToken),
      webexTokenData<WebexMessage>(`messages/${encodeURIComponent(rootId)}`, captureIdentity.accessToken),
      webexTokenData<WebexList<WebexMessage>>(`messages?roomId=${encodeURIComponent(roomId)}&parentId=${encodeURIComponent(rootId)}&max=100`, captureIdentity.accessToken),
      webexTokenData<WebexPerson>("people/me", env.WEBEX_BOT_ACCESS_TOKEN),
    ]);
    if (root.id !== rootId || root.roomId !== roomId || root.parentId || !root.created) throw new Error("Command parent was not a valid root");
    const messages = normalizedSourceMessages(root, replyList.items || [], roomId, env.WEBEX_BOT_NAME, botPerson.id);
    const transcriptHash = await sha256Hex(JSON.stringify(messages));
    const capture = await supabaseRequest<CaptureRpcResult>(env, "rpc/capture_webex_command", {
      method: "POST", body: JSON.stringify({
        p_organization_id: actor.organization_id, p_user_id: actor.id, p_team_id: team.id,
        p_command: command, p_provider_event_id: commandMessageId, p_space_provider_id: roomId,
        p_space_name: room.title?.trim() || "Untitled Webex space", p_root_message_id: rootId,
        p_messages: messages, p_transcript_sha256: transcriptHash,
      }),
    });
    if (!capture.changed) {
      await postBotReply(env, roomId, rootId, capture.upToDate ? "TDS is already up to date with this thread." : "This thread is already captured in TDS.");
      return;
    }
    try {
      const draft = await generateLlmDraft(env, messages);
      await supabaseRequest<string>(env, "rpc/complete_generated_draft", {
        method: "POST", body: JSON.stringify({
          p_document_id: capture.documentId, p_snapshot_id: capture.snapshotId, p_user_id: actor.id,
          p_title: draft.title, p_problem: draft.problem, p_summary: draft.summary,
          p_steps: draft.steps, p_warnings: draft.warnings,
          p_evidence_map: evidenceToProviderIds(draft, messages),
        }),
      });
      await postBotReply(env, roomId, rootId, `Captured ${messages.length} source message${messages.length === 1 ? "" : "s"}. A draft is waiting for human review in TDS.`);
    } catch (error) {
      // A failed update must never withdraw the currently approved version.
      // Only documents without a published version move into the failed state.
      await supabaseRequest<void>(env, `documents?id=eq.${capture.documentId}&current_published_version_id=is.null`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ workflow_state: "processing_failed", updated_at: new Date().toISOString() }) });
      if (capture.captureId) await supabaseRequest<void>(env, `capture_requests?id=eq.${capture.captureId}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "processing_failed", safe_error_code: "DRAFT_GENERATION_FAILED" }) });
      throw error;
    }
  } catch (error) {
    console.error("Webex command processing failed", error instanceof Error ? error.message : "Unknown error");
    if (rootId && actorAuthorized) {
      try { await postBotReply(env, roomId, rootId, "TDS could not process this thread. No content was published; an administrator can inspect the processing issue."); } catch { /* acknowledgement is best effort */ }
    }
  }
}

async function receiveWebexWebhook(request: Request, env: Env, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> {
  if (!env.WEBEX_WEBHOOK_SECRET) return json({ code: "WEBHOOK_NOT_CONFIGURED" }, 503);
  const body = await request.text();
  if (!await verifyWebhookSignature(body, request.headers.get("x-spark-signature"), env.WEBEX_WEBHOOK_SECRET)) {
    return json({ code: "INVALID_SIGNATURE" }, 401);
  }
  let payload: WebexWebhookPayload;
  try { payload = JSON.parse(body) as WebexWebhookPayload; } catch { return json({ code: "INVALID_PAYLOAD" }, 400); }
  waitUntil(processWebexWebhook(payload, env));
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

async function configureWebexWebhook(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.teamRoles?.some(({ role }) => role === "admin")) return json({ code: "ADMIN_REQUIRED" }, 403);
  if (!env.WEBEX_BOT_ACCESS_TOKEN || !env.WEBEX_WEBHOOK_SECRET || !llmConfigured(env)) {
    return json({ code: "PIPELINE_NOT_CONFIGURED", message: "Bot, webhook, and AI provider settings are required." }, 503);
  }
  const targetUrl = new URL("/api/webhooks/webex", appOrigin(request, env)).toString();
  const listed = await webexTokenData<WebexList<{ id?: string; targetUrl?: string; resource?: string; event?: string; filter?: string }>>("webhooks?max=100", env.WEBEX_BOT_ACCESS_TOKEN);
  const existing = listed.items?.find((item) => item.targetUrl === targetUrl && item.resource === "messages" && item.event === "created");
  let webhookId = existing?.id;
  if (webhookId) {
    const updated = await webexTokenData<{ id?: string }>(`webhooks/${encodeURIComponent(webhookId)}`, env.WEBEX_BOT_ACCESS_TOKEN, {
      method: "PUT",
      body: JSON.stringify({
        name: "TDS bot capture commands",
        targetUrl,
        secret: env.WEBEX_WEBHOOK_SECRET,
        status: "active",
      }),
    });
    webhookId = updated.id || webhookId;
  } else {
    const created = await webexTokenData<{ id?: string }>("webhooks", env.WEBEX_BOT_ACCESS_TOKEN, {
      method: "POST", body: JSON.stringify({ name: "TDS bot capture commands", targetUrl, resource: "messages", event: "created", filter: "mentionedPeople=me", secret: env.WEBEX_WEBHOOK_SECRET }),
    });
    webhookId = created.id;
  }
  if (!webhookId) throw new Error("Webex did not return a webhook id");
  const identity = await getCaptureIdentityToken(env);
  await supabaseRequest<void>(env, `webex_capture_identities?organization_id=eq.${identity.row.organization_id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ webhook_id: webhookId, updated_at: new Date().toISOString() }),
  });
  return json({ configured: true });
}

async function getIntegrationSettings(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.organizationId || !session.teamRoles?.some(({ role }) => role === "admin")) return json({ code: "ADMIN_REQUIRED" }, 403);
  const identities = await supabaseRequest<Array<{ webhook_id: string | null; enabled: boolean }>>(env,
    `webex_capture_identities?organization_id=eq.${session.organizationId}&select=webhook_id,enabled&limit=1`);
  const identity = identities[0];
  const integrations = integrationStatus(env);
  const adminTeam = session.teamRoles.find(({ role }) => role === "admin");
  const policies = adminTeam ? await supabaseRequest<Array<{ source_space_id: string }>>(env,
    `team_space_policies?team_id=eq.${adminTeam.teamId}&staff_visibility=eq.true&select=source_space_id`) : [];
  return json({
    integrations: {
      webexOAuth: integrations.webexOAuthConfigured,
      webexCapture: integrations.webexBotConfigured && Boolean(identity?.enabled),
      webhook: Boolean(identity?.webhook_id),
      supabase: integrations.supabaseConfigured,
      llm: integrations.llmConfigured,
    },
    captureRoomCount: policies.length,
    botName: env.WEBEX_BOT_NAME?.trim() || "TDS",
    redirectUri: env.WEBEX_REDIRECT_URI?.trim() || null,
  });
}

async function getInitialSetup(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId || !session.teamRoles?.some(({ role }) => role === "admin")) return json({ code: "ADMIN_REQUIRED" }, 403);
  const organizations = await supabaseRequest<Array<{ initial_setup_completed_at: string | null }>>(env, `organizations?id=eq.${session.organizationId}&select=initial_setup_completed_at&limit=1`);
  const adminTeam = session.teamRoles.find(({ role }) => role === "admin");
  if (!env.WEBEX_BOT_ACCESS_TOKEN) return json({ completed: Boolean(organizations[0]?.initial_setup_completed_at), teamName: adminTeam?.teamName || "", rooms: [] });
  const discovery = await botRooms(env);
  if (!discovery.available) return json({ code: "WEBEX_ROOMS_UNAVAILABLE", message: "Webex spaces could not be loaded for initial setup." }, 503);
  return json({ completed: Boolean(organizations[0]?.initial_setup_completed_at), teamName: adminTeam?.teamName || "", rooms: discovery.rooms });
}

async function completeInitialSetup(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId || !session.teamRoles?.some(({ role }) => role === "admin")) return json({ code: "ADMIN_REQUIRED" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "JSON_REQUIRED" }, 415);
  const body = await request.json() as { teamName?: unknown; emails?: unknown; roomIds?: unknown };
  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const invitations = Array.isArray(body.emails) ? body.emails.flatMap((value) => {
    const email = typeof value === "string" ? value.trim().toLowerCase() : value && typeof value === "object" && typeof (value as { email?: unknown }).email === "string" ? ((value as { email: string }).email).trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
    const role = value && typeof value === "object" && (value as { role?: unknown }).role === "moderator" ? "moderator" as const : "basic" as const;
    return [{ email, role }];
  }) : [];
  const roomIds = Array.isArray(body.roomIds) ? [...new Set(body.roomIds.filter((value): value is string => typeof value === "string"))] : [];
  if (!teamName || teamName.length > 120 || roomIds.length === 0 || !env.WEBEX_BOT_ACCESS_TOKEN) return json({ code: "INVALID_SETUP", message: "Provide a team name and at least one approved Webex space." }, 400);
  if (invitations.some(({ email }) => !isApprovedEmail(email, approvedDomains(env)))) return json({ code: "INVALID_INVITEE", message: "Invitees must use an approved organization email address." }, 400);
  const listed = await webexTokenData<WebexList<WebexRoom>>("rooms?max=100", env.WEBEX_BOT_ACCESS_TOKEN);
  const rooms = (listed.items || []).filter((room) => room.id && room.type !== "direct" && roomIds.includes(room.id)).map((room) => ({ id: room.id!, title: room.title || "Untitled Webex space" }));
  if (rooms.length !== roomIds.length) return json({ code: "INVALID_ROOM_SELECTION" }, 400);
  await supabaseRequest<void>(env, "rpc/complete_initial_admin_setup", { method: "POST", body: JSON.stringify({ p_organization_id: session.organizationId, p_actor_user_id: session.appUserId, p_team_name: teamName, p_invited_emails: invitations, p_rooms: rooms }) });
  return json({ ok: true });
}

function adminGrantFor(session: SessionIdentity, teamId?: string | null): TeamGrant | null {
  const grants = (session.teamRoles || []).filter(({ role }) => role === "admin");
  return grants.find(({ teamId: id }) => id === teamId) || grants[0] || null;
}

async function requireAdminMutation(request: Request, env: Env, teamId?: string | null): Promise<{ session: SessionIdentity; grant: TeamGrant } | Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId) return json({ code: "UNAUTHENTICATED" }, 401);
  const grant = adminGrantFor(session, teamId);
  if (!grant || (teamId && grant.teamId !== teamId)) return json({ code: "ADMIN_REQUIRED" }, 403);
  return { session, grant };
}

function cleanInvitations(value: unknown, env: Env): Array<{ email: string; role: "basic" | "moderator" }> | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const invitations = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { email?: unknown; role?: unknown };
    const email = typeof candidate.email === "string" ? candidate.email.trim().toLowerCase() : "";
    if (!isApprovedEmail(email, approvedDomains(env))) return [];
    return [{ email, role: candidate.role === "moderator" ? "moderator" as const : "basic" as const }];
  });
  return invitations.length === value.length ? [...new Map(invitations.map((item) => [item.email, item])).values()] : null;
}

async function botRooms(env: Env, options: { fresh?: boolean } = {}): Promise<{ rooms: Array<{ id: string; title: string }>; available: boolean }> {
  if (!env.WEBEX_BOT_ACCESS_TOKEN) return { rooms: [], available: false };
  if (!options.fresh && botRoomsCache && botRoomsCache.expiresAt > Date.now()) return botRoomsCache.result;
  try {
    const response = await webexTokenData<WebexList<WebexRoom>>("rooms?max=100", env.WEBEX_BOT_ACCESS_TOKEN);
    const rooms = (response.items || []).filter((room) => room.id && room.type !== "direct")
      .map((room) => ({ id: room.id!, title: room.title?.trim() || "Untitled Webex space" }))
      .sort((left, right) => left.title.localeCompare(right.title));
    const result = { rooms, available: true };
    botRoomsCache = { expiresAt: Date.now() + BOT_ROOMS_CACHE_MS, result };
    return result;
  } catch (error) {
    console.warn("Webex room discovery failed", error instanceof Error ? error.message : "Unknown error");
    const result = { rooms: [], available: false };
    botRoomsCache = { expiresAt: Date.now() + 10_000, result };
    return result;
  }
}

async function getAdminSettings(request: Request, env: Env): Promise<Response> {
  const startedAt = performance.now();
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId) return json({ code: "UNAUTHENTICATED" }, 401);
  const requestedTeamId = new URL(request.url).searchParams.get("teamId");
  const grant = adminGrantFor(session, requestedTeamId);
  if (!grant || (requestedTeamId && grant.teamId !== requestedTeamId)) return json({ code: "ADMIN_REQUIRED" }, 403);
  const administeredIds = (session.teamRoles || []).filter(({ role }) => role === "admin").map(({ teamId }) => teamId);
  const authCompletedAt = performance.now();
  const [teams, memberships, invitations, adminSetupInvitations, directory, grants, requests, auditRows] = await Promise.all([
    supabaseRequest<Array<{ id: string; name: string; status: string; archived_at: string | null }>>(env, `teams?id=${inFilter(administeredIds)}&select=id,name,status,archived_at&order=name.asc`),
    supabaseRequest<Array<{ user_id: string; role: TeamRole; created_at: string }>>(env, `team_memberships?team_id=eq.${grant.teamId}&select=user_id,role,created_at`),
    supabaseRequest<Array<{ id: string; email: string; role: TeamRole; revoked_at: string | null; created_at: string }>>(env, `pending_team_invitations?team_id=eq.${grant.teamId}&accepted_at=is.null&select=id,email,role,revoked_at,created_at&order=created_at.desc`),
    supabaseRequest<Array<{ id: string; email: string; expires_at: string; started_at: string | null; redeemed_at: string | null; revoked_at: string | null; created_at: string }>>(env, `team_admin_setup_invitations?organization_id=eq.${session.organizationId}&select=id,email,expires_at,started_at,redeemed_at,revoked_at,created_at&order=created_at.desc&limit=100`),
    supabaseRequest<Array<{ id: string; name: string }>>(env, `teams?organization_id=eq.${session.organizationId}&status=eq.active&select=id,name&order=name.asc`),
    supabaseRequest<Array<{ id: string; source_team_id: string; recipient_team_id: string; source_space_id: string; status: string; granted_at: string; revoked_at: string | null }>>(env, `space_sharing_grants?or=(source_team_id.eq.${grant.teamId},recipient_team_id.eq.${grant.teamId})&select=id,source_team_id,recipient_team_id,source_space_id,status,granted_at,revoked_at&order=granted_at.desc`),
    supabaseRequest<Array<{ id: string; requester_team_id: string; source_team_id: string; status: string; note: string; created_at: string; decided_at: string | null }>>(env, `space_access_requests?or=(source_team_id.eq.${grant.teamId},requester_team_id.eq.${grant.teamId})&select=id,requester_team_id,source_team_id,status,note,created_at,decided_at&order=created_at.desc`),
    supabaseRequest<Array<{ id: string; actor_user_id: string | null; action: string; target_type: string; target_id: string | null; metadata: Record<string, unknown>; occurred_at: string }>>(env, `audit_events?organization_id=eq.${session.organizationId}&select=id,actor_user_id,action,target_type,target_id,metadata,occurred_at&order=occurred_at.desc&limit=200`),
  ]);
  const primaryCompletedAt = performance.now();
  const [users, sourceSpaces, teamDocuments] = await Promise.all([
    supabaseRequest<Array<{ id: string; display_name: string; email: string; status: AccountStatus; last_signed_in_at: string | null }>>(env, `users?organization_id=eq.${session.organizationId}&select=id,display_name,email,status,last_signed_in_at&order=display_name.asc`),
    supabaseRequest<Array<{ id: string; provider_space_id: string; display_name: string }>>(env, `source_spaces?organization_id=eq.${session.organizationId}&provider=eq.webex&select=id,provider_space_id,display_name`),
    supabaseRequest<Array<{ id: string }>>(env, `documents?review_team_id=eq.${grant.teamId}&select=id`),
  ]);
  const sourceIds = sourceSpaces.map(({ id }) => id);
  const [policies, requestItems] = await Promise.all([
    sourceIds.length ? supabaseRequest<Array<{ team_id: string; source_space_id: string; is_default_capture: boolean }>>(env, `team_space_policies?source_space_id=${inFilter(sourceIds)}&select=team_id,source_space_id,is_default_capture`) : Promise.resolve([]),
    requests.length ? supabaseRequest<Array<{ request_id: string; source_space_id: string }>>(env, `space_access_request_items?request_id=${inFilter(requests.map(({ id }) => id))}&select=request_id,source_space_id`) : Promise.resolve([]),
  ]);
  const teamDocumentIds = new Set(teamDocuments.map(({ id }) => id));
  const directorySpaces = policies.filter(({ is_default_capture }) => is_default_capture).map((policy) => ({
    teamId: policy.team_id, sourceSpaceId: policy.source_space_id,
    name: sourceSpaces.find(({ id }) => id === policy.source_space_id)?.display_name || "Webex space",
  }));
  const relevantAudit = auditRows.filter(({ action, target_type, target_id, metadata }) => target_type === "admin_setup_invitation" || action === "team_admin_setup_completed" || target_id === grant.teamId || (target_id ? teamDocumentIds.has(target_id) : false) || Object.values(metadata || {}).includes(grant.teamId));
  const completedAt = performance.now();
  return json({
    currentUserId: session.appUserId, selectedTeamId: grant.teamId, signInUrl: appOrigin(request, env), teams,
    selectedTeam: teams.find(({ id }) => id === grant.teamId) || { id: grant.teamId, name: grant.teamName, status: "active", archived_at: null },
    members: memberships.map((membership) => {
      const user = users.find(({ id }) => id === membership.user_id);
      return { id: membership.user_id, displayName: user?.display_name || "TDS user", email: user?.email || "", status: user?.status || "inactive", lastSignedInAt: user?.last_signed_in_at || null, role: membership.role };
    }),
    availableUsers: users.filter((user) => user.status !== "suspended" && !memberships.some(({ user_id }) => user_id === user.id)).map((user) => ({ id: user.id, displayName: user.display_name, email: user.email, status: user.status })),
    invitations: invitations.map((invite) => ({ ...invite, status: invite.revoked_at ? "revoked" : "pending" })),
    adminSetupInvitations: adminSetupInvitations.map((invite) => ({
      ...invite,
      status: adminSetupInvitationStatus(invite),
    })),
    webexRoomsAvailable: null,
    roomsLoaded: false,
    rooms: [],
    directory: directory.map((team) => ({ ...team, spaces: directorySpaces.filter(({ teamId }) => teamId === team.id) })),
    grants: grants.map((item) => ({ ...item, sourceTeamName: directory.find(({ id }) => id === item.source_team_id)?.name || "Team", recipientTeamName: directory.find(({ id }) => id === item.recipient_team_id)?.name || "Team", spaceName: sourceSpaces.find(({ id }) => id === item.source_space_id)?.display_name || "Webex space" })),
    requests: requests.map((item) => ({ ...item, requesterTeamName: directory.find(({ id }) => id === item.requester_team_id)?.name || "Team", sourceTeamName: directory.find(({ id }) => id === item.source_team_id)?.name || "Team", spaces: requestItems.filter(({ request_id }) => request_id === item.id).map(({ source_space_id }) => ({ id: source_space_id, name: sourceSpaces.find(({ id }) => id === source_space_id)?.display_name || "Webex space" })) })),
    audit: relevantAudit.slice(0, 100).map((event) => ({ ...event, actorName: users.find(({ id }) => id === event.actor_user_id)?.display_name || "System" })),
  }, 200, { "server-timing": `auth;dur=${(authCompletedAt - startedAt).toFixed(1)}, primary;dur=${(primaryCompletedAt - authCompletedAt).toFixed(1)}, related;dur=${(completedAt - primaryCompletedAt).toFixed(1)}, total;dur=${(completedAt - startedAt).toFixed(1)}` });
}

async function getAdminSettingsRooms(request: Request, env: Env): Promise<Response> {
  const startedAt = performance.now();
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId) return json({ code: "UNAUTHENTICATED" }, 401);
  const requestedTeamId = new URL(request.url).searchParams.get("teamId");
  const grant = adminGrantFor(session, requestedTeamId);
  if (!grant || (requestedTeamId && grant.teamId !== requestedTeamId)) return json({ code: "ADMIN_REQUIRED" }, 403);
  const administeredIds = (session.teamRoles || []).filter(({ role }) => role === "admin").map(({ teamId }) => teamId);
  const [roomDiscovery, sourceSpaces, directory] = await Promise.all([
    botRooms(env),
    supabaseRequest<Array<{ id: string; provider_space_id: string; display_name: string }>>(env, `source_spaces?organization_id=eq.${session.organizationId}&provider=eq.webex&select=id,provider_space_id,display_name`),
    supabaseRequest<Array<{ id: string; name: string }>>(env, `teams?organization_id=eq.${session.organizationId}&status=eq.active&select=id,name&order=name.asc`),
  ]);
  const sourceIds = sourceSpaces.map(({ id }) => id);
  const policies = sourceIds.length ? await supabaseRequest<Array<{ team_id: string; source_space_id: string; is_default_capture: boolean }>>(env, `team_space_policies?source_space_id=${inFilter(sourceIds)}&select=team_id,source_space_id,is_default_capture`) : [];
  const completedAt = performance.now();
  return json({
    roomsLoaded: true,
    webexRoomsAvailable: roomDiscovery.available,
    rooms: roomDiscovery.rooms.map((room) => {
      const source = sourceSpaces.find(({ provider_space_id }) => provider_space_id === room.id);
      const assigned = source ? policies.some((policy) => policy.source_space_id === source.id && policy.team_id === grant.teamId) : false;
      const defaultPolicy = source ? policies.find((policy) => policy.source_space_id === source.id && policy.is_default_capture) : undefined;
      return { ...room, sourceSpaceId: source?.id || null, assigned, isDefault: defaultPolicy?.team_id === grant.teamId, canMakeDefault: !defaultPolicy || administeredIds.includes(defaultPolicy.team_id), defaultTeamId: defaultPolicy?.team_id || null, defaultTeamName: directory.find(({ id }) => id === defaultPolicy?.team_id)?.name || null };
    }),
  }, 200, { "server-timing": `rooms;dur=${(completedAt - startedAt).toFixed(1)}` });
}

async function readAdminSetupSession(request: Request, env: Env): Promise<SessionIdentity | null> {
  const resolved = await resolveSession(request, env);
  return resolved?.session || null;
}

async function createAdminSetupInvitation(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  const body = await request.json() as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isApprovedEmail(email, approvedDomains(env))) return json({ code: "INVALID_INVITEE", message: "Use an approved TD SYNNEX email address." }, 400);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + ADMIN_SETUP_TTL_SECONDS * 1000).toISOString();
  const id = await supabaseRequest<string>(env, "rpc/create_team_admin_setup_invitation", {
    method: "POST",
    body: JSON.stringify({ p_organization_id: auth.session.organizationId, p_actor_user_id: auth.session.appUserId, p_email: email, p_token_hash: tokenHash, p_expires_at: expiresAt }),
  });
  return json({ id, email, expiresAt, inviteUrl: `${appOrigin(request, env)}/admin-setup#token=${encodeURIComponent(token)}` }, 201);
}

async function revokeAdminSetupInvitation(request: Request, env: Env, invitationId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  await supabaseRequest<void>(env, "rpc/revoke_team_admin_setup_invitation", {
    method: "POST", body: JSON.stringify({ p_invitation_id: invitationId, p_actor_user_id: auth.session.appUserId }),
  });
  return json({ ok: true });
}

async function establishAdminSetupContext(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  if (!env.SESSION_ENCRYPTION_KEY) return json({ code: "SERVICE_NOT_CONFIGURED" }, 503);
  const body = await request.json() as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return json({ code: "INVALID_INVITATION" }, 400);
  const tokenHash = await sha256Hex(token);
  const invitations = await supabaseRequest<Array<{ id: string; email: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null }>>(env,
    `team_admin_setup_invitations?token_hash=eq.${tokenHash}&select=id,email,expires_at,redeemed_at,revoked_at&limit=1`);
  const invitation = invitations[0];
  if (!invitation || invitation.redeemed_at || invitation.revoked_at || Date.parse(invitation.expires_at) <= Date.now()) return json({ code: "INVITATION_UNAVAILABLE", message: "This Admin setup invitation is invalid, expired, revoked, or already used." }, 410);
  const context: AdminSetupContext = { invitationId: invitation.id, tokenHash, expiresAt: Date.parse(invitation.expires_at) };
  const sealed = await seal(context, env.SESSION_ENCRYPTION_KEY);
  const maxAge = Math.max(1, Math.min(ADMIN_SETUP_TTL_SECONDS, Math.floor((context.expiresAt - Date.now()) / 1000)));
  return json({ ok: true, email: invitation.email }, 200, { "set-cookie": cookie(ADMIN_SETUP_COOKIE, sealed, maxAge) });
}

async function readAdminSetupInvitation(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_ENCRYPTION_KEY) return json({ code: "SERVICE_NOT_CONFIGURED" }, 503);
  const sealed = readCookie(request, ADMIN_SETUP_COOKIE);
  const context = sealed ? await unseal<AdminSetupContext>(sealed, env.SESSION_ENCRYPTION_KEY) : null;
  if (!context || context.expiresAt <= Date.now()) return json({ code: "INVITATION_CONTEXT_REQUIRED" }, 401);
  const invitations = await supabaseRequest<Array<{ id: string; email: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null }>>(env,
    `team_admin_setup_invitations?id=eq.${context.invitationId}&token_hash=eq.${context.tokenHash}&select=id,email,expires_at,redeemed_at,revoked_at&limit=1`);
  const invitation = invitations[0];
  if (!invitation || invitation.redeemed_at || invitation.revoked_at || Date.parse(invitation.expires_at) <= Date.now()) return json({ code: "INVITATION_UNAVAILABLE" }, 410);
  const session = await readAdminSetupSession(request, env);
  if (!session) return json({ authenticated: false, email: invitation.email, expiresAt: invitation.expires_at, rooms: [] });
  if (session.email.toLowerCase() !== invitation.email) return json({ code: "INVITATION_EMAIL_MISMATCH", message: `Sign in with ${invitation.email} to use this invitation.` }, 403);
  await supabaseRequest<void>(env, `team_admin_setup_invitations?id=eq.${invitation.id}&started_at=is.null`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ started_at: new Date().toISOString() }),
  });
  const available = await botRooms(env, { fresh: true });
  return json({ authenticated: true, email: invitation.email, expiresAt: invitation.expires_at, rooms: available.rooms, roomsAvailable: available.available });
}

async function completeAdminSetupInvitation(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  if (!env.SESSION_ENCRYPTION_KEY) return json({ code: "SERVICE_NOT_CONFIGURED" }, 503);
  const session = await readAdminSetupSession(request, env);
  if (!session?.appUserId || !session.organizationId) return json({ code: "UNAUTHENTICATED" }, 401);
  const sealed = readCookie(request, ADMIN_SETUP_COOKIE);
  const context = sealed ? await unseal<AdminSetupContext>(sealed, env.SESSION_ENCRYPTION_KEY) : null;
  if (!context || context.expiresAt <= Date.now()) return json({ code: "INVITATION_CONTEXT_REQUIRED" }, 401);
  const invitationRows = await supabaseRequest<Array<{ email: string }>>(env, `team_admin_setup_invitations?id=eq.${context.invitationId}&token_hash=eq.${context.tokenHash}&select=email&limit=1`);
  if (!invitationRows[0] || invitationRows[0].email !== session.email.toLowerCase()) return json({ code: "INVITATION_EMAIL_MISMATCH" }, 403);
  const body = await request.json() as { teamName?: unknown; invitations?: unknown; roomIds?: unknown };
  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const invitations = cleanInvitations(body.invitations, env);
  const roomIds = Array.isArray(body.roomIds) ? [...new Set(body.roomIds.filter((id): id is string => typeof id === "string"))] : [];
  if (!teamName || teamName.length > 120 || !invitations || roomIds.length === 0) return json({ code: "INVALID_SETUP", message: "Provide a team name and at least one Webex space." }, 400);
  const available = await botRooms(env, { fresh: true });
  if (!available.available) return json({ code: "WEBEX_ROOMS_UNAVAILABLE" }, 503);
  const selected = available.rooms.filter(({ id }) => roomIds.includes(id));
  if (selected.length !== roomIds.length) return json({ code: "INVALID_ROOM_SELECTION" }, 400);
  const teamId = await supabaseRequest<string>(env, "rpc/complete_team_admin_setup_invitation", {
    method: "POST",
    body: JSON.stringify({ p_invitation_id: context.invitationId, p_token_hash: context.tokenHash, p_user_id: session.appUserId, p_team_name: teamName, p_invitations: invitations, p_rooms: selected }),
  });
  return json({ ok: true, teamId }, 201);
}

async function createTeam(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  const body = await request.json() as { name?: unknown; invitations?: unknown; roomIds?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const invitations = cleanInvitations(body.invitations, env);
  const roomIds = Array.isArray(body.roomIds) ? [...new Set(body.roomIds.filter((id): id is string => typeof id === "string"))] : [];
  if (!name || name.length > 120 || !invitations) return json({ code: "INVALID_TEAM" }, 400);
  const available = await botRooms(env, { fresh: true });
  if (!available.available) return json({ code: "WEBEX_ROOMS_UNAVAILABLE", message: "Webex spaces could not be loaded." }, 503);
  const selected = available.rooms.filter(({ id }) => roomIds.includes(id));
  if (selected.length !== roomIds.length) return json({ code: "INVALID_ROOM_SELECTION" }, 400);
  const teamId = await supabaseRequest<string>(env, "rpc/create_team_with_setup", { method: "POST", body: JSON.stringify({ p_organization_id: auth.session.organizationId, p_actor_user_id: auth.session.appUserId, p_team_name: name, p_invitations: invitations, p_rooms: selected }) });
  return json({ ok: true, teamId }, 201);
}

async function updateTeam(request: Request, env: Env, teamId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env, teamId); if (auth instanceof Response) return auth;
  const body = await request.json() as { name?: unknown; status?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const status = body.status === "archived" ? "archived" : "active";
  if (!name || name.length > 120) return json({ code: "INVALID_TEAM_NAME" }, 400);
  await supabaseRequest<void>(env, "rpc/update_team_profile", { method: "POST", body: JSON.stringify({ p_team_id: teamId, p_actor_user_id: auth.session.appUserId, p_name: name, p_status: status }) });
  return json({ ok: true });
}

async function createInvitations(request: Request, env: Env, teamId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env, teamId); if (auth instanceof Response) return auth;
  const body = await request.json() as { invitations?: unknown }; const invitations = cleanInvitations(body.invitations, env);
  if (!invitations || invitations.length === 0) return json({ code: "INVALID_INVITATIONS" }, 400);
  await supabaseRequest<void>(env, "rpc/create_team_invitations", { method: "POST", body: JSON.stringify({ p_team_id: teamId, p_actor_user_id: auth.session.appUserId, p_invitations: invitations }) });
  return json({ ok: true }, 201);
}

async function revokeInvitation(request: Request, env: Env, invitationId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  await supabaseRequest<void>(env, "rpc/revoke_team_invitation", { method: "POST", body: JSON.stringify({ p_invitation_id: invitationId, p_actor_user_id: auth.session.appUserId }) });
  return json({ ok: true });
}

async function configureTeamSpace(request: Request, env: Env, teamId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env, teamId); if (auth instanceof Response) return auth;
  const body = await request.json() as { roomId?: unknown; enabled?: unknown; makeDefault?: unknown };
  const roomId = typeof body.roomId === "string" ? body.roomId : ""; const available = await botRooms(env, { fresh: true });
  if (!available.available) return json({ code: "WEBEX_ROOMS_UNAVAILABLE", message: "Webex spaces could not be loaded." }, 503);
  const room = available.rooms.find(({ id }) => id === roomId);
  if (!room) return json({ code: "INVALID_ROOM" }, 400);
  await supabaseRequest<void>(env, "rpc/configure_team_webex_space", { method: "POST", body: JSON.stringify({ p_team_id: teamId, p_actor_user_id: auth.session.appUserId, p_organization_id: auth.session.organizationId, p_provider_space_id: room.id, p_display_name: room.title, p_enabled: body.enabled === true, p_make_default: body.makeDefault === true }) });
  return json({ ok: true });
}

async function createSpaceGrant(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  const body = await request.json() as { sourceTeamId?: unknown; recipientTeamId?: unknown; sourceSpaceId?: unknown };
  if (body.sourceTeamId !== auth.grant.teamId || typeof body.recipientTeamId !== "string" || typeof body.sourceSpaceId !== "string") return json({ code: "INVALID_GRANT" }, 400);
  const id = await supabaseRequest<string>(env, "rpc/grant_team_space_access", { method: "POST", body: JSON.stringify({ p_source_team_id: body.sourceTeamId, p_recipient_team_id: body.recipientTeamId, p_source_space_id: body.sourceSpaceId, p_actor_user_id: auth.session.appUserId }) });
  return json({ ok: true, id }, 201);
}

async function revokeSpaceGrant(request: Request, env: Env, grantId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  await supabaseRequest<void>(env, "rpc/revoke_team_space_access", { method: "POST", body: JSON.stringify({ p_grant_id: grantId, p_actor_user_id: auth.session.appUserId }) });
  return json({ ok: true });
}

async function createAccessRequest(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { requesterTeamId?: unknown; sourceTeamId?: unknown; sourceSpaceIds?: unknown; note?: unknown };
  const auth = await requireAdminMutation(request, env, typeof body.requesterTeamId === "string" ? body.requesterTeamId : null); if (auth instanceof Response) return auth;
  const spaceIds = Array.isArray(body.sourceSpaceIds) ? [...new Set(body.sourceSpaceIds.filter((id): id is string => typeof id === "string"))] : [];
  if (typeof body.sourceTeamId !== "string" || spaceIds.length === 0) return json({ code: "INVALID_REQUEST" }, 400);
  const id = await supabaseRequest<string>(env, "rpc/create_space_access_request", { method: "POST", body: JSON.stringify({ p_requester_team_id: auth.grant.teamId, p_source_team_id: body.sourceTeamId, p_actor_user_id: auth.session.appUserId, p_space_ids: spaceIds, p_note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "" }) });
  return json({ ok: true, id }, 201);
}

async function decideAccessRequest(request: Request, env: Env, requestId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env); if (auth instanceof Response) return auth;
  const body = await request.json() as { decision?: unknown };
  if (body.decision !== "approved" && body.decision !== "denied") return json({ code: "INVALID_DECISION" }, 400);
  await supabaseRequest<void>(env, "rpc/decide_space_access_request", { method: "POST", body: JSON.stringify({ p_request_id: requestId, p_actor_user_id: auth.session.appUserId, p_decision: body.decision }) });
  return json({ ok: true });
}

function inFilter(values: string[]): string {
  return `in.(${values.join(",")})`;
}

export function hasReviewAccess(teamRoles: readonly Pick<TeamGrant, "role">[] = []): boolean {
  return teamRoles.some(({ role }) => role === "moderator" || role === "admin");
}

export function organizationWideFromReview(value: unknown): boolean {
  return value !== false;
}

export function defaultReviewOrganizationWide(storedOrganizationWide: boolean, hasPublishedVersion: boolean): boolean {
  return hasPublishedVersion ? storedOrganizationWide : true;
}

const SOP_ASSET_BUCKET = "sop-assets";

async function storageRequest(env: Env, key: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = supabaseSecret(env);
  if (!baseUrl || !secret) throw new Error("Supabase is not configured");
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  headers.set("authorization", `Bearer ${secret}`);
  return fetch(`${baseUrl}/storage/v1/object/${SOP_ASSET_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`, { ...init, headers });
}

async function uploadSopAsset(env: Env, key: string, mimeType: string, data: string): Promise<void> {
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  const valid = bytes.length <= 4 * 1024 * 1024 && (
    (mimeType === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
    || (mimeType === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || (mimeType === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP")
  );
  if (!valid) throw new Error("SOP asset signature was invalid");
  const response = await storageRequest(env, key, { method: "POST", headers: { "content-type": mimeType, "x-upsert": "false" }, body: bytes });
  if (!response.ok) throw new Error(`SOP asset upload failed with status ${response.status}`);
}

async function removeSopAssets(env: Env, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => storageRequest(env, key, { method: "DELETE" }).catch(() => undefined)));
}

type SourceRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };
type SourceBlock = {
  id: string; sourceId: string; type: "heading" | "paragraph" | "list-item" | "table" | "image";
  runs?: SourceRun[]; level?: number; ordered?: boolean; marker?: string; rows?: SourceRun[][][]; src?: string; assetKey?: string; alt?: string;
};
export interface StoredSourceContent { blocks: SourceBlock[]; suggestions: []; limitations: string[] }

function sourceRun(value: unknown): value is SourceRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Record<string, unknown>;
  return typeof run.text === "string" && run.text.length <= 8000
    && [run.bold, run.italic, run.underline].every((flag) => flag === undefined || typeof flag === "boolean");
}

/** Read the source-faithful presentation only after document authorization. */
export function sourceContentFromEvidenceMap(value: unknown): StoredSourceContent | null {
  if (!value || typeof value !== "object") return null;
  const content = (value as Record<string, unknown>).source_content;
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  if (!Array.isArray(record.blocks) || record.blocks.length > 1000 || !Array.isArray(record.limitations) || record.limitations.length > 100) return null;
  if (!record.limitations.every((item) => typeof item === "string" && item.length <= 8000)) return null;
  const blocks: SourceBlock[] = [];
  for (const value of record.blocks) {
    if (!value || typeof value !== "object") return null;
    const block = value as Record<string, unknown>;
    if ("src" in block || typeof block.id !== "string" || block.id.length > 200 || typeof block.sourceId !== "string" || block.sourceId.length > 100
      || !["heading", "paragraph", "list-item", "table", "image"].includes(String(block.type))) return null;
    if (block.runs !== undefined && (!Array.isArray(block.runs) || block.runs.length > 500 || !block.runs.every(sourceRun))) return null;
    if (block.rows !== undefined && (!Array.isArray(block.rows) || block.rows.length > 100 || !block.rows.every((row) => Array.isArray(row) && row.length <= 100 && row.every((cell) => Array.isArray(cell) && cell.length <= 100 && cell.every(sourceRun))))) return null;
    if (block.level !== undefined && !Number.isInteger(block.level)) return null;
    if (block.ordered !== undefined && typeof block.ordered !== "boolean") return null;
    if (block.marker !== undefined && (typeof block.marker !== "string" || block.marker.length > 20)) return null;
    if (block.alt !== undefined && (typeof block.alt !== "string" || block.alt.length > 1000)) return null;
    if (block.assetKey !== undefined && (typeof block.assetKey !== "string" || !/^[a-zA-Z0-9/_-]+\.(png|jpg|webp)$/.test(block.assetKey) || block.assetKey.length > 500)) return null;
    const clean: SourceBlock = {
      id: block.id,
      sourceId: block.sourceId,
      type: block.type as SourceBlock["type"],
    };
    if (Array.isArray(block.runs)) clean.runs = (block.runs as SourceRun[]).map(({ text, bold, italic, underline }) => ({ text, bold, italic, underline }));
    if (Array.isArray(block.rows)) clean.rows = (block.rows as SourceRun[][][]).map((row) => row.map((cell) => cell.map(({ text, bold, italic, underline }) => ({ text, bold, italic, underline }))));
    if (typeof block.level === "number") clean.level = block.level;
    if (typeof block.ordered === "boolean") clean.ordered = block.ordered;
    if (typeof block.marker === "string") clean.marker = block.marker;
    if (typeof block.alt === "string") clean.alt = block.alt;
    if (typeof block.assetKey === "string") clean.assetKey = block.assetKey;
    blocks.push(clean);
  }
  return { blocks, suggestions: [], limitations: record.limitations as string[] };
}

function sourceContentForClient(documentId: string, versionId: string, content: StoredSourceContent | null): StoredSourceContent | null {
  if (!content) return null;
  return { ...content, blocks: content.blocks.map(({ assetKey, ...block }) => ({ ...block, ...(assetKey ? { src: `/api/sop-assets/${encodeURIComponent(documentId)}/${encodeURIComponent(versionId)}/${encodeURIComponent(block.id)}` } : {}) })) as SourceBlock[] };
}

async function getSopAsset(request: Request, env: Env, documentId: string, versionId: string, blockId: string): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  const [readIds, reviewIds] = await Promise.all([authorizedDocumentIds(env, session), authorizedDocumentIds(env, session, "review")]);
  if (!readIds.includes(documentId) && !reviewIds.includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  if (!reviewIds.includes(documentId)) {
    const documents = await supabaseRequest<Array<{ current_published_version_id: string | null }>>(env, `documents?id=eq.${documentId}&select=current_published_version_id&limit=1`);
    if (documents[0]?.current_published_version_id !== versionId) return json({ code: "NOT_FOUND" }, 404);
  }
  const versions = await supabaseRequest<Array<{ evidence_map: unknown }>>(env, `document_versions?id=eq.${versionId}&document_id=eq.${documentId}&select=evidence_map&limit=1`);
  const content = sourceContentFromEvidenceMap(versions[0]?.evidence_map);
  const assetKey = content?.blocks.find((block) => block.id === blockId && block.type === "image")?.assetKey;
  if (!assetKey) return json({ code: "NOT_FOUND" }, 404);
  const asset = await storageRequest(env, assetKey);
  if (!asset.ok || !asset.body) return json({ code: "NOT_FOUND" }, 404);
  const contentType = assetKey.endsWith(".png") ? "image/png" : assetKey.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new Response(asset.body, { headers: { "cache-control": "private, max-age=300", "content-type": contentType, "x-content-type-options": "nosniff" } });
}

export function sourceContentText(content: StoredSourceContent | null): string {
  if (!content) return "";
  return content.blocks.map((block) => {
    if (block.type === "table") return (block.rows || []).map((row) => row.map((cell) => cell.map(({ text }) => text).join("")).join("\t")).join("\n");
    if (block.type === "image") return block.alt || "";
    return (block.runs || []).map(({ text }) => text).join("");
  }).filter(Boolean).join("\n");
}

async function authorizedDocumentIds(env: Env, session: SessionIdentity, mode: "read" | "review" | "revise" = "read"): Promise<string[]> {
  if (!session.organizationId) return [];
  const allTeamIds = (session.teamRoles || []).map(({ teamId }) => teamId);
  const staffTeamIds = (session.teamRoles || []).filter(({ role }) => role === "moderator" || role === "admin").map(({ teamId }) => teamId);
  if (mode === "review") {
    if (staffTeamIds.length === 0) return [];
    const [rows, teamRows] = await Promise.all([
      supabaseRequest<Array<{ id: string }>>(env, `documents?organization_id=eq.${session.organizationId}&review_team_id=${inFilter(staffTeamIds)}&select=id`),
      supabaseRequest<Array<{ document_id: string }>>(env, `document_teams?team_id=${inFilter(staffTeamIds)}&select=document_id`),
    ]);
    return [...new Set([...rows.map(({ id }) => id), ...teamRows.map(({ document_id }) => document_id)])];
  }
  const teamIds = mode === "revise" ? staffTeamIds : allTeamIds;
  const ids = new Set<string>();
  if (teamIds.length) {
    const direct = await supabaseRequest<Array<{ document_id: string }>>(env, `document_teams?team_id=${inFilter(teamIds)}&select=document_id`);
    direct.forEach(({ document_id }) => ids.add(document_id));
    const grants = await supabaseRequest<Array<{ source_space_id: string }>>(env, `space_sharing_grants?recipient_team_id=${inFilter(teamIds)}&status=eq.active&select=source_space_id`);
    const spaceIds = [...new Set(grants.map(({ source_space_id }) => source_space_id))];
    if (spaceIds.length) {
      const shared = await supabaseRequest<Array<{ id: string }>>(env, `documents?organization_id=eq.${session.organizationId}&source_space_id=${inFilter(spaceIds)}&select=id`);
      shared.forEach(({ id }) => ids.add(id));
    }
  }
  const organizationWide = await supabaseRequest<Array<{ id: string }>>(env, `documents?organization_id=eq.${session.organizationId}&organization_wide=eq.true&select=id`);
  if (mode === "read" || staffTeamIds.length) organizationWide.forEach(({ id }) => ids.add(id));
  if (mode === "read" || (mode === "revise" && staffTeamIds.length)) {
    const archivedTeams = await supabaseRequest<Array<{ id: string }>>(env, `teams?organization_id=eq.${session.organizationId}&status=eq.archived&select=id`);
    if (archivedTeams.length) {
      const orphaned = await supabaseRequest<Array<{ id: string }>>(env, `documents?organization_id=eq.${session.organizationId}&review_team_id=${inFilter(archivedTeams.map(({ id }) => id))}&select=id`);
      orphaned.forEach(({ id }) => ids.add(id));
    }
  }
  return [...ids];
}

async function getReviewQueue(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!hasReviewAccess(session.teamRoles)) return json({ code: "FORBIDDEN" }, 403);
  const ids = await authorizedDocumentIds(env, session, "review");
  if (ids.length === 0) return json({ items: [] });
  const captures = await supabaseRequest<Array<{ document_id: string; command: string; requested_by_user_id: string; created_at: string }>>(env,
    `capture_requests?document_id=${inFilter(ids)}&status=eq.awaiting_review&select=document_id,command,requested_by_user_id,created_at&order=created_at.desc`);
  const latestCaptures = captures.filter((capture, index) => captures.findIndex(({ document_id }) => document_id === capture.document_id) === index);
  if (latestCaptures.length === 0) return json({ items: [] });
  const docIds = latestCaptures.map(({ document_id }) => document_id);
  const documents = await supabaseRequest<Array<{ id: string; workflow_state: string; source_space_id: string; review_team_id: string | null; organization_wide: boolean; current_published_version_id: string | null; updated_at: string }>>(env,
    `documents?id=${inFilter(docIds)}&select=id,workflow_state,source_space_id,review_team_id,organization_wide,current_published_version_id,updated_at&order=updated_at.desc`);
  const [versions, spaces, documentTeams] = await Promise.all([
    supabaseRequest<Array<{ id: string; document_id: string; title: string; summary: string; version_number: number; created_at: string }>>(env,
      `document_versions?document_id=${inFilter(docIds)}&select=id,document_id,title,summary,version_number,created_at&order=version_number.desc`),
    (() => {
      const sourceSpaceIds = [...new Set(documents.map(({ source_space_id }) => source_space_id).filter(Boolean))];
      return sourceSpaceIds.length
        ? supabaseRequest<Array<{ id: string; display_name: string }>>(env, `source_spaces?id=${inFilter(sourceSpaceIds)}&select=id,display_name`)
        : Promise.resolve([] as Array<{ id: string; display_name: string }>);
    })(),
    supabaseRequest<Array<{ document_id: string; team_id: string }>>(env,
      `document_teams?document_id=${inFilter(docIds)}&select=document_id,team_id`),
  ]);
  const teamByDocument = new Map(documentTeams.map(({ document_id, team_id }) => [document_id, team_id]));
  documents.forEach(({ id, review_team_id }) => { if (review_team_id) teamByDocument.set(id, review_team_id); });
  const reviewTeamIds = [...new Set(documents.map(({ id }) => teamByDocument.get(id)).filter((id): id is string => Boolean(id)))];
  const reviewTeams = reviewTeamIds.length
    ? await supabaseRequest<Array<{ id: string; name: string }>>(env, `teams?id=${inFilter(reviewTeamIds)}&select=id,name`)
    : [];
  const userIds = [...new Set(latestCaptures.map(({ requested_by_user_id }) => requested_by_user_id))];
  const users = userIds.length ? await supabaseRequest<Array<{ id: string; display_name: string }>>(env, `users?id=${inFilter(userIds)}&select=id,display_name`) : [];
  return json({ items: documents.map((document) => {
    const version = versions.find((item) => item.document_id === document.id);
    const capture = latestCaptures.find((item) => item.document_id === document.id);
    return {
      id: document.id, title: version?.title || "Untitled draft", summary: version?.summary || "",
      sourceSpace: spaces.find(({ id }) => id === document.source_space_id)?.display_name || "Webex space",
      teamName: reviewTeams.find(({ id }) => id === teamByDocument.get(document.id))?.name || "Assigned team", reason: capture?.command === "update" ? "thread_update" : "new_capture",
      requestedBy: users.find(({ id }) => id === capture?.requested_by_user_id)?.display_name || "TDS user",
      requestedAt: capture?.created_at || document.updated_at, workflowState: "awaiting_review",
      organizationWide: defaultReviewOrganizationWide(document.organization_wide, Boolean(document.current_published_version_id)),
    };
  }) });
}

async function getProcessingIssues(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!hasReviewAccess(session.teamRoles)) return json({ code: "FORBIDDEN" }, 403);
  const documentIds = await authorizedDocumentIds(env, session, "review");
  if (documentIds.length === 0) return json({ items: [] });
  const captures = await supabaseRequest<Array<{ id: string; document_id: string; requested_by_user_id: string; safe_error_code: string | null; created_at: string }>>(env,
    `capture_requests?document_id=${inFilter(documentIds)}&status=eq.processing_failed&select=id,document_id,requested_by_user_id,safe_error_code,created_at&order=created_at.desc`);
  if (captures.length === 0) return json({ items: [] });
  const [documents, spaces, users] = await Promise.all([
    supabaseRequest<Array<{ id: string; source_space_id: string }>>(env, `documents?id=${inFilter([...new Set(captures.map(({ document_id }) => document_id))])}&select=id,source_space_id`),
    supabaseRequest<Array<{ id: string; display_name: string }>>(env, "source_spaces?select=id,display_name"),
    supabaseRequest<Array<{ id: string; display_name: string }>>(env, `users?id=${inFilter([...new Set(captures.map(({ requested_by_user_id }) => requested_by_user_id))])}&select=id,display_name`),
  ]);
  return json({ items: captures.map((capture) => {
    const document = documents.find(({ id }) => id === capture.document_id);
    return {
      id: capture.id, documentId: capture.document_id, title: "Processing issue", reason: "processing_failed",
      sourceSpace: spaces.find(({ id }) => id === document?.source_space_id)?.display_name || "Webex space",
      teamName: session.teamRoles?.[0]?.teamName || "Assigned team",
      requestedBy: users.find(({ id }) => id === capture.requested_by_user_id)?.display_name || "TDS user",
      requestedAt: capture.created_at, safeErrorCode: capture.safe_error_code || "PROCESSING_FAILED",
    };
  }) });
}

async function getReviewDetail(request: Request, env: Env, documentId: string): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!hasReviewAccess(session.teamRoles)) return json({ code: "FORBIDDEN" }, 403);
  if (!(await authorizedDocumentIds(env, session, "review")).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  const [versions, documents] = await Promise.all([
    supabaseRequest<Array<{ id: string; source_snapshot_id: string; title: string; problem: string; summary: string; steps: string[]; warnings: string[]; evidence_map: unknown; version_number: number }>>(env,
      `document_versions?document_id=eq.${documentId}&select=id,source_snapshot_id,title,problem,summary,steps,warnings,evidence_map,version_number&order=version_number.desc&limit=1`),
    supabaseRequest<Array<{ organization_wide: boolean; current_published_version_id: string | null }>>(env,
      `documents?id=eq.${documentId}&select=organization_wide,current_published_version_id&limit=1`),
  ]);
  const version = versions[0];
  if (!version) return json({ code: "DRAFT_NOT_READY" }, 409);
  const messages = await supabaseRequest<Array<{ provider_message_id: string; author_display_name: string; source_markdown: string; sent_at: string; ordinal: number }>>(env,
    `source_messages?source_snapshot_id=eq.${version.source_snapshot_id}&select=provider_message_id,author_display_name,source_markdown,sent_at,ordinal&order=ordinal.asc`);
  const document = documents[0];
  return json({
    id: documentId,
    draft: version,
    sourceContent: sourceContentForClient(documentId, version.id, sourceContentFromEvidenceMap(version.evidence_map)),
    sourceMessages: messages,
    organizationWide: document
      ? defaultReviewOrganizationWide(document.organization_wide, Boolean(document.current_published_version_id))
      : true,
  });
}

function cleanDraftText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function cleanDraftList(value: unknown, maximumItems: number, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const cleaned = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return cleaned.every((item) => item.length <= maximumLength) ? cleaned : null;
}

async function reviseReviewDraft(request: Request, env: Env, documentId: string): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!hasReviewAccess(session.teamRoles)) return json({ code: "FORBIDDEN" }, 403);
  if (!(await authorizedDocumentIds(env, session, "review")).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "JSON_REQUIRED" }, 415);
  const body = await request.json() as Record<string, unknown>;
  const title = cleanDraftText(body.title, 240); const problem = cleanDraftText(body.problem, 4000); const summary = cleanDraftText(body.summary, 8000);
  const steps = cleanDraftList(body.steps, 30, 2000); const warnings = cleanDraftList(body.warnings, 20, 2000);
  if (!title || !problem || !summary || !steps || !warnings) return json({ code: "INVALID_DRAFT", message: "Complete the title, problem, summary, and valid action fields." }, 400);
  const versionId = await supabaseRequest<string>(env, "rpc/revise_document_draft", {
    method: "POST", body: JSON.stringify({ p_document_id: documentId, p_user_id: session.appUserId, p_title: title, p_problem: problem, p_summary: summary, p_steps: steps, p_warnings: warnings }),
  });
  return json({ ok: true, versionId });
}

async function moderateReview(request: Request, env: Env, documentId: string, action: "approve" | "reject"): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!hasReviewAccess(session.teamRoles)) return json({ code: "FORBIDDEN" }, 403);
  if (!(await authorizedDocumentIds(env, session, "review")).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  const body = request.headers.get("content-type")?.startsWith("application/json") ? await request.json() as { label?: unknown; organizationWide?: unknown } : {};
  const label = action === "approve" && (body.label === "verified" || body.label === "unresolved") ? body.label : null;
  if (action === "approve" && !label) return json({ code: "LABEL_REQUIRED" }, 400);
  await supabaseRequest<void>(env, "rpc/moderate_document_with_visibility", { method: "POST", body: JSON.stringify({ p_document_id: documentId, p_user_id: session.appUserId, p_action: action, p_label: label, p_organization_wide: organizationWideFromReview(body.organizationWide) }) });
  if (action === "approve") await enqueueKnowledgeIndex(env, documentId);
  return json({ ok: true });
}

interface KnowledgeFlag { id: string; document_id: string; reason: string; status: string; created_at: string; decision_reason: string | null }
async function getKnowledgeFlags(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  const ids = await authorizedDocumentIds(env, session, "revise");
  if (!ids.length) return json({ items: [] });
  try {
    const flags = await supabaseRequest<KnowledgeFlag[]>(env, `document_change_requests?document_id=${inFilter(ids)}&status=eq.pending&select=id,document_id,reason,status,created_at,decision_reason&order=created_at.asc`);
    const documentIds = [...new Set(flags.map((flag) => flag.document_id))];
    const documents = documentIds.length ? await supabaseRequest<Array<{ id: string; current_published_version_id: string }>>(env, `documents?id=${inFilter(documentIds)}&workflow_state=eq.published&select=id,current_published_version_id`) : [];
    const versionIds = documents.map((document) => document.current_published_version_id).filter(Boolean);
    const versions = versionIds.length ? await supabaseRequest<Array<{ id: string; title: string }>>(env, `document_versions?id=${inFilter(versionIds)}&select=id,title`) : [];
    return json({ items: flags.filter((flag) => documents.some((document) => document.id === flag.document_id)).map((flag) => ({ ...flag, title: versions.find((version) => version.id === documents.find((document) => document.id === flag.document_id)?.current_published_version_id)?.title || "Published document" })) });
  } catch { return json({ message: "Knowledge lifecycle controls are unavailable until the database migration is installed." }, 503); }
}
async function knowledgeLifecycle(request: Request, env: Env, documentId: string): Promise<Response> {
  if (request.method !== "GET" && !isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  const [readIds, reviseIds] = await Promise.all([authorizedDocumentIds(env, session), authorizedDocumentIds(env, session, "revise")]);
  if (!readIds.includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "JSON_REQUIRED" }, 415);
    return mutateKnowledgeLifecycle(request, documentId, { userId: session.appUserId, readIds, reviseIds, db: <T>(path: string, init?: RequestInit) => supabaseRequest<T>(env, path, init) });
  }
  try {
    const documents = await supabaseRequest<Array<{ lifecycle_reason: string | null; lifecycle_changed_at: string | null; replacement_document_id: string | null }>>(env, `documents?id=eq.${documentId}&workflow_state=eq.published&current_published_version_id=not.is.null&select=lifecycle_reason,lifecycle_changed_at,replacement_document_id&limit=1`);
    if (!documents[0]) return json({ code: "NOT_FOUND" }, 404);
    const flags = await supabaseRequest<KnowledgeFlag[]>(env, `document_change_requests?document_id=eq.${documentId}${reviseIds.includes(documentId) ? "" : `&requested_by_user_id=eq.${session.appUserId}`}&select=id,document_id,reason,status,created_at,decision_reason&order=created_at.desc`);
    const replacementId = documents[0].replacement_document_id;
    const replacements = replacementId && readIds.includes(replacementId) ? await supabaseRequest<Array<{ id: string }>>(env, `documents?id=eq.${replacementId}&workflow_state=eq.published&knowledge_label=in.(verified,unresolved)&select=id`) : [];
    return json({ reason: documents[0].lifecycle_reason, changedAt: documents[0].lifecycle_changed_at, replacementId: replacements[0]?.id || null, flags });
  } catch { return json({ message: "Knowledge lifecycle controls are unavailable until the database migration is installed." }, 503); }
}

async function getLibrary(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  const ids = await authorizedDocumentIds(env, session);
  if (ids.length === 0) return json({ items: [], favoriteIds: [] });
  const documents = await supabaseRequest<Array<{ id: string; source_space_id: string; knowledge_label: string; current_published_version_id: string; transcript_visible_to_basic: boolean; organization_wide: boolean; originally_approved_by_user_id: string | null; last_updated_by_user_id: string | null; updated_at: string }>>(env,
    `documents?id=${inFilter(ids)}&workflow_state=eq.published&current_published_version_id=not.is.null${libraryLifecycleFilter(new URL(request.url).searchParams.get("includeHistorical") === "true")}&select=id,source_space_id,knowledge_label,current_published_version_id,transcript_visible_to_basic,organization_wide,originally_approved_by_user_id,last_updated_by_user_id,updated_at&order=updated_at.desc`);
  if (documents.length === 0) return json({ items: [], favoriteIds: [] });
  const attributionIds = [...new Set(documents.flatMap(({ originally_approved_by_user_id, last_updated_by_user_id }) => [originally_approved_by_user_id, last_updated_by_user_id]).filter((id): id is string => Boolean(id)))];
  const [versions, spaces, favorites, attributionUsers] = await Promise.all([
    supabaseRequest<Array<{ id: string; title: string; summary: string }>>(env, `document_versions?id=${inFilter(documents.map(({ current_published_version_id }) => current_published_version_id))}&select=id,title,summary`),
    supabaseRequest<Array<{ id: string; display_name: string }>>(env, `source_spaces?id=${inFilter([...new Set(documents.map(({ source_space_id }) => source_space_id))])}&select=id,display_name`),
    supabaseRequest<Array<{ document_id: string }>>(env, `favorites?user_id=eq.${session.appUserId}&document_id=${inFilter(documents.map(({ id }) => id))}&select=document_id`),
    attributionIds.length ? supabaseRequest<Array<{ id: string; display_name: string }>>(env, `users?id=${inFilter(attributionIds)}&select=id,display_name`) : Promise.resolve([]),
  ]);
  return json({ favoriteIds: favorites.map(({ document_id }) => document_id), items: documents.map((document) => {
    const version = versions.find(({ id }) => id === document.current_published_version_id);
    return { id: document.id, title: version?.title || "Untitled", summary: version?.summary || "", workflowState: "published", label: document.knowledge_label,
      sourceSpace: spaces.find(({ id }) => id === document.source_space_id)?.display_name || "Webex space", teamNames: session.teamRoles?.map(({ teamName }) => teamName) || [], categories: [], updatedAt: document.updated_at, transcriptVisible: document.transcript_visible_to_basic, organizationWide: document.organization_wide,
      originallyApprovedBy: attributionUsers.find(({ id }) => id === document.originally_approved_by_user_id)?.display_name || null,
      lastUpdatedBy: attributionUsers.find(({ id }) => id === document.last_updated_by_user_id)?.display_name || null };
  }) });
}

interface KnowledgeIndexJob {
  document_version_id: string;
  organization_id: string;
  document_id: string;
  claim_started_at: string;
}

function vectorRagEnabled(env: Env): boolean {
  return env.RAG_VECTOR_ENABLED?.trim().toLowerCase() === "true" && embeddingConfigured(env);
}

function canRunRagBackfill(env: Env, email: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized && env.RAG_BACKFILL_ADMIN_EMAILS?.split(",").some((value) => value.trim().toLowerCase() === normalized));
}

async function processKnowledgeIndexJob(env: Env, job: KnowledgeIndexJob): Promise<void> {
  try {
    const versions = await supabaseRequest<Array<{ id: string; document_id: string; title: string; problem: string; summary: string; steps: string[]; warnings: string[]; evidence_map: unknown }>>(env,
      `document_versions?id=eq.${job.document_version_id}&document_id=eq.${job.document_id}&select=id,document_id,title,problem,summary,steps,warnings,evidence_map&limit=1`);
    const version = versions[0];
    if (!version) throw new Error("VERSION_NOT_FOUND");
    const chunks = buildKnowledgeChunks({
      title: version.title, problem: version.problem, summary: version.summary,
      steps: version.steps, warnings: version.warnings,
      sourceContent: sourceContentFromEvidenceMap(version.evidence_map),
    });
    const model = embeddingModel(env);
    await indexKnowledgeVersion(<T>(path: string, init?: RequestInit) => supabaseRequest<T>(env, path, init), {
      organizationId: job.organization_id,
      documentId: job.document_id,
      documentVersionId: job.document_version_id,
      claimStartedAt: job.claim_started_at,
      embeddingProvider: embeddingProvider(env),
      embeddingModel: model,
      chunks,
      embed: (text) => createEmbedding({ env, text, purpose: "document" }),
    });
  } catch (error) {
    const code = error instanceof EmbeddingProviderError ? `EMBEDDING_${error.status}` : "INDEXING_FAILED";
    console.error("Knowledge indexing failed", { documentId: job.document_id, versionId: job.document_version_id, code });
    const claimFilter = `knowledge_index_jobs?document_version_id=eq.${job.document_version_id}&status=eq.processing&started_at=eq.${encodeURIComponent(job.claim_started_at)}`;
    await supabaseRequest<void>(env, claimFilter, {
      method: "PATCH", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", last_error_code: code, next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(), completed_at: null }),
    }).catch(() => undefined);
  }
}

async function processKnowledgeIndexQueue(env: Env): Promise<void> {
  if (!vectorRagEnabled(env)) return;
  const jobs = await supabaseRequest<KnowledgeIndexJob[]>(env, "rpc/claim_knowledge_index_jobs", { method: "POST", body: JSON.stringify({ p_limit: 1 }) });
  for (const job of jobs) await processKnowledgeIndexJob(env, job);
}

async function enqueueKnowledgeIndex(env: Env, documentId: string): Promise<void> {
  if (!vectorRagEnabled(env)) return;
  try {
    await supabaseRequest<string | null>(env, "rpc/enqueue_knowledge_index", { method: "POST", body: JSON.stringify({ p_document_id: documentId }) });
  } catch (error) {
    console.error("Knowledge indexing could not be queued", { documentId, code: "INDEX_QUEUE_UNAVAILABLE" }, error);
  }
}

async function backfillKnowledgeIndexes(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.organizationId || !canRunRagBackfill(env, session.email)) return json({ code: "DEVELOPER_REQUIRED" }, 403);
  if (!vectorRagEnabled(env)) return json({ code: "RAG_NOT_CONFIGURED", message: "Vector retrieval is not configured." }, 503);
  const queued = await supabaseRequest<number>(env, "rpc/enqueue_current_knowledge_indexes", { method: "POST", body: JSON.stringify({ p_organization_id: session.organizationId }) });
  return json({ ok: true, queued }, 202);
}

async function chatKnowledge(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN", message: "Request origin was not accepted." }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "JSON_REQUIRED" }, 415);
  const body = await request.json().catch(() => null) as { message?: unknown; history?: unknown } | null;
  const question = chatQuestion(body?.message);
  if (!question) return json({ code: "INVALID_MESSAGE", message: "Ask a question between 2 and 4,000 characters." }, 400);
  const history = chatHistory(body?.history);
  const retrievalQuery = buildRetrievalQuery(question, history);
  const documentIds = await authorizedDocumentIds(env, session);
  if (documentIds.length === 0) return json({ answer: "I could not find published knowledge available to you.", citations: [], sources: [] });
  const documents = await supabaseRequest<Array<{ id: string; current_published_version_id: string; transcript_visible_to_basic: boolean }>>(env,
    `documents?id=${inFilter(documentIds)}&workflow_state=eq.published&current_published_version_id=not.is.null${libraryLifecycleFilter(false)}&select=id,current_published_version_id,transcript_visible_to_basic`);
  if (documents.length === 0) return json({ answer: "I could not find published knowledge available to you.", citations: [], sources: [] });
  const versions = await supabaseRequest<Array<{ id: string; document_id: string; source_snapshot_id: string; title: string; summary: string; problem: string; steps: string[]; warnings: string[]; evidence_map: unknown }>>(env,
    `document_versions?id=${inFilter(documents.map(({ current_published_version_id }) => current_published_version_id))}&select=id,document_id,source_snapshot_id,title,summary,problem,steps,warnings,evidence_map`);
  const staff = hasReviewAccess(session.teamRoles);
  const visibleSnapshotIds = versions.filter((version) => {
    const document = documents.find(({ current_published_version_id }) => current_published_version_id === version.id);
    return document && (staff || document.transcript_visible_to_basic);
  }).map(({ source_snapshot_id }) => source_snapshot_id);
  const sourceMessages = visibleSnapshotIds.length
    ? await supabaseRequest<Array<{ source_snapshot_id: string; source_markdown: string; ordinal: number }>>(env,
      `source_messages?source_snapshot_id=${inFilter(visibleSnapshotIds)}&select=source_snapshot_id,source_markdown,ordinal&order=ordinal.asc&limit=500`)
    : [];
  const records: KnowledgeRecord[] = documents.map((document) => {
    const version = versions.find(({ id }) => id === document.current_published_version_id);
    const transcript = version ? sourceMessages.filter(({ source_snapshot_id }) => source_snapshot_id === version.source_snapshot_id).map(({ source_markdown }) => source_markdown).join("\n") : "";
    const presentation = sourceContentText(sourceContentFromEvidenceMap(version?.evidence_map));
    return { id: document.id, title: version?.title || "Untitled knowledge", summary: version?.summary || "", problem: version?.problem || "", steps: version?.steps || [], warnings: version?.warnings || [], sourceText: [presentation, transcript].filter(Boolean).join("\n").slice(0, 12000) };
  });
  const lexicalRanked = rankKnowledge(retrievalQuery, records);
  let vectorRanked: ReturnType<typeof rankKnowledge> = [];
  if (vectorRagEnabled(env) && session.organizationId) {
    try {
      const queryEmbedding = await createEmbedding({ env, text: retrievalQuery, purpose: "query" });
      const matches = await retrieveKnowledgeChunks(<T>(path: string, init?: RequestInit) => supabaseRequest<T>(env, path, init), {
        organizationId: session.organizationId, userId: session.appUserId, embedding: queryEmbedding, embeddingModel: embeddingModel(env),
      });
      const byDocument = new Map<string, typeof matches>();
      for (const match of matches) byDocument.set(match.document_id, [...(byDocument.get(match.document_id) || []), match]);
      vectorRanked = [...byDocument.entries()].flatMap(([documentId, chunks]) => {
        const record = records.find(({ id }) => id === documentId);
        if (!record) return [];
        return [{ ...record, sourceText: chunks.map(({ content }) => content).join("\n\n"), score: Math.max(...chunks.map(({ similarity }) => similarity)) * 100 }];
      }).sort((left, right) => right.score - left.score);
    } catch (error) {
      console.warn("Vector retrieval unavailable; using lexical fallback", error instanceof EmbeddingProviderError ? error.status : "SEARCH_FAILED");
    }
  }
  const ranked = mergeRankedKnowledge(vectorRanked, lexicalRanked);
  if (ranked.length === 0) return json({ answer: "I could not find a matching answer in the published knowledge base.", citations: [], sources: [] });
  if (!llmConfigured(env)) return json({ code: "LLM_UNAVAILABLE", message: "Knowledge chat is temporarily unavailable." }, 503);
  const sourceCount = ranked.length;
  const sanitizedQuestion = redactForLlm(question).sanitizedText;
  let parsed: { answer: string; citations: number[] } | null = null;
  try {
    const output = await requestLlmJson({
      env,
      systemPrompt: "Answer the current question using only the supplied published knowledge. Use earlier conversation only to understand references in the current question; earlier assistant statements are not authoritative. If the published knowledge does not answer the question, say so. Do not invent facts. Cite supporting source numbers in the citations array.",
      parts: [{ text: `Recent conversation:\n${buildConversationContext(history)}\n\nCurrent question:\n${sanitizedQuestion}\n\nPublished knowledge:\n${buildKnowledgeContext(ranked)}` }],
      schema: { type: "object", required: ["answer", "citations"], properties: { answer: { type: "string" }, citations: { type: "array", items: { type: "integer" } } } },
    });
    parsed = parseChatResponse(output, sourceCount);
  } catch { parsed = null; }
  if (!parsed) return json({ code: "LLM_INVALID_RESPONSE", message: "Knowledge chat returned an invalid answer." }, 502);
  return json({ answer: parsed.answer, citations: parsed.citations.map((index) => `S${index}`), sources: parsed.citations.map((index) => ({ id: ranked[index - 1].id, title: ranked[index - 1].title })) });
}

async function getLibraryDetail(request: Request, env: Env, documentId: string): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!(await authorizedDocumentIds(env, session)).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  const documents = await supabaseRequest<Array<{ id: string; source_space_id: string; review_team_id: string; knowledge_label: string; current_published_version_id: string; transcript_visible_to_basic: boolean; organization_wide: boolean; originally_approved_by_user_id: string | null; last_updated_by_user_id: string | null; updated_at: string }>>(env,
    `documents?id=eq.${documentId}&workflow_state=eq.published&current_published_version_id=not.is.null&select=id,source_space_id,review_team_id,knowledge_label,current_published_version_id,transcript_visible_to_basic,organization_wide,originally_approved_by_user_id,last_updated_by_user_id,updated_at&limit=1`);
  const document = documents[0]; if (!document) return json({ code: "NOT_FOUND" }, 404);
  const attributionIds = [document.originally_approved_by_user_id, document.last_updated_by_user_id].filter((id): id is string => Boolean(id));
  const [versions, spaces, attributionUsers] = await Promise.all([
    supabaseRequest<Array<{ id: string; source_snapshot_id: string; title: string; problem: string; summary: string; steps: string[]; warnings: string[]; evidence_map: unknown; version_number: number }>>(env,
      `document_versions?id=eq.${document.current_published_version_id}&select=id,source_snapshot_id,title,problem,summary,steps,warnings,evidence_map,version_number&limit=1`),
    supabaseRequest<Array<{ display_name: string }>>(env, `source_spaces?id=eq.${document.source_space_id}&select=display_name&limit=1`),
    attributionIds.length ? supabaseRequest<Array<{ id: string; display_name: string }>>(env, `users?id=${inFilter(attributionIds)}&select=id,display_name`) : Promise.resolve([]),
  ]);
  const version = versions[0]; if (!version) return json({ code: "NOT_FOUND" }, 404);
  const staff = session.teamRoles?.some(({ role }) => role === "moderator" || role === "admin") || false;
  const transcriptVisible = document.transcript_visible_to_basic || staff;
  const sourceMessages = transcriptVisible ? await supabaseRequest<Array<{ provider_message_id: string; author_display_name: string; source_markdown: string; sent_at: string; ordinal: number }>>(env,
    `source_messages?source_snapshot_id=eq.${version.source_snapshot_id}&select=provider_message_id,author_display_name,source_markdown,sent_at,ordinal&order=ordinal.asc`) : [];
  const canManage = staff && (await authorizedDocumentIds(env, session, "revise")).includes(documentId);
  const canManageVisibility = session.teamRoles?.some(({ teamId, role }) => teamId === document.review_team_id && (role === "moderator" || role === "admin")) || false;
  return json({ id: document.id, label: document.knowledge_label, sourceSpace: spaces[0]?.display_name || "Webex space", updatedAt: document.updated_at, transcriptVisible, canManage, canManageVisibility, organizationWide: document.organization_wide,
    originallyApprovedBy: attributionUsers.find(({ id }) => id === document.originally_approved_by_user_id)?.display_name || null,
    lastUpdatedBy: attributionUsers.find(({ id }) => id === document.last_updated_by_user_id)?.display_name || null,
    draft: version, sourceContent: sourceContentForClient(documentId, version.id, sourceContentFromEvidenceMap(version.evidence_map)), sourceMessages });
}

async function revisePublishedDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!(await authorizedDocumentIds(env, session, "revise")).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "JSON_REQUIRED" }, 415);
  const body = await request.json() as Record<string, unknown>;
  const title = cleanDraftText(body.title, 240); const problem = cleanDraftText(body.problem, 4000); const summary = cleanDraftText(body.summary, 8000);
  const steps = cleanDraftList(body.steps, 30, 2000); const warnings = cleanDraftList(body.warnings, 20, 2000);
  const label = body.label === "verified" || body.label === "unresolved" ? body.label : null;
  if (!title || !problem || !summary || !steps || !warnings || !label) return json({ code: "INVALID_DOCUMENT", message: "Complete the content and choose a supported status." }, 400);
  const documents = await supabaseRequest<Array<{ knowledge_label: string }>>(env, `documents?id=eq.${documentId}&select=knowledge_label&limit=1`);
  if (!isCurrentKnowledge(documents[0]?.knowledge_label)) return json({ message: "Historical guidance cannot be edited back into current knowledge. Publish a reviewed replacement." }, 409);
  const versionId = await supabaseRequest<string>(env, "rpc/revise_published_document", {
    method: "POST", body: JSON.stringify({ p_document_id: documentId, p_user_id: session.appUserId, p_title: title, p_problem: problem, p_summary: summary, p_steps: steps, p_warnings: warnings }),
  });
  if (documents[0]?.knowledge_label !== label) {
    await supabaseRequest<void>(env, `documents?id=eq.${documentId}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ knowledge_label: label, updated_at: new Date().toISOString() }) });
    await supabaseRequest<void>(env, "audit_events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ organization_id: session.organizationId, actor_user_id: session.appUserId, action: "knowledge_label_updated", target_type: "document", target_id: documentId, metadata: { knowledge_label: label, version_id: versionId } }) });
  }
  await enqueueKnowledgeIndex(env, documentId);
  return json({ ok: true, versionId });
}

async function archivePublishedDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!(await authorizedDocumentIds(env, session, "revise")).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  await supabaseRequest<void>(env, "rpc/archive_published_document", { method: "POST", body: JSON.stringify({ p_document_id: documentId, p_user_id: session.appUserId }) });
  return json({ ok: true });
}

async function getTeamMembers(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.organizationId) return json({ code: "UNAUTHENTICATED" }, 401);
  const team = session.teamRoles?.find(({ role }) => role === "admin");
  if (!team) return json({ code: "ADMIN_REQUIRED" }, 403);
  const users = await supabaseRequest<Array<{ id: string; display_name: string; email: string; status: AccountStatus; last_signed_in_at: string | null }>>(env,
    `users?organization_id=eq.${session.organizationId}&select=id,display_name,email,status,last_signed_in_at&order=display_name.asc`);
  const memberships = users.length ? await supabaseRequest<Array<{ user_id: string; role: TeamRole }>>(env,
    `team_memberships?team_id=eq.${team.teamId}&user_id=${inFilter(users.map(({ id }) => id))}&select=user_id,role`) : [];
  return json({ team: { id: team.teamId, name: team.teamName }, currentUserId: session.appUserId, items: users.map((user) => ({
    id: user.id, displayName: user.display_name, email: user.email, status: user.status, lastSignedInAt: user.last_signed_in_at,
    role: memberships.find(({ user_id }) => user_id === user.id)?.role || null,
  })) });
}

async function setTeamMemberRole(request: Request, env: Env, teamId: string, userId: string): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId || !session.teamRoles?.some(({ teamId: id, role }) => id === teamId && role === "admin")) return json({ code: "ADMIN_REQUIRED" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ code: "JSON_REQUIRED" }, 415);
  const body = await request.json() as { role?: unknown };
  if (body.role !== "basic" && body.role !== "moderator" && body.role !== "admin") return json({ code: "INVALID_ROLE" }, 400);
  await supabaseRequest<void>(env, "rpc/set_team_member_role", { method: "POST", body: JSON.stringify({ p_team_id: teamId, p_target_user_id: userId, p_actor_user_id: session.appUserId, p_role: body.role }) });
  return json({ ok: true, role: body.role });
}

async function removeTeamMember(request: Request, env: Env, teamId: string, userId: string): Promise<Response> {
  const auth = await requireAdminMutation(request, env, teamId); if (auth instanceof Response) return auth;
  await supabaseRequest<void>(env, "rpc/remove_team_member", { method: "POST", body: JSON.stringify({ p_team_id: teamId, p_target_user_id: userId, p_actor_user_id: auth.session.appUserId }) });
  return json({ ok: true });
}

async function setOrganizationVisibility(request: Request, env: Env, documentId: string): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  const body = await request.json() as { visible?: unknown };
  await supabaseRequest<void>(env, "rpc/set_document_organization_visibility", { method: "POST", body: JSON.stringify({ p_document_id: documentId, p_actor_user_id: session.appUserId, p_visible: body.visible === true }) });
  return json({ ok: true });
}

async function setFavorite(request: Request, env: Env, documentId: string, enabled: boolean): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN" }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED" }, 401);
  if (!(await authorizedDocumentIds(env, session)).includes(documentId)) return json({ code: "NOT_FOUND" }, 404);
  if (enabled) await supabaseRequest<void>(env, "favorites?on_conflict=user_id,document_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: session.appUserId, document_id: documentId }) });
  else await supabaseRequest<void>(env, `favorites?user_id=eq.${session.appUserId}&document_id=eq.${documentId}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  return json({ ok: true });
}

async function getWebexRooms(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return json({ code: "UNAUTHENTICATED", message: "Sign in with Webex." }, 401);
  return webexJson("rooms?max=50&sortBy=lastactivity", session);
}

async function getWebexMessages(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return json({ code: "UNAUTHENTICATED", message: "Sign in with Webex." }, 401);
  const roomId = new URL(request.url).searchParams.get("roomId")?.trim();
  if (!roomId || roomId.length > 512) return json({ code: "INVALID_ROOM", message: "A valid Webex room is required." }, 400);
  return webexJson(`messages?roomId=${encodeURIComponent(roomId)}&max=50`, session);
}

async function submitSopReview(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return json({ code: "INVALID_ORIGIN", message: "Request origin was not accepted." }, 403);
  const session = await readSession(request, env);
  if (!session?.appUserId) return json({ code: "UNAUTHENTICATED", message: "Sign in again before submitting an SOP." }, 401);
  if (session.accountStatus !== "active" || !session.teamRoles?.some(({ role }) => role === "moderator" || role === "admin")) {
    return json({ code: "MODERATOR_REQUIRED", message: "An active Moderator or Admin role is required." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ code: "INVALID_CONTENT_TYPE", message: "JSON is required." }, 415);
  if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024) return json({ code: "INVALID_SOP_SUBMISSION", message: "The SOP submission is too large." }, 400);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ code: "INVALID_SOP_SUBMISSION", message: "The SOP submission was not valid JSON." }, 400); }
  const payload = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : raw;
  let submission: ReturnType<typeof validateSopSubmission>;
  try { submission = validateSopSubmission(payload); } catch { return json({ code: "INVALID_SOP_SUBMISSION", message: "The generated SOP could not be validated." }, 400); }
  if (!session.teamRoles.some(({ teamId, role }) => teamId === submission.teamId && (role === "moderator" || role === "admin"))) {
    return json({ code: "TEAM_ACCESS_REQUIRED", message: "You must be a Moderator or Admin in the selected team." }, 403);
  }
  const organizationId = session.organizationId;
  if (!organizationId) return json({ code: "ACCOUNT_NOT_FOUND", message: "The TDS account could not be resolved." }, 403);
  const assetKeys: string[] = [];
  try {
    const assetKeyByBlock = new Map<string, string>();
    const assetGroup = crypto.randomUUID();
    for (const asset of submission.imageAssets) {
      const extension = asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/webp" ? "webp" : "jpg";
      const safeBlockId = asset.blockId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const key = `${organizationId}/${assetGroup}/${safeBlockId}.${extension}`;
      await uploadSopAsset(env, key, asset.mimeType, asset.data);
      assetKeys.push(key);
      assetKeyByBlock.set(asset.blockId, key);
    }
    const sourceContent = submission.sourceContent ? { ...submission.sourceContent, blocks: submission.sourceContent.blocks.map((block) => ({ ...block, assetKey: assetKeyByBlock.get(block.id) })) } : undefined;
    const result = await supabaseRequest<{ documentId: string; versionId: string; status: string }>(env, "rpc/submit_sop_review", {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_user_id: session.appUserId,
        p_team_id: submission.teamId,
        p_source_space_provider_id: submission.sourceSpaceProviderId,
        p_source_provider_id: submission.sourceProviderId,
        p_source_name: `SOP upload: ${submission.draft.title}`,
        p_source_markdown: submission.sourceMarkdown,
        p_source_content: sourceContent,
        p_generated_at: submission.generatedAt,
        p_title: submission.draft.title,
        p_problem: submission.draft.summary,
        p_summary: submission.draft.summary,
        p_steps: storageSteps(submission),
        p_warnings: [...submission.draft.warnings, ...submission.draft.openQuestions.map((item) => `Open question: ${item}`)],
      }),
    });
    return json(result, 201);
  } catch (error) {
    await removeSopAssets(env, assetKeys);
    console.error("SOP review submission failed", error instanceof Error ? error.message : "Unknown error");
    if (error instanceof Error && error.message.includes("status 404")) {
      return json({ code: "DATABASE_MIGRATION_REQUIRED", message: "SOP review storage is not installed in this Supabase project. Apply migrations 202609210018 and 202609210019, then submit this draft again." }, 503);
    }
    return json({ code: "SUBMISSION_FAILED", message: "The SOP could not be submitted for review." }, 502);
  }
}

async function handleApi(request: Request, env: Env, waitUntil: (promise: Promise<unknown>) => void): Promise<Response> {
  const { pathname } = new URL(request.url);
  if ((request.method === "GET" && pathname === "/api/sops/config") || (request.method === "POST" && pathname === "/api/sops/generate")) return handleSopRequest(request, env, () => readSession(request, env));
  if (request.method === "POST" && pathname === "/api/sops/submit-review") return submitSopReview(request, env);
  if (request.method === "GET" && pathname === "/api/health") return json({
    status: "ok",
    integrations: integrationStatus(env),
    configurationPresence: {
      supabaseUrl: Boolean(env.SUPABASE_URL?.trim()),
      supabaseServerKey: Boolean(supabaseSecret(env)),
    },
  });
  if (request.method === "GET" && pathname === "/api/config") return json({ botName: env.WEBEX_BOT_NAME?.trim() || "TDS" });
  if (request.method === "GET" && pathname === "/api/auth/webex/start") return startOAuth(request, env);
  if (request.method === "GET" && pathname === "/api/auth/webex/callback") return finishOAuth(request, env);
  if (request.method === "GET" && pathname === "/api/auth/session") return getSession(request, env);
  if (request.method === "POST" && pathname === "/api/admin-setup/context") return establishAdminSetupContext(request, env);
  if (request.method === "GET" && pathname === "/api/admin-setup/invitation") return readAdminSetupInvitation(request, env);
  if (request.method === "POST" && pathname === "/api/admin-setup/complete") return completeAdminSetupInvitation(request, env);
  if (request.method === "GET" && pathname === "/api/webex/rooms") return getWebexRooms(request, env);
  if (request.method === "GET" && pathname === "/api/webex/messages") return getWebexMessages(request, env);
  if (request.method === "POST" && pathname === "/api/captures/webex") return captureWebexThread(request, env);
  if (request.method === "POST" && pathname === "/api/webhooks/webex") return receiveWebexWebhook(request, env, waitUntil);
  if (request.method === "POST" && pathname === "/api/admin/webex/webhook") return configureWebexWebhook(request, env);
  if (request.method === "GET" && pathname === "/api/admin/integrations") return getIntegrationSettings(request, env);
  if (request.method === "GET" && pathname === "/api/admin/settings") return getAdminSettings(request, env);
  if (request.method === "GET" && pathname === "/api/admin/settings/rooms") return getAdminSettingsRooms(request, env);
  if (request.method === "POST" && pathname === "/api/admin/team-admin-invitations") return createAdminSetupInvitation(request, env);
  if (request.method === "POST" && pathname === "/api/admin/teams") return createTeam(request, env);
  if (request.method === "POST" && pathname === "/api/admin/space-grants") return createSpaceGrant(request, env);
  if (request.method === "POST" && pathname === "/api/admin/access-requests") return createAccessRequest(request, env);
  if (request.method === "GET" && pathname === "/api/admin/initial-setup") return getInitialSetup(request, env);
  if (request.method === "POST" && pathname === "/api/admin/initial-setup") return completeInitialSetup(request, env);
  if (request.method === "GET" && pathname === "/api/admin/team-members") return getTeamMembers(request, env);
  if (request.method === "GET" && pathname === "/api/reviews") return getReviewQueue(request, env);
  if (request.method === "GET" && pathname === "/api/processing-issues") return getProcessingIssues(request, env);
  if (request.method === "GET" && pathname === "/api/library") return getLibrary(request, env);
  if (request.method === "POST" && pathname === "/api/knowledge-chat") return chatKnowledge(request, env);
  if (request.method === "POST" && pathname === "/api/admin/rag/backfill") return backfillKnowledgeIndexes(request, env);
  const sopAssetMatch = pathname.match(/^\/api\/sop-assets\/([0-9a-f-]+)\/([0-9a-f-]+)\/([^/]+)$/i);
  if (request.method === "GET" && sopAssetMatch) return getSopAsset(request, env, sopAssetMatch[1], sopAssetMatch[2], decodeURIComponent(sopAssetMatch[3]));
  const reviewMatch = pathname.match(/^\/api\/reviews\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && reviewMatch) return getReviewDetail(request, env, reviewMatch[1]);
  if (request.method === "PATCH" && reviewMatch) return reviseReviewDraft(request, env, reviewMatch[1]);
  const moderationMatch = pathname.match(/^\/api\/reviews\/([0-9a-f-]+)\/(approve|reject)$/i);
  if (request.method === "POST" && moderationMatch) return moderateReview(request, env, moderationMatch[1], moderationMatch[2] as "approve" | "reject");
  const favoriteMatch = pathname.match(/^\/api\/favorites\/([0-9a-f-]+)$/i);
  if ((request.method === "PUT" || request.method === "DELETE") && favoriteMatch) return setFavorite(request, env, favoriteMatch[1], request.method === "PUT");
  if (request.method === "GET" && pathname === "/api/library/flags") return getKnowledgeFlags(request, env);
  const lifecycleMatch = pathname.match(/^\/api\/library\/([0-9a-f-]+)\/lifecycle$/i);
  if ((request.method === "GET" || request.method === "POST") && lifecycleMatch) return knowledgeLifecycle(request, env, lifecycleMatch[1]);
  const libraryMatch = pathname.match(/^\/api\/library\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && libraryMatch) return getLibraryDetail(request, env, libraryMatch[1]);
  if (request.method === "PATCH" && libraryMatch) return revisePublishedDocument(request, env, libraryMatch[1]);
  if (request.method === "DELETE" && libraryMatch) return archivePublishedDocument(request, env, libraryMatch[1]);
  const visibilityMatch = pathname.match(/^\/api\/library\/([0-9a-f-]+)\/organization-visibility$/i);
  if (request.method === "PATCH" && visibilityMatch) return setOrganizationVisibility(request, env, visibilityMatch[1]);
  const teamMatch = pathname.match(/^\/api\/admin\/teams\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && teamMatch) return updateTeam(request, env, teamMatch[1]);
  const invitationCollectionMatch = pathname.match(/^\/api\/admin\/teams\/([0-9a-f-]+)\/invitations$/i);
  if (request.method === "POST" && invitationCollectionMatch) return createInvitations(request, env, invitationCollectionMatch[1]);
  const invitationMatch = pathname.match(/^\/api\/admin\/invitations\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && invitationMatch) return revokeInvitation(request, env, invitationMatch[1]);
  const adminSetupInvitationMatch = pathname.match(/^\/api\/admin\/team-admin-invitations\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && adminSetupInvitationMatch) return revokeAdminSetupInvitation(request, env, adminSetupInvitationMatch[1]);
  const teamSpaceMatch = pathname.match(/^\/api\/admin\/teams\/([0-9a-f-]+)\/spaces$/i);
  if (request.method === "PUT" && teamSpaceMatch) return configureTeamSpace(request, env, teamSpaceMatch[1]);
  const grantMatch = pathname.match(/^\/api\/admin\/space-grants\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && grantMatch) return revokeSpaceGrant(request, env, grantMatch[1]);
  const accessRequestMatch = pathname.match(/^\/api\/admin\/access-requests\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && accessRequestMatch) return decideAccessRequest(request, env, accessRequestMatch[1]);
  const teamMemberMatch = pathname.match(/^\/api\/admin\/team-members\/([0-9a-f-]+)\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && teamMemberMatch) return setTeamMemberRole(request, env, teamMemberMatch[1], teamMemberMatch[2]);
  if (request.method === "DELETE" && teamMemberMatch) return removeTeamMember(request, env, teamMemberMatch[1], teamMemberMatch[2]);
  if (request.method === "GET" && pathname === "/api/auth/logout") {
    const returnTo = new URL(request.url).searchParams.get("returnTo") === "/admin-setup" ? "/admin-setup" : "/";
    await revokeSessionFromRequest(request, env);
    return redirect(new URL(returnTo, appOrigin(request, env)).toString(), [clearCookie(sessionCookieName(env))]);
  }
  return json({ code: "NOT_FOUND", message: "API route not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    try {
      return await handleApi(request, env, (promise) => context.waitUntil(promise));
    } catch (error) {
      console.error("Unhandled API error", error);
      return json({ code: "INTERNAL_ERROR", message: "The request could not be completed." }, 500);
    }
  },
  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    context.waitUntil(processKnowledgeIndexQueue(env));
  },
};
