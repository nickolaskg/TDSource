import {
  Activity, Building2, CheckCircle2, ChevronDown, CircleAlert, Database, Link2,
  LoaderCircle, MessagesSquare, Plus, Share2, ShieldCheck, Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJsonCached, invalidateApiCache } from "../../lib/api-cache";
import { formatAuditGroupDate, groupAuditEventsByDate } from "./audit-groups";
import { canViewIntegrations } from "./settings-visibility";
import "../../styles/workflow.css";

type TeamRole = "basic" | "moderator" | "admin";
type SettingsSection = "profile" | "members" | "spaces" | "sharing" | "requests" | "integrations" | "audit";

interface Team { id: string; name: string; status: "active" | "archived"; archived_at: string | null }
interface Member { id: string; displayName: string; email: string; status: string; lastSignedInAt: string | null; role: TeamRole }
interface Invitation { id: string; email: string; role: TeamRole; status: "pending" | "revoked"; created_at: string }
interface AdminSetupInvitation { id: string; email: string; status: "pending" | "setup_started" | "completed" | "expired" | "revoked"; expires_at: string; created_at: string }
interface Room { id: string; title: string; sourceSpaceId: string | null; assigned: boolean; isDefault: boolean; canMakeDefault: boolean; defaultTeamId: string | null; defaultTeamName: string | null }
interface DirectoryTeam { id: string; name: string; spaces: Array<{ teamId: string; sourceSpaceId: string; name: string }> }
interface SpaceGrant { id: string; source_team_id: string; recipient_team_id: string; source_space_id: string; status: string; sourceTeamName: string; recipientTeamName: string; spaceName: string }
interface AccessRequest { id: string; requester_team_id: string; source_team_id: string; status: string; note: string; created_at: string; requesterTeamName: string; sourceTeamName: string; spaces: Array<{ id: string; name: string }> }
interface AuditEvent { id: string; action: string; target_type: string; occurred_at: string; actorName: string }
interface SettingsData {
  currentUserId: string; selectedTeamId: string; signInUrl: string; teams: Team[]; selectedTeam: Team;
  members: Member[]; availableUsers: Array<{ id: string; displayName: string; email: string; status: string }>; invitations: Invitation[]; adminSetupInvitations: AdminSetupInvitation[]; rooms: Room[]; directory: DirectoryTeam[];
  grants: SpaceGrant[]; requests: AccessRequest[]; audit: AuditEvent[]; webexRoomsAvailable: boolean | null; roomsLoaded: boolean;
}
interface SettingsRoomsData { rooms: Room[]; webexRoomsAvailable: boolean; roomsLoaded: true }
interface IntegrationSettings { integrations: Record<"webexOAuth" | "webexCapture" | "webhook" | "supabase" | "llm", boolean>; captureRoomCount: number; botName: string; redirectUri: string | null }

const sections: Array<{ id: SettingsSection; label: string; icon: typeof Users }> = [
  { id: "profile", label: "Team profile", icon: Building2 },
  { id: "members", label: "Members & invitations", icon: Users },
  { id: "spaces", label: "Webex spaces", icon: MessagesSquare },
  { id: "sharing", label: "Knowledge sharing", icon: Share2 },
  { id: "requests", label: "Access requests", icon: Link2 },
  { id: "integrations", label: "Integrations", icon: Database },
  { id: "audit", label: "Audit history", icon: Activity },
];

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET") return getJsonCached(path);
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const payload = await response.json().catch(() => ({})) as { message?: string; code?: string };
  if (!response.ok) throw new Error(payload.message || payload.code || "The request could not be completed.");
  invalidateApiCache("/api/admin/settings");
  invalidateApiCache("/api/admin/integrations");
  return payload;
}

function parseInvitees(value: string, role: "basic" | "moderator") {
  return [...new Set(value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))].map((email) => ({ email, role }));
}

export function SettingsPage({ userEmail }: { userEmail: string }) {
  const [params, setParams] = useSearchParams();
  const availableSections = canViewIntegrations(userEmail) ? sections : sections.filter(({ id }) => id !== "integrations");
  const section = (availableSections.some(({ id }) => id === params.get("section")) ? params.get("section") : "profile") as SettingsSection;
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const requestedTeamId = params.get("teamId") || "";
  const selectedTeamId = requestedTeamId || data?.selectedTeamId || "";

  const load = useCallback(async (teamId?: string) => {
    setLoading(true); setMessage("");
    try {
      const result = await api(`/api/admin/settings${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`) as SettingsData;
      setData((current) => current?.selectedTeamId === result.selectedTeamId && current.roomsLoaded
        ? { ...result, rooms: current.rooms, roomsLoaded: true, webexRoomsAvailable: current.webexRoomsAvailable }
        : result);
      setError(false);
    } catch (loadError) {
      setError(true); setMessage(loadError instanceof Error ? loadError.message : "Settings could not be loaded.");
    } finally { setLoading(false); }
  }, []);

  const loadRooms = useCallback(async (teamId: string) => {
    setRoomsLoading(true);
    try {
      const result = await api(`/api/admin/settings/rooms?teamId=${encodeURIComponent(teamId)}`) as SettingsRoomsData;
      setData((current) => current?.selectedTeamId === teamId ? { ...current, ...result } : current);
    } catch (loadError) {
      setError(true); setMessage(loadError instanceof Error ? loadError.message : "Webex spaces could not be loaded.");
    } finally { setRoomsLoading(false); }
  }, []);

  useEffect(() => {
    if (data && (!requestedTeamId || data.selectedTeamId === requestedTeamId)) return;
    void load(requestedTeamId || undefined);
  }, [data, load, requestedTeamId]);

  useEffect(() => {
    if (data && !data.roomsLoaded && (section === "spaces" || section === "sharing")) void loadRooms(data.selectedTeamId);
  }, [data, loadRooms, section]);

  const run = async (work: () => Promise<unknown>, success: string) => {
    setMessage(""); setError(false);
    try {
      const refreshRooms = data?.roomsLoaded === true;
      await work(); await load(selectedTeamId);
      if (refreshRooms) await loadRooms(selectedTeamId);
      setMessage(success);
    }
    catch (actionError) { setError(true); setMessage(actionError instanceof Error ? actionError.message : "The action failed."); }
  };

  const chooseSection = (next: SettingsSection) => setParams({ section: next, teamId: selectedTeamId });
  const chooseTeam = (teamId: string) => setParams({ section, teamId });

  if (loading && !data) return <div className="page"><div className="inline-status panel"><LoaderCircle className="spin" size={18} />Loading team settings…</div></div>;
  if (!data) return <div className="page"><div className="inline-status error panel">{message || "Settings are unavailable."}</div></div>;

  return (
    <div className="page settings-page">
      <header className="page-heading settings-heading">
        <div><span className="eyebrow">Team administration</span><h1>Settings</h1><p>Manage team membership, Webex spaces, shared knowledge, and access without exposing another team’s pending reviews.</p></div>
        <label className="team-picker"><span>Administering</span><select value={selectedTeamId} onChange={(event) => chooseTeam(event.target.value)}>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.status === "archived" ? " (inactive)" : ""}</option>)}</select></label>
      </header>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">{availableSections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} onClick={() => chooseSection(id)}><Icon size={17} />{label}</button>)}</nav>
        <section className="settings-content">
          {data.roomsLoaded && !data.webexRoomsAvailable && <p className="settings-message error" role="status">Live Webex space discovery is temporarily unavailable. Team settings remain available, but no spaces are shown until Webex confirms the rooms containing the TDS bot.</p>}
          {message && <p className={`settings-message ${error ? "error" : "success"}`} role="status">{message}</p>}
          {section === "profile" && <TeamProfile data={data} run={run} reload={() => load(selectedTeamId)} ensureRooms={() => loadRooms(selectedTeamId)} roomsLoading={roomsLoading} />}
          {section === "members" && <MembersSettings data={data} run={run} />}
          {section === "spaces" && (roomsLoading && !data.roomsLoaded ? <div className="inline-status panel"><LoaderCircle className="spin" size={18} />Loading Webex spaces…</div> : <SpaceSettings data={data} run={run} />)}
          {section === "sharing" && (roomsLoading && !data.roomsLoaded ? <div className="inline-status panel"><LoaderCircle className="spin" size={18} />Loading space access…</div> : <SharingSettings data={data} run={run} />)}
          {section === "requests" && <RequestSettings data={data} run={run} />}
          {section === "integrations" && <IntegrationSettingsPanel />}
          {section === "audit" && <AuditSettings data={data} />}
        </section>
      </div>
    </div>
  );
}

function TeamProfile({ data, run, reload, ensureRooms, roomsLoading }: { data: SettingsData; run: (work: () => Promise<unknown>, success: string) => Promise<void>; reload: () => Promise<void>; ensureRooms: () => Promise<void>; roomsLoading: boolean }) {
  const [name, setName] = useState(data.selectedTeam.name);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(""); const [newEmails, setNewEmails] = useState(""); const [newRole, setNewRole] = useState<"basic" | "moderator">("basic"); const [newRooms, setNewRooms] = useState<string[]>([]);
  const [adminEmail, setAdminEmail] = useState(""); const [adminInviteLink, setAdminInviteLink] = useState(""); const [adminInviteMessage, setAdminInviteMessage] = useState("");
  useEffect(() => setName(data.selectedTeam.name), [data.selectedTeam.name]);
  const toggleNewRoom = (id: string) => setNewRooms((current) => current.includes(id) ? current.filter((roomId) => roomId !== id) : [...current, id]);
  const toggleCreating = () => {
    const opening = !creating;
    setCreating(opening);
    if (opening && !data.roomsLoaded) void ensureRooms();
  };
  const issueAdminInvite = async (emailOverride?: string) => {
    setAdminInviteMessage("");
    try {
      const email = emailOverride || adminEmail;
      const result = await api("/api/admin/team-admin-invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }) as { inviteUrl: string };
      setAdminInviteLink(result.inviteUrl); setAdminInviteMessage("Single-use Admin setup link created. It expires in seven days.");
      setAdminEmail("");
      await navigator.clipboard.writeText(result.inviteUrl).catch(() => undefined); await reload();
    } catch (error) { setAdminInviteMessage(error instanceof Error ? error.message : "The invitation could not be created."); }
  };
  return <div className="settings-stack"><article className="panel settings-card"><h2>Team profile</h2><p>Team names and status are visible in sharing and access-request directories.</p><label className="settings-field"><span>Team name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="settings-actions"><button className="primary-button" disabled={!name.trim() || name.trim() === data.selectedTeam.name} onClick={() => void run(() => api(`/api/admin/teams/${data.selectedTeamId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, status: data.selectedTeam.status }) }), "Team profile updated.")}>Save name</button>{data.selectedTeam.status === "active" && <button className="danger-outline" onClick={() => { if (window.confirm(`Deactivate ${data.selectedTeam.name}? It will be hidden from new requests and its memberships will become inactive.`)) void api(`/api/admin/teams/${data.selectedTeamId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, status: "archived" }) }).then(() => window.location.assign("/")); }}>Deactivate team</button>}</div></article>
    <article className="panel settings-card"><div className="settings-card-heading"><div><h2>Create another team</h2><p>You become its first Admin. The guided setup keeps membership and space routing explicit.</p></div><button className="secondary-button" onClick={toggleCreating}><Plus size={16} />{creating ? "Close" : "New team"}</button></div>{creating && <div className="mini-wizard"><label className="settings-field"><span>Team name</span><input value={newName} onChange={(event) => setNewName(event.target.value)} /></label><div className="two-column"><label className="settings-field"><span>Invite emails</span><textarea rows={3} value={newEmails} onChange={(event) => setNewEmails(event.target.value)} placeholder="Paste emails separated by commas or lines" /></label><label className="settings-field"><span>Initial invite role</span><select value={newRole} onChange={(event) => setNewRole(event.target.value as "basic" | "moderator")}><option value="basic">Basic User</option><option value="moderator">Moderator</option></select></label></div>{roomsLoading && !data.roomsLoaded ? <div className="inline-status"><LoaderCircle className="spin" size={16} />Loading Webex spaces…</div> : <div className="room-checklist">{data.rooms.map((room) => <label key={room.id}><input type="checkbox" checked={newRooms.includes(room.id)} onChange={() => toggleNewRoom(room.id)} />{room.title}</label>)}</div>}<button className="primary-button" disabled={!newName.trim() || roomsLoading} onClick={() => void run(() => api("/api/admin/teams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName, invitations: parseInvitees(newEmails, newRole), roomIds: newRooms }) }), "New team created.")}>Create team</button></div>}</article>
    <article className="panel settings-card"><h2>Invite a new Team Admin</h2><p>Create a single-use, email-bound link that allows its recipient to create one team and become that team’s first Admin. Moderators cannot create or manage these invitations.</p><div className="settings-actions admin-invite-actions"><label className="settings-field admin-invite-email"><span>Future Admin email</span><input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="name@tdsynnex.com" /></label><button className="primary-button" disabled={!adminEmail.trim()} onClick={() => void issueAdminInvite()}>Create and copy link</button></div>{adminInviteLink && <label className="settings-field"><span>New setup link</span><input readOnly value={adminInviteLink} onFocus={(event) => event.currentTarget.select()} /></label>}{adminInviteMessage && <p className="settings-message">{adminInviteMessage}</p>}<div className="settings-list"><h3>Admin setup invitations</h3>{data.adminSetupInvitations.length === 0 && <p className="settings-empty">No Admin setup invitations yet.</p>}{data.adminSetupInvitations.map((invite) => <div className="settings-row" key={invite.id}><div><strong>{invite.email}</strong><span>{invite.status.replaceAll("_", " ")} · expires {new Date(invite.expires_at).toLocaleDateString()}</span></div>{(invite.status === "pending" || invite.status === "setup_started") && <div className="settings-actions"><button className="secondary-button" onClick={() => { setAdminEmail(invite.email); void issueAdminInvite(invite.email); }}>Issue replacement</button><button className="text-danger" onClick={() => void run(() => api(`/api/admin/team-admin-invitations/${invite.id}`, { method: "DELETE" }), "Admin setup invitation revoked.")}>Revoke</button></div>}</div>)}</div></article>
  </div>;
}

function MembersSettings({ data, run }: { data: SettingsData; run: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [emails, setEmails] = useState(""); const [role, setRole] = useState<"basic" | "moderator">("basic");
  const [existingUserId, setExistingUserId] = useState(""); const [existingRole, setExistingRole] = useState<"basic" | "moderator">("basic");
  const copyLink = async () => { await navigator.clipboard.writeText(data.signInUrl); };
  return <div className="settings-stack"><article className="panel settings-card"><h2>Invite team members</h2><p>Pending access activates automatically when the matching TD SYNNEX account signs in with Webex.</p><div className="two-column"><label className="settings-field"><span>Email addresses</span><textarea rows={3} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="name@tdsynnex.com" /></label><label className="settings-field"><span>Role at activation</span><select value={role} onChange={(event) => setRole(event.target.value as "basic" | "moderator")}><option value="basic">Basic User</option><option value="moderator">Moderator</option></select></label></div><div className="settings-actions"><button className="primary-button" disabled={!emails.trim()} onClick={() => void run(() => api(`/api/admin/teams/${data.selectedTeamId}/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invitations: parseInvitees(emails, role) }) }), "Invitations saved.")}>Create pending invitations</button><button className="secondary-button" onClick={() => void copyLink()}><Link2 size={15} />Copy sign-in link</button></div>{data.availableUsers.length > 0 && <div className="existing-user-add"><h3>Add a registered user</h3><div className="two-column"><label className="settings-field"><span>User</span><select value={existingUserId} onChange={(event) => setExistingUserId(event.target.value)}><option value="">Choose a registered user</option>{data.availableUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName} ({user.email})</option>)}</select></label><label className="settings-field"><span>Team role</span><select value={existingRole} onChange={(event) => setExistingRole(event.target.value as "basic" | "moderator")}><option value="basic">Basic User</option><option value="moderator">Moderator</option></select></label></div><button className="secondary-button" disabled={!existingUserId} onClick={() => void run(() => api(`/api/admin/team-members/${data.selectedTeamId}/${existingUserId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: existingRole }) }), "Registered user added to the team.")}>Add to team</button></div>}</article>
    <article className="panel settings-card"><h2>Members</h2><div className="settings-list">{data.members.map((member) => <div className="settings-row" key={member.id}><div><strong>{member.displayName}</strong><span>{member.email}</span></div><select value={member.role} disabled={member.id === data.currentUserId} onChange={(event) => void run(() => api(`/api/admin/team-members/${data.selectedTeamId}/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: event.target.value }) }), `${member.displayName}'s role updated.`)}><option value="basic">Basic</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select><button className="text-danger" disabled={member.id === data.currentUserId} onClick={() => { if (window.confirm(`Remove ${member.displayName} from this team?`)) void run(() => api(`/api/admin/team-members/${data.selectedTeamId}/${member.id}`, { method: "DELETE" }), "Member removed."); }}>Remove</button></div>)}</div></article>
    <article className="panel settings-card"><h2>Invitation history</h2><div className="settings-list">{data.invitations.length === 0 && <p className="settings-empty">No invitations yet.</p>}{data.invitations.map((invite) => <div className="settings-row" key={invite.id}><div><strong>{invite.email}</strong><span>{invite.role} · {invite.status}</span></div><time>{new Date(invite.created_at).toLocaleDateString()}</time>{invite.status === "pending" && <button className="text-danger" onClick={() => void run(() => api(`/api/admin/invitations/${invite.id}`, { method: "DELETE" }), "Invitation revoked.")}>Revoke</button>}</div>)}</div></article></div>;
}

function SpaceSettings({ data, run }: { data: SettingsData; run: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const toggleAssignment = (room: Room) => {
    if (room.assigned && room.isDefault && !window.confirm("Remove this default space from the team? New capture commands in this space will be ignored until a team assigns it again. Existing approved documents will remain searchable.")) return;
    void run(
      () => api(`/api/admin/teams/${data.selectedTeamId}/spaces`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId: room.id, enabled: !room.assigned, makeDefault: false }) }),
      room.assigned ? "Space removed from team." : "Space assigned to team.",
    );
  };
  return <article className="panel settings-card"><h2>Webex spaces</h2><p>One team is the default capture/review destination. Removing the default stops new captures until another team assigns the space; existing approved documents remain searchable.</p><div className="space-management-list">{data.rooms.map((room) => <div className="space-management-row" key={room.id}><div><strong>{room.title}</strong><span>{room.defaultTeamName ? `Default review team: ${room.defaultTeamName}` : "No default review team"}</span></div><span className={room.assigned ? "integration-ready" : "integration-pending"}>{room.assigned ? "Assigned" : "Not assigned"}</span><div className="settings-actions"><button className="secondary-button" onClick={() => toggleAssignment(room)}>{room.assigned ? "Remove from team" : "Assign to team"}</button>{room.assigned && !room.isDefault && room.canMakeDefault && <button className="secondary-button" onClick={() => void run(() => api(`/api/admin/teams/${data.selectedTeamId}/spaces`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId: room.id, enabled: true, makeDefault: true }) }), "Default review team updated.")}>Make default</button>}</div></div>)}</div>{data.rooms.length === 0 && <p className="settings-empty">No group spaces are available to the capture identity.</p>}</article>;
}

function SharingSettings({ data, run }: { data: SettingsData; run: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const sourceSpaces = data.rooms.filter(({ isDefault, sourceSpaceId }) => isDefault && sourceSpaceId);
  const recipients = data.directory.filter(({ id }) => id !== data.selectedTeamId);
  const [spaceId, setSpaceId] = useState(sourceSpaces[0]?.sourceSpaceId || ""); const [recipientId, setRecipientId] = useState(recipients[0]?.id || "");
  return <div className="settings-stack"><article className="panel settings-card"><h2>Grant knowledge access</h2><p>Grants include existing and future approved documents from the selected space. They never expose your pending review queue.</p><div className="two-column"><label className="settings-field"><span>Source space</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">Choose a space</option>{sourceSpaces.map((room) => <option key={room.id} value={room.sourceSpaceId || ""}>{room.title}</option>)}</select></label><label className="settings-field"><span>Recipient team</span><select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}><option value="">Choose a team</option>{recipients.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label></div><button className="primary-button" disabled={!spaceId || !recipientId} onClick={() => void run(() => api("/api/admin/space-grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceTeamId: data.selectedTeamId, recipientTeamId: recipientId, sourceSpaceId: spaceId }) }), "Space access granted.")}>Grant access</button></article>
    <article className="panel settings-card"><h2>Active and historical grants</h2><div className="settings-list">{data.grants.length === 0 && <p className="settings-empty">No sharing grants yet.</p>}{data.grants.map((grant) => <div className="settings-row" key={grant.id}><div><strong>{grant.spaceName}</strong><span>{grant.sourceTeamName} → {grant.recipientTeamName} · {grant.status}</span></div>{grant.status === "active" && grant.source_team_id === data.selectedTeamId && <button className="text-danger" onClick={() => void run(() => api(`/api/admin/space-grants/${grant.id}`, { method: "DELETE" }), "Access revoked.")}>Revoke</button>}</div>)}</div></article><article className="panel settings-card subtle-card"><ShieldCheck size={22} /><div><h2>Knowledge visibility</h2><p>Approved Q&amp;As are available to everyone by default. Review-team Moderators and Admins can keep a document private to the assigned team; sharing grants can extend access to selected teams.</p></div></article></div>;
}

function RequestSettings({ data, run }: { data: SettingsData; run: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const candidates = data.directory.filter(({ id, spaces }) => id !== data.selectedTeamId && spaces.length > 0);
  const [sourceTeamId, setSourceTeamId] = useState(candidates[0]?.id || ""); const [spaceIds, setSpaceIds] = useState<string[]>([]); const [note, setNote] = useState("");
  const sourceTeam = candidates.find(({ id }) => id === sourceTeamId); const toggle = (id: string) => setSpaceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const incoming = data.requests.filter(({ source_team_id }) => source_team_id === data.selectedTeamId);
  const outgoing = data.requests.filter(({ requester_team_id }) => requester_team_id === data.selectedTeamId);
  return <div className="settings-stack"><article className="panel settings-card"><h2>Request space access</h2><p>Active team and space names are discoverable for access requests; their documents remain private until approval.</p><label className="settings-field"><span>Source team</span><select value={sourceTeamId} onChange={(event) => { setSourceTeamId(event.target.value); setSpaceIds([]); }}><option value="">Choose a team</option>{candidates.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><div className="room-checklist">{sourceTeam?.spaces.map((space) => <label key={space.sourceSpaceId}><input type="checkbox" checked={spaceIds.includes(space.sourceSpaceId)} onChange={() => toggle(space.sourceSpaceId)} />{space.name}</label>)}</div><label className="settings-field"><span>Optional note</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary-button" disabled={!sourceTeamId || spaceIds.length === 0} onClick={() => void run(() => api("/api/admin/access-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requesterTeamId: data.selectedTeamId, sourceTeamId, sourceSpaceIds: spaceIds, note }) }), "Access request submitted.")}>Submit request</button></article>
    <RequestList title="Requests awaiting your decision" requests={incoming} teamId={data.selectedTeamId} run={run} incoming /><RequestList title="Requests from this team" requests={outgoing} teamId={data.selectedTeamId} run={run} /></div>;
}

function RequestList({ title, requests, run, incoming = false }: { title: string; requests: AccessRequest[]; teamId: string; run: (work: () => Promise<unknown>, success: string) => Promise<void>; incoming?: boolean }) {
  return <article className="panel settings-card"><h2>{title}</h2><div className="settings-list">{requests.length === 0 && <p className="settings-empty">No requests.</p>}{requests.map((request) => <div className="request-row" key={request.id}><div><strong>{incoming ? request.requesterTeamName : request.sourceTeamName}</strong><span>{request.spaces.map(({ name }) => name).join(", ")} · {request.status}</span>{request.note && <p>{request.note}</p>}</div>{incoming && request.status === "pending" && <div className="settings-actions"><button className="primary-button" onClick={() => void run(() => api(`/api/admin/access-requests/${request.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approved" }) }), "Request approved.")}>Approve</button><button className="secondary-button" onClick={() => void run(() => api(`/api/admin/access-requests/${request.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "denied" }) }), "Request denied.")}>Deny</button></div>}</div>)}</div></article>;
}

function IntegrationSettingsPanel() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null); const [message, setMessage] = useState("");
  const load = useCallback(() => { void api("/api/admin/integrations").then((value) => setSettings(value as IntegrationSettings)).catch((error: Error) => setMessage(error.message)); }, []);
  useEffect(load, [load]);
  const cards = useMemo(() => settings ? [{ key: "webexOAuth", label: "Webex sign-in" }, { key: "webexCapture", label: "Capture identity" }, { key: "webhook", label: "Signed webhook" }, { key: "supabase", label: "Supabase" }, { key: "llm", label: "LLM processing" }] as const : [], [settings]);
  if (!settings) return <div className="inline-status panel"><LoaderCircle className="spin" size={18} />{message || "Checking integration status…"}</div>;
  return <div className="settings-stack"><div className="integration-grid">{cards.map((card) => <article className="integration-card panel" key={card.key}><span className={settings.integrations[card.key] ? "integration-ready" : "integration-pending"}>{settings.integrations[card.key] ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}{settings.integrations[card.key] ? "Ready" : "Needs configuration"}</span><h2>{card.label}</h2>{card.key === "webexCapture" && <p>@{settings.botName} · {settings.captureRoomCount} approved spaces</p>}</article>)}</div><article className="panel settings-card"><h2>Webhook registration</h2><p>Any Team Admin may safely register the shared signed mention webhook. Secret values are never displayed.</p><button className="primary-button" disabled={!settings.integrations.webexCapture || !settings.integrations.llm} onClick={() => void api("/api/admin/webex/webhook", { method: "POST" }).then(() => { setMessage("Signed Webex webhook registered."); load(); }).catch((error: Error) => setMessage(error.message))}>{settings.integrations.webhook ? "Re-register webhook" : "Register webhook"}</button>{message && <p className="settings-message">{message}</p>}</article></div>;
}

function AuditSettings({ data }: { data: SettingsData }) {
  const labels: Record<string, string> = { team_created: "Team created", team_renamed: "Team renamed", team_status_changed: "Team status changed", team_role_changed: "Member role changed", team_member_removed: "Member removed", team_invitations_created: "Invitations created", team_invitation_revoked: "Invitation revoked", team_admin_setup_invitation_created: "Team Admin setup invitation created", team_admin_setup_invitation_revoked: "Team Admin setup invitation revoked", team_admin_setup_completed: "Invited Team Admin completed setup", team_space_configured: "Webex space updated", space_access_granted: "Knowledge access granted", space_access_revoked: "Knowledge access revoked", space_access_requested: "Access requested", space_access_request_approved: "Access request approved", space_access_request_denied: "Access request denied", document_approve: "Document approved", document_reject: "Document rejected", document_organization_visibility_changed: "Document visibility changed", draft_revised: "Review draft revised" };
  const dateGroups = groupAuditEventsByDate(data.audit);
  return <article className="panel settings-card"><h2>Audit history</h2><p>Team administration, moderation, and access changes are recorded with actor and time. Select a date to expand it.</p><div className="audit-list">{data.audit.length === 0 && <p className="settings-empty">No team-scoped events yet.</p>}{dateGroups.map((group) => <details className="audit-day" key={group.key}><summary><span><strong>{formatAuditGroupDate(group.date)}</strong><small>{group.events.length} event{group.events.length === 1 ? "" : "s"}</small></span><ChevronDown size={17} aria-hidden="true" /></summary><div className="audit-day-events">{group.events.map((event) => <div className="audit-event" key={event.id}><span className="audit-icon"><Activity size={14} /></span><div><strong>{labels[event.action] || event.action.replaceAll("_", " ")}</strong><span>{event.actorName} · {new Date(event.occurred_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div></div>)}</div></details>)}</div></article>;
}
