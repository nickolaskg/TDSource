import { ArrowRight, LoaderCircle, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import "../../styles/workflow.css";

interface SetupInvitation {
  authenticated: boolean;
  email: string;
  expiresAt: string;
  rooms: Array<{ id: string; title: string }>;
  roomsAvailable?: boolean;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { message?: string; code?: string };
  return payload.message || payload.code || fallback;
}

export function AdminInvitationSetupPage() {
  const [invitation, setInvitation] = useState<SetupInvitation | null>(null);
  const [message, setMessage] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [teamName, setTeamName] = useState(""); const [emails, setEmails] = useState(""); const [inviteRole, setInviteRole] = useState<"basic" | "moderator">("basic"); const [roomIds, setRoomIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
        if (token) {
          const response = await fetch("/api/admin-setup/context", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
          if (!response.ok) throw new Error(await responseMessage(response, "This invitation could not be opened."));
          window.history.replaceState({}, "", "/admin-setup");
        }
        const response = await fetch("/api/admin-setup/invitation", { credentials: "same-origin" });
        if (!response.ok) throw new Error(await responseMessage(response, "This invitation is unavailable."));
        const payload = await response.json() as SetupInvitation;
        if (active) setInvitation(payload);
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "This invitation is unavailable."); }
      finally { if (active) setLoading(false); }
    };
    void initialize(); return () => { active = false; };
  }, []);

  const toggleRoom = (id: string) => setRoomIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const complete = async () => {
    setSaving(true); setMessage("");
    const invitations = [...new Set(emails.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))].map((email) => ({ email, role: inviteRole }));
    try {
      const response = await fetch("/api/admin-setup/complete", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamName, invitations, roomIds }) });
      if (!response.ok) throw new Error(await responseMessage(response, "Team setup could not be completed."));
      window.location.assign("/");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Team setup could not be completed."); setSaving(false); }
  };

  if (loading) return <main className="auth-loading admin-invitation-page"><LoaderCircle className="spin" size={22} />Opening your Admin setup invitation…</main>;
  if (!invitation) return <main className="auth-loading access-status admin-invitation-page"><section><BrandMark /><h1>Admin setup invitation unavailable</h1><p>{message}</p><div className="setup-actions"><a className="primary-button" href="/">Return to TDS</a><a className="secondary-button" href="/api/auth/logout?returnTo=/admin-setup">Sign out and try another Webex account</a></div></section></main>;
  if (!invitation.authenticated) return <main className="sign-in-page admin-invitation-page"><section className="sign-in-panel"><BrandMark /><div className="sign-in-copy"><span className="eyebrow">Team Admin invitation</span><h1>Create and lead your TDS team.</h1><p>This single-use invitation is assigned to {invitation.email}. Sign in with that Webex account to continue.</p></div><a className="primary-button" href="/api/auth/webex/start">Continue with Webex <ArrowRight size={18} /></a><p className="security-note"><ShieldCheck size={15} /> Admin access is granted only after team setup completes.</p></section></main>;

  return <main className="auth-loading initial-setup"><section className="setup-card panel"><Users size={28} /><span className="eyebrow">New Team Admin</span><h1>Set up your TDS team</h1><p>Name your team, invite its initial members, and select at least one Webex space containing the TDS bot. You become this team’s first Admin only when setup succeeds.</p><label className="role-control"><span>Team name</span><input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Customer Support" /></label><label className="role-control"><span>Invite team members</span><textarea value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="name@tdsynnex.com&#10;Paste multiple emails separated by commas or lines" rows={4} /></label><label className="role-control"><span>Role at activation</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "basic" | "moderator")}><option value="basic">Basic User</option><option value="moderator">Moderator</option></select></label><div className="setup-rooms"><strong>Webex spaces available to TDS</strong>{invitation.rooms.map((room) => <label key={room.id}><input type="checkbox" checked={roomIds.includes(room.id)} onChange={() => toggleRoom(room.id)} />{room.title}</label>)}{invitation.rooms.length === 0 && <p>{invitation.roomsAvailable === false ? "Webex space discovery is temporarily unavailable." : "No group spaces are available. Add the TDS bot and capture identity to a Webex space, then reload."}</p>}</div><button className="primary-button" disabled={saving || !teamName.trim() || roomIds.length === 0} onClick={() => void complete()}>{saving && <LoaderCircle className="spin" size={16} />}Create team and become Admin</button>{message && <p className="setup-result error" role="alert">{message}</p>}</section></main>;
}
