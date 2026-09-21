import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { SopSessionProvider } from "../features/sops/SopSessionProvider";
import { SopPage } from "../features/sops/SopPage";
import { ReviewPage } from "../features/review/ReviewPage";
import { AdminSetupPage } from "../features/admin/AdminSetupPage";
import { InitialSetupPage } from "../features/admin/InitialSetupPage";
import { SettingsPage } from "../features/admin/SettingsPage";
import { AdminInvitationSetupPage } from "../features/admin/AdminInvitationSetupPage";
import { canAccessReviewQueue, canAdministerTeams } from "../domain/access";
import { KnowledgeChatPage } from "../features/knowledge-chat/KnowledgeChatPage";

export interface AuthenticatedUser {
  email: string;
  displayName: string;
  avatarUrl?: string;
  accountStatus?: "inactive" | "active" | "suspended";
  teamRoles?: Array<{ teamId: string; teamName: string; role: "basic" | "moderator" | "admin" }>;
}

interface SessionResponse {
  authenticated: boolean;
  user?: AuthenticatedUser;
}

export function App() {
  const [user, setUser] = useState<AuthenticatedUser | null | undefined>(undefined);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() as Promise<SessionResponse> : null)
      .then((session) => {
        if (active) setUser(session?.authenticated && session.user ? session.user : null);
      })
      .catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (user !== null || window.location.pathname === "/admin-setup" || new URLSearchParams(window.location.search).has("auth_error")) return;
    window.location.replace("/api/auth/webex/start");
  }, [user]);

  useEffect(() => {
    if (!user || !user.teamRoles?.some(({ role }) => role === "admin")) {
      setSetupRequired(false);
      return;
    }
    let active = true;
    fetch("/api/admin/initial-setup", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() as Promise<{ completed: boolean }> : null)
      .then((setup) => { if (active) setSetupRequired(Boolean(setup && !setup.completed)); })
      .catch(() => { if (active) setSetupRequired(false); });
    return () => { active = false; };
  }, [user]);

  const completeSetup = useCallback(() => setSetupRequired(false), []);

  if (window.location.pathname === "/admin-setup") return <AdminInvitationSetupPage />;
  if (user === undefined) {
    return <main className="auth-loading" aria-live="polite">Checking your secure session…</main>;
  }
  if (user === null) {
    const authError = new URLSearchParams(window.location.search).has("auth_error");
    return (
      <main className="auth-loading" role={authError ? "alert" : "status"}>
        {authError ? <><p>Webex sign-in could not be completed.</p><a className="primary-button" href="/api/auth/webex/start">Try again</a></> : "Redirecting to Webex sign-in…"}
      </main>
    );
  }
  if (user.accountStatus === "inactive" || user.accountStatus === "suspended") {
    return (
      <main className="auth-loading access-status" role="status">
        <section>
          <h1>{user.accountStatus === "suspended" ? "Account suspended" : "Access request received"}</h1>
          <p>{user.accountStatus === "suspended" ? "Contact a TDS administrator to restore access." : "An administrator must activate your account and assign at least one team."}</p>
          <a className="primary-button" href="/api/auth/logout">Sign out</a>
        </section>
      </main>
    );
  }
  if (setupRequired === null && user.teamRoles?.some(({ role }) => role === "admin")) {
    return <main className="auth-loading">Checking team setup…</main>;
  }
  if (setupRequired) return <InitialSetupPage onComplete={completeSetup} />;

  const canReview = canAccessReviewQueue(user.teamRoles || []);
  const isAdmin = canAdministerTeams(user.teamRoles || []);

  return (
    <SopSessionProvider key={user.email}><Routes>
      <Route element={<AppShell user={user} canReview={canReview} />}>
        <Route index element={canReview ? <DashboardPage canReview /> : <Navigate to="/library" replace />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="knowledge-chat" element={<KnowledgeChatPage />} />
        <Route path="review" element={canReview ? <ReviewPage /> : <Navigate to="/library" replace />} />
        <Route path="sops" element={canReview ? <SopPage /> : <Navigate to="/library" replace />} />
        <Route path="favorites" element={<LibraryPage favoritesOnly />} />
        <Route path="people" element={isAdmin ? <Navigate to="/settings?section=members" replace /> : <Navigate to="/library" replace />} />
        <Route path="settings" element={isAdmin ? <SettingsPage /> : <Navigate to="/library" replace />} />
        <Route path="help" element={<AdminSetupPage section="help" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes></SopSessionProvider>
  );
}
