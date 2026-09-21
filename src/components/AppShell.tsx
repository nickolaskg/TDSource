import {
  BookOpen,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  LogOut,
  Search,
  Settings,
  Star,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { AuthenticatedUser } from "../app/App";
import { BrandMark } from "./BrandMark";

const primaryNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, reviewOnly: true },
  { to: "/review", label: "Review queue", icon: ClipboardCheck, reviewOnly: true },
  { to: "/sops", label: "Create SOP", icon: ClipboardList, reviewOnly: true },
  { to: "/library", label: "Knowledge library", icon: BookOpen },
  { to: "/knowledge-chat", label: "Knowledge chat", icon: MessageSquareText },
  { to: "/favorites", label: "Favorites", icon: Star },
];

const adminNav = [
  { to: "/settings?section=members", label: "People & teams", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help & FAQ", icon: CircleHelp },
];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AppShell({ user, canReview }: { user: AuthenticatedUser; canReview: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user.teamRoles?.some(({ role }) => role === "admin") === true;
  const primaryRole = user.teamRoles?.[0]?.role;
  const roleLabel = isAdmin ? "Team administrator" : primaryRole === "basic" ? "Standard User" : primaryRole || "Webex authenticated";
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(`/library?q=${encodeURIComponent(searchQuery.trim())}`);
  };
  const breadcrumbLabels: Record<string, string> = { "/review": "Review queue", "/sops": "Create SOP", "/library": "Knowledge library", "/knowledge-chat": "Knowledge chat", "/favorites": "Favorites", "/settings": "Settings", "/help": "Help & FAQ" };
  const breadcrumbLabel = breadcrumbLabels[location.pathname];
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { window.localStorage.setItem("tds-color-theme", theme); } catch { /* Keep the active theme even when persistence is unavailable. */ }
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#10191a" : "#005758");
  }, [theme]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {menuOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <header className="topbar">
        <BrandMark />
        <button className="icon-button mobile-only" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
          <Menu size={21} />
        </button>
        <form className="global-search" role="search" onSubmit={submitSearch}>
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search approved knowledge" aria-label="Search approved knowledge" />
          <button type="submit" aria-label="Search approved knowledge"><Search size={18} aria-hidden="true" /></button>
        </form>
        <div className="account-menu-wrap">
          <button className="profile-chip profile-button" type="button" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
            <span className="avatar">{initials(user.displayName)}{user.avatarUrl && <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}</span>
            <span className="profile-copy"><strong>{user.displayName}</strong><small>{roleLabel}</small></span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {accountOpen && <div className="account-menu" role="menu">
            <div><strong>{user.displayName}</strong><small>{user.email}</small></div>
            {isAdmin && <NavLink to="/settings" role="menuitem" onClick={() => setAccountOpen(false)}><Settings size={15} /> Account settings</NavLink>}
            <button className="account-menu-action" type="button" role="menuitem" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />} Use {theme === "dark" ? "day" : "night"} mode</button>
            <a href="/api/auth/logout" role="menuitem"><LogOut size={15} /> Sign out</a>
          </div>}
        </div>
      </header>
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-topline">
          <button className="icon-button mobile-only" onClick={() => setMenuOpen(false)} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Primary navigation" className="nav-list">
          {primaryNav.filter(({ reviewOnly }) => !reviewOnly || canReview).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {isAdmin && <div className="nav-section-label">Administration</div>}
        {isAdmin && <div className="nav-list muted-nav">
          {adminNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>}
        <div className="sidebar-foot">
          <span className="environment-dot" />
          <div><strong>{roleLabel}</strong></div>
        </div>
      </aside>

      <div className="app-main">
        {breadcrumbLabel && <nav className="breadcrumb-bar" aria-label="Breadcrumb"><NavLink to="/">Home</NavLink><span aria-hidden="true">/</span><span aria-current="page">{breadcrumbLabel}</span></nav>}
        <main id="main-content" className="page-wrap"><Outlet /></main>
      </div>
    </div>
  );
}
