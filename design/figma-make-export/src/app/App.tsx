import React, { useState, useMemo } from "react";
import {
  LayoutDashboard, Search, FileText, Star, ClipboardList,
  XCircle, Archive, Users, Settings, HelpCircle, Bell,
  Menu, X, ChevronRight, Plus, Pencil, CheckCircle,
  AlertCircle, Clock, Trash2, RotateCcw, Paperclip,
  Building2, LogOut, Sparkles, MessageSquare, AlertTriangle,
  UserPlus, Folder, Shield, Globe, RefreshCw, ArrowRight,
  Heart, Lock, Filter, ChevronDown, Eye, EyeOff,
  Info, Download, Check, MoreHorizontal, ChevronLeft, Tag,
  Ban, User, ChevronUp, Send, BookOpen,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────────── */
type Role = "admin" | "moderator" | "basic";
type DocStatus = "approved" | "pending" | "rejected" | "archived" | "failed" | "change_request";
type Screen =
  | "dashboard" | "search" | "documents" | "favorites"
  | "review-queue" | "review-editor" | "document-detail"
  | "rejected" | "archive" | "users" | "teams"
  | "categories" | "settings" | "faq";

interface TMsg { id: string; author: string; content: string; time: string; isQ: boolean }
interface TDSDoc {
  id: string; title: string; problem: string; summary: string;
  steps: string[]; warnings: string[]; categories: string[];
  tags: string[]; status: DocStatus; teams: string[];
  webexSpace: string; requester: string; author: string;
  createdAt: string; updatedAt: string; expiresAt?: string;
  attachments: string[]; verified: boolean; showTranscript: boolean;
  notes: string; isFavorite: boolean; transcript: TMsg[];
}
interface AppUser {
  id: string; name: string; email: string; role: Role;
  teams: string[]; status: "active" | "pending" | "suspended";
  initials: string; joined: string;
}
interface Team {
  id: string; name: string; desc: string;
  members: string[]; spaces: string[]; cats: string[];
}
interface Ctx {
  nav: (s: Screen, doc?: TDSDoc) => void;
  back: () => void;
  role: Role;
  currentUser: AppUser;
  docs: TDSDoc[];
  updateDoc: (id: string, p: Partial<TDSDoc>) => void;
  selDoc: TDSDoc | null;
  currentScreen: Screen;
  noTeamDemo: boolean;
}

/* ── Role-based permission system ───────────────────────────────────────────── */
const ROLE_SCREENS: Record<Role, Screen[]> = {
  admin:     ["dashboard","search","documents","favorites","review-queue","review-editor","document-detail","rejected","archive","users","teams","categories","settings","faq"],
  moderator: ["dashboard","search","documents","favorites","review-queue","review-editor","document-detail","rejected","archive","faq"],
  basic:     ["search","documents","favorites","faq","document-detail"],
};

function canAccess(screen: Screen, role: Role): boolean {
  return ROLE_SCREENS[role].includes(screen);
}

const ROLE_DEFAULT_SCREEN: Record<Role, Screen> = {
  admin:     "dashboard",
  moderator: "dashboard",
  basic:     "documents",
};

// Demo user profile per role
const ROLE_PROFILES: Record<Role, AppUser> = {
  admin:     { id: "u1", name: "Sarah Chen",     email: "sarah.chen@tdsynnex.com",     role: "admin",     teams: ["Enterprise Cloud","Network Infrastructure"], status: "active", initials: "SC", joined: "Jan 15, 2023" },
  moderator: { id: "u2", name: "Marcus Reynolds", email: "marcus.reynolds@tdsynnex.com", role: "moderator", teams: ["Network Infrastructure"],                   status: "active", initials: "MR", joined: "Mar 22, 2023" },
  basic:     { id: "u4", name: "Priya Kapoor",    email: "priya.kapoor@tdsynnex.com",    role: "basic",     teams: ["Security"],                                  status: "active", initials: "PK", joined: "Jan 5, 2024" },
};

/* ── Mock users ─────────────────────────────────────────────────────────────── */
const USERS: AppUser[] = [
  { id: "u1", name: "Sarah Chen", email: "sarah.chen@tdsynnex.com", role: "admin", teams: ["Enterprise Cloud", "Network Infrastructure"], status: "active", initials: "SC", joined: "Jan 15, 2023" },
  { id: "u2", name: "Marcus Reynolds", email: "marcus.reynolds@tdsynnex.com", role: "moderator", teams: ["Network Infrastructure"], status: "active", initials: "MR", joined: "Mar 22, 2023" },
  { id: "u3", name: "Jamie Torres", email: "jamie.torres@tdsynnex.com", role: "moderator", teams: ["Enterprise Cloud", "Security"], status: "active", initials: "JT", joined: "Jun 10, 2023" },
  { id: "u4", name: "Priya Kapoor", email: "priya.kapoor@tdsynnex.com", role: "basic", teams: ["Security"], status: "active", initials: "PK", joined: "Jan 5, 2024" },
  { id: "u5", name: "David Okafor", email: "david.okafor@tdsynnex.com", role: "basic", teams: ["Enterprise Cloud"], status: "pending", initials: "DO", joined: "Sep 12, 2024" },
  { id: "u6", name: "Lisa Park", email: "lisa.park@tdsynnex.com", role: "basic", teams: ["Network Infrastructure"], status: "suspended", initials: "LP", joined: "Nov 30, 2023" },
  { id: "u7", name: "Tom Bradley", email: "tom.bradley@tdsynnex.com", role: "moderator", teams: ["Enterprise Cloud"], status: "active", initials: "TB", joined: "Aug 15, 2023" },
  { id: "u8", name: "Aria Nguyen", email: "aria.nguyen@tdsynnex.com", role: "basic", teams: ["Security"], status: "active", initials: "AN", joined: "Mar 20, 2024" },
];

/* ── Mock teams ─────────────────────────────────────────────────────────────── */
const TEAMS: Team[] = [
  { id: "t1", name: "Enterprise Cloud", desc: "Cloud infrastructure, migration strategies, and hyperscaler partnerships.", members: ["u1", "u3", "u5", "u7"], spaces: ["Cisco Cloud Partners", "Azure Migration Support", "AWS Partner Network"], cats: ["Cloud", "Infrastructure", "Migration", "Virtualization"] },
  { id: "t2", name: "Network Infrastructure", desc: "Routing, switching, wireless, and SD-WAN solution support.", members: ["u1", "u2", "u6"], spaces: ["Cisco Network Partners", "Juniper SE Channel", "Meraki Partner Hub"], cats: ["Network", "Cisco", "Switching", "Wireless", "SD-WAN"] },
  { id: "t3", name: "Security", desc: "Cybersecurity products, compliance frameworks, and incident response.", members: ["u3", "u4", "u6", "u8"], spaces: ["Fortinet Partner Portal", "CrowdStrike Channel", "Palo Alto Partners"], cats: ["Security", "Compliance", "Firewall", "Endpoint", "SIEM"] },
  { id: "t4", name: "Unified Communications", desc: "Collaboration tools, video conferencing, and UC migrations.", members: [], spaces: ["Cisco Webex Partners", "Microsoft Teams Channel"], cats: ["Collaboration", "Webex", "Video", "UC Migration"] },
];

/* ── Mock documents ─────────────────────────────────────────────────────────── */
const INIT_DOCS: TDSDoc[] = [
  {
    id: "d1",
    title: "Cisco Catalyst 9300 VLAN Configuration Drift After IOS-XE 17.9.x Upgrade",
    problem: "VLAN configurations on Cisco Catalyst 9300 series switches reset or become inconsistent after upgrading to IOS-XE firmware 17.9.x, causing intermittent connectivity loss across segmented networks.",
    summary: "IOS-XE 17.9.x introduced a regression in the VLAN persistence mechanism tied to NV-RAM write optimization. Disabling this optimization and re-applying trunk configurations resolves the immediate issue. A permanent fix is available in 17.10.x.",
    steps: [
      "Verify firmware version: show version | include Version",
      "Back up current config: copy running-config tftp://[server]/[hostname]-backup.cfg",
      "Enter global config: configure terminal",
      "Disable NV-RAM optimization: no nvram optimization",
      "Re-apply trunk configs: interface range GigabitEthernet1/0/1-24, switchport trunk allowed vlan all",
      "Save: end → write memory",
      "Validate with: show vlan brief and test cross-VLAN connectivity",
      "Schedule IOS-XE 17.10.x upgrade in next maintenance window for permanent fix",
    ],
    warnings: [
      "Applying trunk config during business hours will cause 30–60 second outage per interface group",
      "Verify backup config before making changes",
      "IOS-XE 17.10.x fully resolves this — prioritize upgrade scheduling",
    ],
    categories: ["Network", "Cisco", "Switching"],
    tags: ["catalyst-9300", "vlan", "ios-xe", "firmware", "trunk"],
    status: "approved", teams: ["Network Infrastructure"],
    webexSpace: "Cisco Network Partners",
    requester: "marcus.reynolds@tdsynnex.com", author: "Sarah Chen",
    createdAt: "Nov 15, 2024", updatedAt: "Nov 18, 2024",
    attachments: ["9300-vlan-fix-script.py", "maintenance-window-template.docx"],
    verified: true, showTranscript: true,
    notes: "Confirmed with Cisco TAC case #SR-2024-1182.",
    isFavorite: true,
    transcript: [
      { id: "t1", author: "Marcus Reynolds", content: "Has anyone seen VLAN configs resetting after the 17.9.3 update on 9300s? We're seeing it across 3 customer sites.", time: "Nov 12, 2024 · 9:15 AM", isQ: true },
      { id: "t2", author: "Jamie Torres", content: "Yes! We hit this last week. It's a known bug with the 17.9.x line. The VLAN database doesn't persist correctly across reloads when NV-RAM write optimization is enabled.", time: "Nov 12, 2024 · 9:32 AM", isQ: false },
      { id: "t3", author: "Marcus Reynolds", content: "So is there a workaround or do we need to roll back?", time: "Nov 12, 2024 · 9:35 AM", isQ: true },
      { id: "t4", author: "Jamie Torres", content: "Workaround: disable NV-RAM optimization ('no nvram optimization' in global config), then re-apply your trunk configs. I can share a script.", time: "Nov 12, 2024 · 9:48 AM", isQ: false },
      { id: "t5", author: "Sarah Chen", content: "Validated this fix at 2 customer sites. Also: 17.10.x includes a permanent fix. If the customer can schedule a maintenance window, that's the cleanest path.", time: "Nov 12, 2024 · 10:05 AM", isQ: false },
      { id: "t6", author: "Marcus Reynolds", content: "Perfect. Will implement the workaround tonight and plan the upgrade for Q1. Thanks team!", time: "Nov 12, 2024 · 10:12 AM", isQ: false },
    ],
  },
  {
    id: "d2",
    title: "FortiGate SSL-VPN Auth Failures After FortiOS 7.4.2 Upgrade",
    problem: "Customers experience intermittent SSL handshake failures on FortiGate SSL-VPN after upgrading to FortiOS 7.4.2, resulting in users unable to authenticate.",
    summary: "FortiOS 7.4.2 removed TLS_AES_256_GCM_SHA384 from the default SSL-VPN cipher suite list. Manually re-adding the cipher suite resolves authentication failures without requiring a VPN service restart.",
    steps: [
      "Log into FortiGate GUI with admin credentials",
      "Navigate to VPN > SSL-VPN Settings",
      "Scroll to Cipher Suites and click Edit",
      "Add TLS_AES_256_GCM_SHA384 to the enabled cipher list",
      "Click Apply — changes are hot-applied, no restart needed",
      "Advise affected users to disconnect and reconnect",
      "Monitor SSL-VPN logs for continued handshake errors",
    ],
    warnings: [
      "Connected VPN sessions will require re-authentication after cipher change",
      "Notify users before applying during business hours",
    ],
    categories: ["Security", "Fortinet", "VPN"],
    tags: ["fortigate", "ssl-vpn", "fortios", "cipher-suite", "tls"],
    status: "pending", teams: ["Security"],
    webexSpace: "Fortinet Partner Portal",
    requester: "priya.kapoor@tdsynnex.com", author: "Aria Nguyen",
    createdAt: "Nov 20, 2024", updatedAt: "Nov 21, 2024",
    attachments: ["fortigate-vpn-debug-log.txt"],
    verified: false, showTranscript: false,
    notes: "Pending verification from Fortinet TAC.",
    isFavorite: false,
    transcript: [
      { id: "t1", author: "Priya Kapoor", content: "Getting intermittent auth failures on FortiGate SSL-VPN after upgrading to FortiOS 7.4.2. Customers are seeing 'SSL handshake failed' in logs.", time: "Nov 20, 2024 · 2:10 PM", isQ: true },
      { id: "t2", author: "Aria Nguyen", content: "This is a known issue with 7.4.2 and certain TLS 1.3 cipher suites. You need to explicitly re-enable the cipher suite list after upgrade.", time: "Nov 20, 2024 · 2:25 PM", isQ: false },
      { id: "t3", author: "Tom Bradley", content: "Confirmed. Go to VPN > SSL-VPN Settings > Cipher Suites and manually re-add TLS_AES_256_GCM_SHA384. Fortinet removed it from the default set in 7.4.2.", time: "Nov 20, 2024 · 2:38 PM", isQ: false },
      { id: "t4", author: "Priya Kapoor", content: "Will this require a VPN restart or is it hot-applied?", time: "Nov 20, 2024 · 2:42 PM", isQ: true },
      { id: "t5", author: "Aria Nguyen", content: "Hot-applied, no restart needed. But connected sessions will need to re-authenticate.", time: "Nov 20, 2024 · 2:45 PM", isQ: false },
    ],
  },
  {
    id: "d3",
    title: "Azure AD Conditional Access Blocking Legacy Auth Service Accounts",
    problem: "After enabling Conditional Access MFA enforcement policies, legacy authentication clients (SMTP AUTH, IMAP, POP3) are blocked for service accounts used by line-of-business applications.",
    summary: "Conditional Access policies that block legacy authentication apply globally by default. Service accounts for LOB apps must be explicitly excluded from policy scope using security groups or named locations.",
    steps: [
      "Identify affected accounts via Azure AD Sign-in Logs filtered by Legacy Authentication Client",
      "Create a security group: LOB-Service-Accounts and add affected accounts",
      "In Azure AD > Security > Conditional Access, open the blocking policy",
      "Under Assignments > Users > Exclude, add the LOB-Service-Accounts group",
      "Enable audit logging for excluded accounts to monitor for misuse",
      "Plan migration of LOB apps to modern OAuth 2.0 auth within 90 days",
    ],
    warnings: [
      "Excluding service accounts from MFA policies creates a security gap — document in your security register",
      "Legacy auth exclusions should be treated as temporary — plan for app modernization",
      "Notify your compliance team of any MFA policy exclusions",
    ],
    categories: ["Cloud", "Microsoft", "Identity"],
    tags: ["azure-ad", "conditional-access", "mfa", "legacy-auth", "m365"],
    status: "change_request", teams: ["Enterprise Cloud", "Security"],
    webexSpace: "Azure Migration Support",
    requester: "david.okafor@tdsynnex.com", author: "Tom Bradley",
    createdAt: "Nov 10, 2024", updatedAt: "Nov 22, 2024",
    attachments: [],
    verified: true, showTranscript: false,
    notes: "Reviewer requested additional detail on the 90-day modernization timeline and rollback procedure.",
    isFavorite: false,
    transcript: [
      { id: "t1", author: "David Okafor", content: "We've hit a problem with service accounts being blocked after enabling CA policies for MFA. The LOB apps use SMTP AUTH for notifications.", time: "Nov 10, 2024 · 11:00 AM", isQ: true },
      { id: "t2", author: "Tom Bradley", content: "Classic CA gotcha. You need to exclude service accounts from the legacy auth block policy. Create a group for them and add it to the exclusion list.", time: "Nov 10, 2024 · 11:15 AM", isQ: false },
    ],
  },
  {
    id: "d4",
    title: "Meraki MX 18.107 Firmware Breaks Site-to-Site VPN Tunnels",
    problem: "After automatic Meraki firmware upgrade to MX 18.107, site-to-site VPN tunnels fail to establish, showing IKE negotiation failed errors in the event log.",
    summary: "MX 18.107 introduced stricter IKEv2 proposal validation. VPN peers using IKEv1 or non-compliant IKEv2 proposals are rejected. Updating peer IKE settings or rolling back to MX 18.106 resolves the issue.",
    steps: [
      "Check Meraki Dashboard > Security > Event Log for IKE negotiation failed entries",
      "Identify remote peer device type and current IKE policy",
      "If peer supports IKEv2: update peer IKE policy to AES-256/SHA-256/DH Group 14",
      "If peer is IKEv1-only: open Meraki support ticket for firmware rollback to 18.106",
      "After peer update, monitor tunnel status in Dashboard > Security > Site-to-Site VPN",
    ],
    warnings: [
      "Meraki firmware rollback requires a support ticket — cannot be self-served",
      "VPN downtime will impact all remote-site connectivity during reconfiguration",
    ],
    categories: ["Network", "Meraki", "VPN"],
    tags: ["meraki", "mx", "firmware", "site-to-site-vpn", "ike"],
    status: "rejected", teams: ["Network Infrastructure"],
    webexSpace: "Meraki Partner Hub",
    requester: "lisa.park@tdsynnex.com", author: "Marcus Reynolds",
    createdAt: "Oct 28, 2024", updatedAt: "Oct 31, 2024",
    expiresAt: "Sep 28, 2026",
    attachments: ["meraki-vpn-event-log.txt"],
    verified: false, showTranscript: true,
    notes: "Rejected: steps incomplete, not verified against MX 18.107 release notes. Missing rollback procedure detail.",
    isFavorite: false,
    transcript: [],
  },
  {
    id: "d5",
    title: "CrowdStrike Falcon Sensor Error 1603 on Windows Server 2019",
    problem: "CrowdStrike Falcon sensor fails to install on Windows Server 2019 with error code 1603, shown as Installation Failed in the deployment dashboard.",
    summary: "Error 1603 is commonly caused by an expired installation token, Windows Installer service conflicts, or Group Policy blocking unsigned kernel drivers.",
    steps: [
      "Verify installation token in Falcon Console > Hosts > Sensor Downloads — check expiry",
      "Regenerate token if expired (tokens expire after 30 days by default)",
      "Check Windows Installer service: services.msc > Windows Installer > set to Manual > Start",
      "Temporarily disable competing endpoint protection during install",
      "Re-run installer: CsInstall.exe /install /ap [policy-group] /token [fresh-token]",
      "Check CSASetupLog.log in %TEMP% for specific error details",
    ],
    warnings: [
      "Temporarily disabling existing AV creates a security gap — perform in a maintenance window",
      "Ensure Falcon sensor version matches the OS build (WS2019 requires sensor 6.35+)",
    ],
    categories: ["Security", "CrowdStrike", "Endpoint"],
    tags: ["crowdstrike", "falcon", "windows-server", "deployment", "error-1603"],
    status: "archived", teams: ["Security"],
    webexSpace: "CrowdStrike Channel",
    requester: "aria.nguyen@tdsynnex.com", author: "Priya Kapoor",
    createdAt: "Sep 5, 2024", updatedAt: "Sep 10, 2024",
    expiresAt: "Oct 10, 2026",
    attachments: ["CSASetupLog.log", "deployment-checklist.pdf"],
    verified: true, showTranscript: false,
    notes: "Archived after solution was incorporated into the official CrowdStrike deployment runbook.",
    isFavorite: false,
    transcript: [],
  },
  {
    id: "d6",
    title: "Webex Calling PSTN Failover Not Triggering During Carrier Outage",
    problem: "Configured PSTN failover on Cisco Webex Calling does not automatically switch to the backup carrier during a primary PSTN outage.",
    summary: "Webex Calling PSTN failover requires both trunks to have correct failover priorities in Control Hub and the location must have Route Group Failover enabled.",
    steps: [
      "In Webex Control Hub, navigate to Calling > Trunks",
      "Verify both primary and backup PSTN trunks are Active",
      "Go to Calling > Route Groups and verify backup trunk has priority 2 or higher",
      "Under Location Calling Settings, enable Route Group Failover toggle",
      "Test failover by temporarily disabling primary trunk and making an outbound call",
      "Re-enable primary trunk and verify automatic failback",
    ],
    warnings: [
      "Testing failover will disrupt active calls on the primary trunk — schedule during off-hours",
      "Ensure backup carrier has sufficient capacity for full call volume",
    ],
    categories: ["Collaboration", "Cisco", "Webex"],
    tags: ["webex-calling", "pstn", "failover", "control-hub", "route-group"],
    status: "failed", teams: ["Enterprise Cloud"],
    webexSpace: "Cisco Webex Partners",
    requester: "tom.bradley@tdsynnex.com", author: "Jamie Torres",
    createdAt: "Nov 18, 2024", updatedAt: "Nov 19, 2024",
    attachments: [],
    verified: false, showTranscript: false,
    notes: "AI generation failed — transcript too sparse for structured draft.",
    isFavorite: false,
    transcript: [],
  },
  {
    id: "d7",
    title: "Juniper SRX — BGP Session Flapping After Interface MTU Mismatch",
    problem: "BGP sessions on Juniper SRX 300 series are intermittently flapping when peering with upstream routers configured with a different MTU on transit interfaces.",
    summary: "MTU mismatches between BGP peers cause TCP session issues during large UPDATE messages. Aligning interface MTU values and enabling TCP MSS clamping resolves session stability.",
    steps: [
      "Identify flapping BGP session: show bgp summary | grep Flaps",
      "Check interface MTU: show interfaces ge-0/0/0 | match MTU",
      "Update interface MTU to match peer: set interfaces ge-0/0/0 unit 0 family inet mtu 1500",
      "Enable TCP MSS clamping: set security flow tcp-mss all-tcp mss 1452",
      "Commit and monitor: monitor traffic interface ge-0/0/0",
    ],
    warnings: [
      "MTU changes will briefly drop the BGP session — coordinate with upstream peer",
      "Validate with both IPv4 and IPv6 sessions if dual-stack",
    ],
    categories: ["Network", "Juniper", "Routing"],
    tags: ["juniper", "srx", "bgp", "mtu", "flapping"],
    status: "pending", teams: ["Network Infrastructure"],
    webexSpace: "Juniper SE Channel",
    requester: "marcus.reynolds@tdsynnex.com", author: "Marcus Reynolds",
    createdAt: "Nov 22, 2024", updatedAt: "Nov 22, 2024",
    attachments: [],
    verified: false, showTranscript: false,
    notes: "",
    isFavorite: false,
    transcript: [
      { id: "t1", author: "Marcus Reynolds", content: "Anyone seen BGP flapping on SRX 300s after upgrading upstream router MTU to 9000? Sessions keep dropping every few hours.", time: "Nov 22, 2024 · 8:30 AM", isQ: true },
      { id: "t2", author: "Jamie Torres", content: "Classic MTU path issue. The BGP UPDATE messages exceed the MTU on the transit link and get fragmented/dropped. Enable TCP MSS clamping and align the MTU values.", time: "Nov 22, 2024 · 8:50 AM", isQ: false },
    ],
  },
  {
    id: "d8",
    title: "Palo Alto GlobalProtect — Split Tunneling Not Excluding Microsoft 365 Traffic",
    problem: "Split tunneling configured on Palo Alto GlobalProtect VPN is not excluding Microsoft 365 traffic as expected, causing all M365 traffic to traverse the VPN tunnel and degrading performance.",
    summary: "GlobalProtect split tunnel exclusion requires the M365 IP ranges to be added to the split tunnel exclusion list in the GP Gateway configuration. Dynamic address groups cannot be used for split tunnel exclusions — static IP ranges are required.",
    steps: [
      "Download current M365 IP ranges from Microsoft's endpoint JSON feed",
      "In Panorama/NGFW: navigate to Network > GlobalProtect > Gateways > [gateway] > Agent > Split Tunnel",
      "Under Exclude Access Route, add each M365 IP range as a static entry",
      "Ensure 'No direct access to local network' is unchecked if local LAN access is needed",
      "Push policy and test from a GP client: curl --resolve ... to verify traffic path",
    ],
    warnings: [
      "M365 IP ranges change frequently — establish a process to update the exclusion list quarterly",
      "Dynamic address groups are not supported for GP split tunnel — must use static IPs",
    ],
    categories: ["Security", "Palo Alto", "VPN"],
    tags: ["palo-alto", "globalprotect", "split-tunnel", "m365", "vpn"],
    status: "pending", teams: ["Security", "Enterprise Cloud"],
    webexSpace: "Palo Alto Partners",
    requester: "aria.nguyen@tdsynnex.com", author: "Priya Kapoor",
    createdAt: "Nov 23, 2024", updatedAt: "Nov 23, 2024",
    attachments: ["m365-ip-ranges.json"],
    verified: false, showTranscript: false,
    notes: "",
    isFavorite: false,
    transcript: [
      { id: "t1", author: "Aria Nguyen", content: "Having trouble getting GP split tunnel exclusions to work for M365. Traffic is still going through the tunnel even with exclusions configured.", time: "Nov 23, 2024 · 10:00 AM", isQ: true },
      { id: "t2", author: "Priya Kapoor", content: "The catch with GP split tunneling is that dynamic address groups don't work for exclusions. You need to add static IP ranges. Get the M365 range list from Microsoft's endpoint API.", time: "Nov 23, 2024 · 10:20 AM", isQ: false },
      { id: "t3", author: "Aria Nguyen", content: "That explains it — we were using a dynamic group. How do we keep the IP list updated?", time: "Nov 23, 2024 · 10:22 AM", isQ: true },
      { id: "t4", author: "Priya Kapoor", content: "Microsoft publishes the JSON feed at a stable URL. You can script quarterly updates and push via Panorama API. I'll share a sample script.", time: "Nov 23, 2024 · 10:35 AM", isQ: false },
    ],
  },
];

/* ── Status config ──────────────────────────────────────────────────────────── */
type StatusCfg = { label: string; txt: string; bg: string; icon: React.ElementType };
const STATUS_CFG: Record<DocStatus, StatusCfg> = {
  approved:       { label: "Approved",          txt: "text-emerald-700", bg: "bg-emerald-50 border border-emerald-200",  icon: CheckCircle },
  pending:        { label: "Awaiting Review",   txt: "text-amber-700",   bg: "bg-amber-50 border border-amber-200",      icon: Clock },
  change_request: { label: "Change Request",    txt: "text-blue-700",    bg: "bg-blue-50 border border-blue-200",        icon: Pencil },
  failed:         { label: "Processing Failed", txt: "text-orange-700",  bg: "bg-orange-50 border border-orange-200",    icon: AlertCircle },
  rejected:       { label: "Rejected",          txt: "text-red-700",     bg: "bg-red-50 border border-red-200",          icon: XCircle },
  archived:       { label: "Archived",          txt: "text-gray-500",    bg: "bg-gray-50 border border-gray-200",        icon: Archive },
};

/* ── Nav items ──────────────────────────────────────────────────────────────── */
type NavSect = "main" | "review" | "admin" | "help";
interface NavItem { id: Screen; label: string; Icon: React.ElementType; roles: Role[]; section: NavSect; badge?: number }

// Privileged nav (Moderator / Admin) — shown with section grouping
const NAV_ITEMS: NavItem[] = [
  { id: "dashboard",    label: "Dashboard",    Icon: LayoutDashboard, roles: ["admin","moderator"], section: "main" },
  { id: "search",       label: "Search",       Icon: Search,          roles: ["admin","moderator"], section: "main" },
  { id: "documents",    label: "Documents",    Icon: FileText,        roles: ["admin","moderator"], section: "main" },
  { id: "favorites",    label: "Favorites",    Icon: Star,            roles: ["admin","moderator"], section: "main" },
  { id: "review-queue", label: "Review Queue", Icon: ClipboardList,   roles: ["admin","moderator"], section: "review", badge: 4 },
  { id: "rejected",     label: "Rejected",     Icon: XCircle,         roles: ["admin","moderator"], section: "review" },
  { id: "archive",      label: "Archive",      Icon: Archive,         roles: ["admin","moderator"], section: "review" },
  { id: "teams",        label: "Teams",        Icon: Building2,       roles: ["admin"],              section: "admin" },
  { id: "users",        label: "Users",        Icon: Users,           roles: ["admin"],              section: "admin" },
  { id: "categories",   label: "Categories",   Icon: Folder,          roles: ["admin"],              section: "admin" },
  { id: "settings",     label: "Settings",     Icon: Settings,        roles: ["admin"],              section: "admin" },
  { id: "faq",          label: "FAQ",          Icon: HelpCircle,      roles: ["admin","moderator"],  section: "help" },
];
const SECTION_LABELS: Record<NavSect, string> = { main: "Main", review: "Review", admin: "Administration", help: "Help" };

// Basic User flat nav — no sections, no privileged items
const BASIC_NAV: { id: Screen; label: string; Icon: React.ElementType }[] = [
  { id: "search",    label: "Search",     Icon: Search },
  { id: "documents", label: "All Documents", Icon: FileText },
  { id: "favorites", label: "Favorites",  Icon: Star },
  { id: "faq",       label: "FAQ & Help", Icon: HelpCircle },
];

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function daysUntil(dateStr: string): number {
  const [mon, day, year] = dateStr.replace(",", "").split(" ");
  const months: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const d = new Date(parseInt(year), months[mon], parseInt(day));
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

function usersByIds(ids: string[]) { return USERS.filter(u => ids.includes(u.id)); }

/* ── Tiny reusable components ───────────────────────────────────────────────── */
function Avatar({ initials, size = "sm", className = "" }: { initials: string; size?: "sm"|"md"|"lg"; className?: string }) {
  const sz = size === "lg" ? "w-11 h-11 text-sm" : size === "md" ? "w-9 h-9 text-xs" : "w-7 h-7 text-xs";
  return <div className={`${sz} rounded-full bg-[#005758] text-white flex items-center justify-center font-semibold flex-shrink-0 font-[Plus_Jakarta_Sans] ${className}`}>{initials}</div>;
}

function StatusBadge({ status }: { status: DocStatus }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.txt} ${cfg.bg}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E2EFEF] text-[#005758] text-xs font-medium">
      {label}
      {onRemove && <button onClick={onRemove} className="hover:text-red-600 ml-0.5"><X size={10} /></button>}
    </span>
  );
}

function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-[#173536] font-[Plus_Jakarta_Sans] flex items-center gap-2">
        {title}
        {count !== undefined && <span className="text-sm font-normal text-[#587778]">({count})</span>}
      </h2>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-xl bg-[#EBF1F1] flex items-center justify-center mb-4">
        <Icon size={28} className="text-[#587778]" />
      </div>
      <p className="font-semibold text-[#173536] font-[Plus_Jakarta_Sans]">{title}</p>
      <p className="text-sm text-[#587778] mt-1 max-w-xs">{desc}</p>
    </div>
  );
}

/* ── Permission Denied Page ─────────────────────────────────────────────────── */
function PermissionDeniedPage({ ctx }: { ctx: Ctx }) {
  const dest: Screen = ctx.role === "basic" ? "documents" : "dashboard";
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-5">
        <Ban size={30} className="text-red-500" />
      </div>
      <h2 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans] mb-2">Access Restricted</h2>
      <p className="text-sm text-[#587778] max-w-sm mb-6 leading-relaxed">
        You don't have permission to view this page. This area is reserved for{" "}
        {ctx.role === "basic" ? "Moderators and Admins" : "Administrators"}.
      </p>
      <button
        onClick={() => ctx.nav(dest)}
        className="flex items-center gap-2 px-5 py-2.5 bg-[#005758] text-white rounded-lg text-sm font-semibold hover:bg-[#00696a] transition-colors"
      >
        <ArrowRight size={15} />
        Go to {dest === "documents" ? "All Documents" : "Dashboard"}
      </button>
    </div>
  );
}

/* ── No Team Access Screen ──────────────────────────────────────────────────── */
function NoTeamAccessScreen({ ctx }: { ctx: Ctx }) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [justRequested, setJustRequested] = useState<string | null>(null);

  function requestAccess(teamId: string, teamName: string) {
    setPending(p => [...p, teamId]);
    setJustRequested(teamName);
    setTimeout(() => setJustRequested(null), 3000);
  }

  const filtered = TEAMS.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.desc.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-full py-12 px-6">
      <div className="w-full max-w-lg">
        {/* Hero state */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-4 mx-auto">
            <Building2 size={30} className="text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans] mb-2">
            You don't have access to a team yet
          </h2>
          <p className="text-sm text-[#587778] leading-relaxed max-w-sm mx-auto">
            TDS documents are organized by team. Request access to one or more teams to browse approved documents.
            An administrator will review and approve your request.
          </p>
        </div>

        {/* Pending requests banner */}
        {pending.length > 0 && (
          <div className="mb-5 p-3 rounded-xl bg-[#E2EFEF] border border-[#005758]/20 flex items-start gap-3">
            <Clock size={16} className="text-[#005758] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#005758]">{pending.length} request{pending.length > 1 ? "s" : ""} pending approval</p>
              <p className="text-xs text-[#587778] mt-0.5">You'll receive a notification when an admin reviews your request.</p>
            </div>
          </div>
        )}

        {justRequested && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2">
            <CheckCircle size={15} className="text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-700">Access request sent for <strong>{justRequested}</strong></p>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a0b4b5]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search teams…"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]"
          />
        </div>

        {/* Teams list */}
        <div className="space-y-2.5">
          {filtered.map(team => {
            const isPending = pending.includes(team.id);
            return (
              <div key={team.id} className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4 flex items-start justify-between gap-4 hover:border-[#08BED5]/30 transition-colors">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#E2EFEF] flex items-center justify-center flex-shrink-0">
                    <Building2 size={17} className="text-[#005758]" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#173536] font-[Plus_Jakarta_Sans]">{team.name}</p>
                    <p className="text-xs text-[#587778] mt-0.5 leading-relaxed">{team.desc}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {team.cats.slice(0, 3).map(c => <Chip key={c} label={c} />)}
                      {team.cats.length > 3 && <span className="text-xs text-[#587778]">+{team.cats.length - 3}</span>}
                    </div>
                  </div>
                </div>
                {isPending ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700 flex-shrink-0 whitespace-nowrap">
                    <Clock size={11} />Pending
                  </span>
                ) : (
                  <button
                    onClick={() => requestAccess(team.id, team.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#005758] text-white text-xs font-semibold hover:bg-[#00696a] transition-colors flex-shrink-0 whitespace-nowrap"
                  >
                    <Send size={11} />Request Access
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-[#587778] mt-6">
          Questions? Contact your TDS administrator or ask in the{" "}
          <span className="text-[#08BED5] cursor-pointer hover:underline">TDS Support Webex Space</span>.
        </p>
      </div>
    </div>
  );
}

/* ── Login Screen ───────────────────────────────────────────────────────────── */
type LoginState = "idle" | "loading" | "invalid-domain" | "pending" | "suspended";

function LoginScreen({ onLogin }: { onLogin: (role: Role) => void }) {
  const [email, setEmail] = useState("");
  const [loginState, setLoginState] = useState<LoginState>("idle");
  const [showDemo, setShowDemo] = useState(false);

  function handleContinue() {
    if (!email.endsWith("@tdsynnex.com")) { setLoginState("invalid-domain"); return; }
    setLoginState("loading");
    setTimeout(() => {
      if (email === "pending@tdsynnex.com") setLoginState("pending");
      else if (email === "suspended@tdsynnex.com") setLoginState("suspended");
      else onLogin("admin");
    }, 1400);
  }

  return (
    <div className="min-h-screen bg-[#F5F8F8] flex flex-col items-center justify-center px-4">
      {/* Header */}
      <div className="mb-8 flex flex-col items-center">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-[#005758] flex items-center justify-center">
            <BookmarkLogo />
          </div>
          <span className="text-2xl font-bold text-[#005758] tracking-tight font-[Plus_Jakarta_Sans]">The Document Source</span>
        </div>
        <p className="text-sm text-[#587778]">TD SYNNEX Private Knowledge Platform</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-xl border border-[rgba(23,53,54,0.11)] shadow-sm p-8">
        <h1 className="text-xl font-semibold text-[#173536] mb-1 font-[Plus_Jakarta_Sans]">Sign in</h1>
        <p className="text-sm text-[#587778] mb-6">Use your TD SYNNEX Webex account to continue.</p>

        {loginState === "invalid-domain" && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
            <XCircle size={15} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">Only <strong>@tdsynnex.com</strong> accounts are permitted. Personal or external accounts are not supported.</p>
          </div>
        )}
        {loginState === "pending" && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <Clock size={15} className="text-amber-700 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700">Your account is <strong>pending approval</strong> from a TDS administrator. You will receive an email once access is granted.</p>
          </div>
        )}
        {loginState === "suspended" && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
            <Lock size={15} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">Your account has been <strong>suspended</strong>. Please contact your IT administrator or raise a ticket with the TDS team.</p>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#173536] mb-1.5 uppercase tracking-wide">Work Email</label>
          <input
            type="email"
            placeholder="you@tdsynnex.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setLoginState("idle"); }}
            onKeyDown={e => e.key === "Enter" && handleContinue()}
            className="w-full px-3 py-2.5 rounded-lg border border-[rgba(23,53,54,0.15)] bg-white text-[#173536] text-sm placeholder:text-[#a0b4b5] focus:outline-none focus:ring-2 focus:ring-[#08BED5] focus:border-transparent"
          />
        </div>

        <button
          onClick={handleContinue}
          disabled={loginState === "loading" || !email}
          className="w-full py-2.5 rounded-lg bg-[#005758] text-white font-semibold text-sm hover:bg-[#00696a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loginState === "loading" ? (
            <><RefreshCw size={15} className="animate-spin" /> Signing in via Webex…</>
          ) : (
            <><WebexIcon /> Continue with Webex</>
          )}
        </button>

        <div className="mt-6 pt-5 border-t border-[rgba(23,53,54,0.09)]">
          <button onClick={() => setShowDemo(!showDemo)} className="w-full text-xs text-[#587778] hover:text-[#005758] transition-colors flex items-center justify-center gap-1">
            <Info size={12} /> Demo access
            <ChevronDown size={12} className={`transition-transform ${showDemo ? "rotate-180" : ""}`} />
          </button>
          {showDemo && (
            <div className="mt-3 space-y-2">
              {(["admin","moderator","basic"] as Role[]).map(r => (
                <button key={r} onClick={() => onLogin(r)} className="w-full py-1.5 px-3 rounded-lg bg-[#E2EFEF] text-[#005758] text-xs font-medium hover:bg-[#cde4e4] transition-colors flex items-center gap-2">
                  <Shield size={12} /> Sign in as {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-6 text-xs text-[#587778]">Internal platform — authorized users only</p>
    </div>
  );
}

/* Webex icon SVG */
function WebexIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#00BF6F"/>
      <path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" fill="white"/>
    </svg>
  );
}

function BookmarkLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="white"/>
      <path d="M9 8h6M9 11h4" stroke="#08BED5" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────────────────── */
function Sidebar({ ctx, onClose }: { ctx: Ctx; onClose?: () => void }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const u = ctx.currentUser;

  const LogoHeader = () => (
    <div className="px-4 py-4 flex items-center justify-between border-b border-white/10 flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-white/15 flex items-center justify-center">
          <BookmarkLogo />
        </div>
        <span className="font-bold text-sm text-white font-[Plus_Jakarta_Sans] leading-tight">The Document<br/>Source</span>
      </div>
      {onClose && <button onClick={onClose} className="text-white/70 hover:text-white p-0.5 rounded"><X size={18} /></button>}
    </div>
  );

  const ProfileFooter = () => (
    <div className="border-t border-white/10 flex-shrink-0">
      <button
        onClick={() => setProfileOpen(!profileOpen)}
        className="w-full flex items-center gap-2.5 px-3 py-3 hover:bg-white/10 transition-colors text-left"
      >
        <Avatar initials={u.initials} size="sm" className="bg-white/20 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{u.name}</p>
          <p className="text-[10px] text-white/50 truncate capitalize">{u.role} · {u.teams.length > 0 ? u.teams[0] : "No team"}</p>
        </div>
        <ChevronUp size={13} className={`text-white/50 transition-transform flex-shrink-0 ${profileOpen ? "" : "rotate-180"}`} />
      </button>
      {profileOpen && (
        <div className="mx-2 mb-2 rounded-lg bg-white/10 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/10">
            <p className="text-xs text-white font-medium">{u.email}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {u.teams.length > 0
                ? u.teams.map(t => <span key={t} className="text-[10px] bg-white/10 text-white/70 rounded px-1.5 py-0.5">{t}</span>)
                : <span className="text-[10px] text-amber-400">No team assigned</span>}
            </div>
          </div>
          {ctx.role === "basic" && (
            <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors">
              <Send size={11} />My Team Requests
            </button>
          )}
          <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors">
            <LogOut size={11} />Sign Out
          </button>
        </div>
      )}
    </div>
  );

  /* ─ Basic User: flat minimal nav ─ */
  if (ctx.role === "basic") {
    return (
      <div className="flex flex-col h-full">
        <LogoHeader />
        <nav className="flex-1 overflow-y-auto py-4 px-2 scrollbar-hide">
          {BASIC_NAV.map(item => {
            const Icon = item.Icon;
            const isActive = ctx.currentScreen === item.id
              || (item.id === "documents" && ctx.currentScreen === "document-detail");
            return (
              <button
                key={item.id}
                onClick={() => { ctx.nav(item.id); onClose?.(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mb-0.5
                  ${isActive ? "bg-white/18 text-white shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
                style={isActive ? { backgroundColor: "rgba(255,255,255,0.18)" } : {}}
              >
                <Icon size={17} className="flex-shrink-0" />
                <span>{item.label}</span>
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#08BED5]" />}
              </button>
            );
          })}

          {/* Team indicator */}
          <div className="mt-4 mx-1 px-3 py-3 rounded-lg bg-white/8 border border-white/10">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-2">My Teams</p>
            {ctx.noTeamDemo || u.teams.length === 0 ? (
              <p className="text-xs text-amber-400 flex items-center gap-1.5"><AlertTriangle size={11} />No team assigned</p>
            ) : (
              u.teams.map(t => (
                <p key={t} className="text-xs text-white/70 flex items-center gap-1.5 mb-1"><Building2 size={11} className="text-[#08BED5]" />{t}</p>
              ))
            )}
          </div>
        </nav>
        <ProfileFooter />
      </div>
    );
  }

  /* ─ Moderator / Admin: sectioned nav ─ */
  const sections = (["main","review","admin","help"] as NavSect[]);
  const visibleItems = NAV_ITEMS.filter(n => n.roles.includes(ctx.role));

  return (
    <div className="flex flex-col h-full">
      <LogoHeader />
      <nav className="flex-1 overflow-y-auto py-3 px-2 scrollbar-hide space-y-4">
        {sections.map(sect => {
          const items = visibleItems.filter(n => n.section === sect);
          if (!items.length) return null;
          return (
            <div key={sect}>
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">{SECTION_LABELS[sect]}</p>
              {items.map(item => {
                const Icon = item.Icon;
                const isActive = ctx.currentScreen === item.id
                  || (item.id === "documents" && ctx.currentScreen === "document-detail")
                  || (item.id === "review-queue" && ctx.currentScreen === "review-editor");
                return (
                  <button
                    key={item.id}
                    onClick={() => { ctx.nav(item.id); onClose?.(); }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all mb-0.5
                      ${isActive ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge && (
                      <span className="text-[10px] font-bold bg-[#08BED5] text-[#173536] rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <ProfileFooter />
    </div>
  );
}

/* ── Top Bar ────────────────────────────────────────────────────────────────── */
function TopBar({ ctx, role, setRole, onMenuClick, noTeamDemo, setNoTeamDemo }: {
  ctx: Ctx; role: Role; setRole: (r: Role) => void;
  onMenuClick: () => void; noTeamDemo: boolean; setNoTeamDemo: (v: boolean) => void;
}) {
  const screenLabels: Partial<Record<Screen, string>> = {
    dashboard: "Dashboard", search: "Search", documents: "All Documents",
    favorites: "Favorites", "review-queue": "Review Queue",
    "review-editor": "Review Editor", "document-detail": "Document",
    rejected: "Rejected", archive: "Archive", users: "User Management",
    teams: "Team Management", categories: "Categories",
    settings: "Settings", faq: "FAQ & Help",
  };

  const u = ctx.currentUser;

  return (
    <header className="h-14 bg-white border-b border-[rgba(23,53,54,0.1)] flex items-center px-4 gap-3 flex-shrink-0">
      <button onClick={onMenuClick} className="md:hidden text-[#587778] hover:text-[#173536] p-1 rounded"><Menu size={20} /></button>

      {/* Breadcrumb */}
      <div className="flex-1 flex items-center gap-1.5 text-sm min-w-0">
        <span className="text-[#587778] hidden sm:block flex-shrink-0">TDS</span>
        <ChevronRight size={14} className="text-[#a0b4b5] hidden sm:block flex-shrink-0" />
        <span className="font-semibold text-[#173536] font-[Plus_Jakarta_Sans] truncate">
          {screenLabels[ctx.currentScreen] ?? "Dashboard"}
        </span>
      </div>

      {/* Demo: no-team toggle for Basic role */}
      {role === "basic" && (
        <button
          onClick={() => setNoTeamDemo(!noTeamDemo)}
          title="Demo: toggle no-team state"
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors
            ${noTeamDemo ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-[#EBF1F1] border-transparent text-[#587778] hover:text-[#173536]"}`}
        >
          <Building2 size={12} />{noTeamDemo ? "No Team (demo)" : "Has Team"}
        </button>
      )}

      {/* Role switcher - demo feature */}
      <div className="flex items-center gap-0.5 bg-[#EBF1F1] rounded-lg p-0.5">
        {(["admin","moderator","basic"] as Role[]).map(r => (
          <button key={r} onClick={() => setRole(r)}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-all capitalize
              ${role === r ? "bg-white text-[#005758] shadow-sm font-semibold" : "text-[#587778] hover:text-[#173536]"}`}
          >
            {r}
          </button>
        ))}
      </div>

      <button className="relative text-[#587778] hover:text-[#173536] p-1.5 rounded-lg hover:bg-[#EBF1F1] transition-colors flex-shrink-0">
        <Bell size={17} />
        {role !== "basic" && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#08BED5]" />}
      </button>
      <Avatar initials={u.initials} size="sm" />
    </header>
  );
}

/* ── Dashboard Screen ───────────────────────────────────────────────────────── */
function DashboardScreen({ ctx }: { ctx: Ctx }) {
  const userTeams = ctx.currentUser.teams;
  // Moderators see only their teams; Admins see everything
  const scopedDocs = ctx.role === "moderator"
    ? ctx.docs.filter(d => d.teams.some(t => userTeams.includes(t)))
    : ctx.docs;

  const stats = [
    { label: "Awaiting Review",   value: scopedDocs.filter(d => d.status === "pending").length,        color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200",  Icon: Clock },
    { label: "Change Requests",   value: scopedDocs.filter(d => d.status === "change_request").length, color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",   Icon: Pencil },
    { label: "Processing Failed", value: scopedDocs.filter(d => d.status === "failed").length,         color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", Icon: AlertCircle },
    { label: "Rejected",          value: scopedDocs.filter(d => d.status === "rejected").length,       color: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    Icon: XCircle },
    { label: "Approaching Purge", value: scopedDocs.filter(d => d.expiresAt && daysUntil(d.expiresAt) <= 14).length, color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200", Icon: AlertTriangle },
  ];

  const reviewDocs = scopedDocs.filter(d => ["pending","change_request","failed"].includes(d.status));

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#173536] font-[Plus_Jakarta_Sans]">Dashboard</h1>
        <p className="text-sm text-[#587778] mt-0.5">
          {ctx.role === "moderator"
            ? `Showing activity for your teams: ${userTeams.join(", ")}`
            : "Overview of all document review activity across all teams"}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg} ${s.border}`}>
            <div className="flex items-center gap-2 mb-2">
              <s.Icon size={15} className={s.color} />
              <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
            </div>
            <p className={`text-3xl font-bold font-[Plus_Jakarta_Sans] ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Review queue preview */}
      <SectionHeader
        title="Needs Attention"
        count={reviewDocs.length}
        action={
          <button onClick={() => ctx.nav("review-queue")} className="text-sm text-[#08BED5] hover:text-[#005758] font-medium flex items-center gap-1">
            View all <ChevronRight size={14} />
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {reviewDocs.map(doc => (
          <DashboardCard key={doc.id} doc={doc} ctx={ctx} />
        ))}
        {reviewDocs.length === 0 && (
          <div className="col-span-3">
            <EmptyState icon={CheckCircle} title="All clear" desc="No documents require attention right now." />
          </div>
        )}
      </div>

      {/* Recent approved */}
      <div className="mt-8">
        <SectionHeader title="Recently Approved" count={scopedDocs.filter(d => d.status === "approved").length} />
        <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] overflow-hidden">
          {scopedDocs.filter(d => d.status === "approved").map((doc, i, arr) => (
            <div key={doc.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-[#F5F8F8] cursor-pointer transition-colors ${i < arr.length-1 ? "border-b border-[rgba(23,53,54,0.08)]" : ""}`}
              onClick={() => ctx.nav("document-detail", doc)}>
              <CheckCircle size={15} className="text-emerald-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#173536] truncate">{doc.title}</p>
                <p className="text-xs text-[#587778]">{doc.author} · {doc.updatedAt}</p>
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                {doc.teams.map(t => <Chip key={t} label={t} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardCard({ doc, ctx }: { doc: TDSDoc; ctx: Ctx }) {
  return (
    <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4 hover:shadow-md hover:border-[#08BED5]/30 transition-all cursor-pointer group"
      onClick={() => ctx.nav("review-editor", doc)}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <StatusBadge status={doc.status} />
        <span className="text-xs text-[#587778] whitespace-nowrap">{doc.updatedAt}</span>
      </div>
      <h3 className="text-sm font-semibold text-[#173536] font-[Plus_Jakarta_Sans] leading-snug mb-3 line-clamp-2 group-hover:text-[#005758] transition-colors">{doc.title}</h3>
      <div className="space-y-1.5 text-xs text-[#587778]">
        <div className="flex items-center gap-1.5"><MessageSquare size={11} /><span className="truncate">{doc.webexSpace}</span></div>
        <div className="flex items-center gap-1.5"><Users size={11} /><span className="truncate">{doc.requester}</span></div>
        <div className="flex items-center gap-1.5"><Globe size={11} /><span>{doc.teams.join(", ")}</span></div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        {doc.tags.slice(0, 3).map(t => <Chip key={t} label={t} />)}
        {doc.tags.length > 3 && <span className="text-xs text-[#587778]">+{doc.tags.length - 3}</span>}
      </div>
      {doc.attachments.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-xs text-[#587778]">
          <Paperclip size={11} /><span>{doc.attachments.length} attachment{doc.attachments.length > 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

/* ── Review Queue Screen ────────────────────────────────────────────────────── */
function ReviewQueueScreen({ ctx }: { ctx: Ctx }) {
  const [filter, setFilter] = useState<DocStatus | "all">("all");

  // Moderators only see docs from their own teams
  const userTeams = ctx.currentUser.teams;
  const queueBase = ctx.docs.filter(d => {
    if (!["pending","change_request","failed"].includes(d.status)) return false;
    if (ctx.role === "moderator" && !d.teams.some(t => userTeams.includes(t))) return false;
    return true;
  });

  const filtered = queueBase.filter(d =>
    filter === "all" ? true : d.status === filter
  );

  const tabs: { id: DocStatus | "all"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Awaiting Review" },
    { id: "change_request", label: "Change Requests" },
    { id: "failed", label: "Processing Failed" },
  ];

  const teamNote = ctx.role === "moderator"
    ? `Showing documents from your teams: ${userTeams.join(", ")}`
    : null;

  return (
    <div className="p-6 max-w-5xl">
      <SectionHeader title="Review Queue" count={queueBase.length} />

      {/* Team scope note for Moderators */}
      {teamNote && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#E2EFEF] border border-[#005758]/15 text-xs text-[#005758]">
          <Shield size={13} /><span>{teamNote}</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 border-b border-[rgba(23,53,54,0.1)]">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            className={`pb-2.5 px-3 text-sm font-medium transition-all border-b-2 -mb-px
              ${filter === t.id ? "border-[#08BED5] text-[#005758]" : "border-transparent text-[#587778] hover:text-[#173536]"}`}
          >
            {t.label}
            <span className="ml-1.5 text-xs bg-[#EBF1F1] text-[#587778] rounded-full px-1.5 py-0.5">
              {t.id === "all" ? queueBase.length : queueBase.filter(d => d.status === t.id).length}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map(doc => (
          <div key={doc.id} className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4 hover:border-[#08BED5]/40 hover:shadow-sm transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <StatusBadge status={doc.status} />
                  {doc.attachments.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-[#587778]">
                      <Paperclip size={11} />{doc.attachments.length} file{doc.attachments.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-[#173536] font-[Plus_Jakarta_Sans] mb-2 leading-snug">{doc.title}</h3>
                <div className="flex flex-wrap gap-4 text-xs text-[#587778]">
                  <span className="flex items-center gap-1"><MessageSquare size={11} />{doc.webexSpace}</span>
                  <span className="flex items-center gap-1"><Users size={11} />{doc.requester}</span>
                  <span className="flex items-center gap-1"><Clock size={11} />Updated {doc.updatedAt}</span>
                  <span className="flex items-center gap-1"><Globe size={11} />{doc.teams.join(", ")}</span>
                </div>
                {doc.notes && (
                  <p className="mt-2 text-xs text-[#587778] italic bg-[#F5F8F8] px-2 py-1.5 rounded border-l-2 border-[#08BED5]/40">
                    {doc.notes}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {doc.tags.map(t => <Chip key={t} label={t} />)}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => ctx.nav("review-editor", doc)}
                  className="px-3 py-1.5 rounded-lg bg-[#005758] text-white text-xs font-semibold hover:bg-[#00696a] transition-colors flex items-center gap-1.5">
                  <Pencil size={12} /> Review
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <EmptyState icon={ClipboardList} title="No items" desc="No documents match this filter." />}
      </div>
    </div>
  );
}

/* ── Review Editor Screen ───────────────────────────────────────────────────── */
function ReviewEditorScreen({ ctx }: { ctx: Ctx }) {
  const doc = ctx.selDoc!;
  const [title, setTitle] = useState(doc.title);
  const [problem, setProblem] = useState(doc.problem);
  const [summary, setSummary] = useState(doc.summary);
  const [steps, setSteps] = useState<string[]>(doc.steps);
  const [warnings, setWarnings] = useState<string[]>(doc.warnings);
  const [tags, setTags] = useState<string[]>(doc.tags);
  const [cats, setCats] = useState<string[]>(doc.categories);
  const [verified, setVerified] = useState(doc.verified);
  const [showTranscript, setShowTranscript] = useState(doc.showTranscript);
  const [notes, setNotes] = useState(doc.notes);
  const [tagInput, setTagInput] = useState("");
  const [saved, setSaved] = useState(false);

  const aiSuggestions = ["iosxe", "switching", "network-ops", "firmware-bug", "maintenance"].filter(s => !tags.includes(s));

  function addTag(t: string) {
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  }

  function save(newStatus?: DocStatus) {
    ctx.updateDoc(doc.id, { title, problem, summary, steps, warnings, tags, categories: cats, verified, showTranscript, notes, ...(newStatus ? { status: newStatus } : {}) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    if (newStatus === "approved" || newStatus === "rejected") ctx.back();
  }

  const allCats = ["Network", "Cisco", "Switching", "Security", "Fortinet", "VPN", "Cloud", "Microsoft", "Identity", "Collaboration", "Endpoint", "Meraki", "Juniper", "Routing", "Wireless"];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b border-[rgba(23,53,54,0.1)] px-4 py-2.5 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <button onClick={() => ctx.back()} className="text-[#587778] hover:text-[#173536] flex items-center gap-1 text-sm mr-2">
          <ChevronLeft size={15} /> Back
        </button>
        <StatusBadge status={doc.status} />
        <span className="text-sm font-semibold text-[#173536] flex-1 truncate font-[Plus_Jakarta_Sans]">{doc.title}</span>
        <div className="flex gap-2 items-center flex-wrap">
          {saved && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check size={12} />Saved</span>}
          <button onClick={() => save()} className="px-3 py-1.5 rounded-lg border border-[rgba(23,53,54,0.15)] text-sm font-medium text-[#173536] hover:bg-[#F5F8F8] transition-colors">Save Draft</button>
          <button onClick={() => save("approved")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-1.5"><CheckCircle size={13} />Approve</button>
          <button onClick={() => save("rejected")} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors flex items-center gap-1.5"><XCircle size={13} />Reject</button>
          <button onClick={() => save("archived")} className="px-3 py-1.5 rounded-lg border border-[rgba(23,53,54,0.15)] text-sm font-medium text-[#587778] hover:bg-[#F5F8F8] transition-colors"><Archive size={13} /></button>
          <button onClick={() => { ctx.updateDoc(doc.id, { status: "rejected" }); ctx.back(); }} className="px-3 py-1.5 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Webex transcript */}
        <div className="w-[42%] min-w-0 flex-shrink-0 border-r border-[rgba(23,53,54,0.1)] flex flex-col overflow-hidden bg-white">
          <div className="px-4 py-3 border-b border-[rgba(23,53,54,0.08)] flex items-center gap-2 flex-shrink-0">
            <MessageSquare size={14} className="text-[#08BED5]" />
            <span className="text-xs font-semibold text-[#173536] uppercase tracking-wide">Webex Transcript</span>
            <span className="ml-1 text-xs text-[#587778] bg-[#EBF1F1] rounded-full px-1.5">{doc.webexSpace}</span>
            <span className="ml-auto text-[10px] text-red-600 font-medium uppercase tracking-wide bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Read Only</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-hide">
            {doc.transcript.length > 0 ? doc.transcript.map(msg => (
              <div key={msg.id} className="flex gap-2.5">
                <Avatar initials={msg.author.split(" ").map(w => w[0]).join("")} size="sm" className={msg.isQ ? "bg-[#08BED5]" : "bg-[#005758]"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-xs font-semibold text-[#173536]">{msg.author}</span>
                    <span className="text-[10px] text-[#a0b4b5]">{msg.time}</span>
                    {msg.isQ && <span className="text-[10px] font-medium text-[#08BED5] bg-[#E2EFEF] rounded px-1">Q</span>}
                  </div>
                  <p className="text-sm text-[#173536] leading-relaxed bg-[#F5F8F8] rounded-lg px-3 py-2">{msg.content}</p>
                </div>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <MessageSquare size={24} className="text-[#a0b4b5] mb-2" />
                <p className="text-sm text-[#587778]">No transcript available for this document.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Editable form */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-[#F5F8F8] scrollbar-hide">
          <div className="p-5 space-y-5 max-w-2xl">
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Document Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5] font-[Plus_Jakarta_Sans] font-semibold" />
            </div>

            {/* Problem */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Problem Statement</label>
              <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={3}
                className="w-full px-3 py-2.5 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5] resize-none leading-relaxed" />
            </div>

            {/* Summary */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Solution Summary</label>
              <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3}
                className="w-full px-3 py-2.5 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5] resize-none leading-relaxed" />
            </div>

            {/* Steps */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Resolution Steps</label>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#005758] text-white text-xs flex items-center justify-center flex-shrink-0 mt-1.5 font-semibold">{i+1}</span>
                    <input value={step} onChange={e => { const s=[...steps]; s[i]=e.target.value; setSteps(s); }}
                      className="flex-1 px-3 py-2 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]" />
                    <button onClick={() => setSteps(steps.filter((_,j) => j!==i))} className="mt-2 text-[#a0b4b5] hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setSteps([...steps,""])} className="flex items-center gap-1.5 text-sm text-[#08BED5] hover:text-[#005758] font-medium mt-1">
                  <Plus size={14} />Add step
                </button>
              </div>
            </div>

            {/* Warnings */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Warnings & Cautions</label>
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                    <input value={w} onChange={e => { const s=[...warnings]; s[i]=e.target.value; setWarnings(s); }}
                      className="flex-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]" />
                    <button onClick={() => setWarnings(warnings.filter((_,j) => j!==i))} className="text-[#a0b4b5] hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setWarnings([...warnings,""])} className="flex items-center gap-1.5 text-sm text-[#08BED5] hover:text-[#005758] font-medium">
                  <Plus size={14} />Add warning
                </button>
              </div>
            </div>

            {/* Categories */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Categories</label>
              <div className="flex flex-wrap gap-2">
                {allCats.map(c => (
                  <button key={c} onClick={() => setCats(cats.includes(c) ? cats.filter(x => x!==c) : [...cats,c])}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                      ${cats.includes(c) ? "bg-[#005758] text-white border-[#005758]" : "bg-white text-[#587778] border-[rgba(23,53,54,0.15)] hover:border-[#005758]"}`}
                  >{c}</button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(t => <Chip key={t} label={t} onRemove={() => setTags(tags.filter(x => x!==t))} />)}
              </div>
              <div className="flex gap-2">
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput.trim()); }}}
                  placeholder="Add a tag…"
                  className="flex-1 px-3 py-2 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]" />
                <button onClick={() => addTag(tagInput.trim())} className="px-3 py-2 bg-[#E2EFEF] text-[#005758] rounded-lg text-sm font-medium hover:bg-[#cde4e4] transition-colors">Add</button>
              </div>
              {aiSuggestions.length > 0 && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-[#587778] flex items-center gap-1 uppercase tracking-wide"><Sparkles size={11} className="text-[#08BED5]" />AI suggestions:</span>
                  {aiSuggestions.slice(0,4).map(s => (
                    <button key={s} onClick={() => addTag(s)} className="px-2 py-0.5 rounded-full text-xs border border-dashed border-[#08BED5] text-[#08BED5] hover:bg-[#E2EFEF] transition-colors">+{s}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Verified + show transcript */}
            <div className="flex gap-4">
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <div onClick={() => setVerified(!verified)}
                  className={`w-10 h-5.5 rounded-full transition-colors relative ${verified ? "bg-emerald-500" : "bg-[#a0b4b5]"}`}
                  style={{ height: "22px", width: "40px" }}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${verified ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm font-medium text-[#173536]">Verified</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div onClick={() => setShowTranscript(!showTranscript)}
                  className={`w-10 rounded-full transition-colors relative ${showTranscript ? "bg-[#005758]" : "bg-[#a0b4b5]"}`}
                  style={{ height: "22px", width: "40px" }}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showTranscript ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm font-medium text-[#173536]">Show transcript to Basic Users</span>
              </label>
            </div>

            {/* Teams */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Teams</label>
              <div className="flex flex-wrap gap-2">
                {TEAMS.map(t => (
                  <button key={t.id} onClick={() => {}}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                      ${doc.teams.includes(t.name) ? "bg-[#005758] text-white border-[#005758]" : "bg-white text-[#587778] border-[rgba(23,53,54,0.15)] hover:border-[#005758]"}`}
                  >{t.name}</button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Reviewer Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Internal notes visible only to reviewers and admins…"
                className="w-full px-3 py-2.5 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5] resize-none leading-relaxed placeholder:text-[#a0b4b5]" />
            </div>

            {/* Attachments */}
            {doc.attachments.length > 0 && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Attachments</label>
                <div className="space-y-1.5">
                  {doc.attachments.map(f => (
                    <div key={f} className="flex items-center gap-2 px-3 py-2 bg-white border border-[rgba(23,53,54,0.12)] rounded-lg">
                      <Paperclip size={13} className="text-[#587778]" />
                      <span className="text-sm text-[#173536] flex-1 truncate">{f}</span>
                      <button className="text-[#587778] hover:text-[#005758]"><Download size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Documents Screen ───────────────────────────────────────────────────────── */
function DocumentsScreen({ ctx, initialSearch = "", favoriteOnly = false }: { ctx: Ctx; initialSearch?: string; favoriteOnly?: boolean }) {
  const [search, setSearch] = useState(initialSearch);
  const [filterTeam, setFilterTeam] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterStatus, setFilterStatus] = useState<DocStatus | "">("");
  const [showFilters, setShowFilters] = useState(false);

  const userTeams = ctx.currentUser.teams;
  const isBasic = ctx.role === "basic";
  const hasNoTeam = isBasic && (ctx.noTeamDemo || userTeams.length === 0);

  // Basic with no team membership → hand off to no-team screen
  if (hasNoTeam && !favoriteOnly) {
    return <NoTeamAccessScreen ctx={ctx} />;
  }

  const docs = useMemo(() => {
    return ctx.docs.filter(d => {
      // Basic users: only approved docs from their teams
      if (isBasic) {
        if (d.status !== "approved") return false;
        if (!d.teams.some(t => userTeams.includes(t))) return false;
      }
      if (favoriteOnly && !d.isFavorite) return false;
      if (filterTeam && !d.teams.includes(filterTeam)) return false;
      if (filterCat && !d.categories.includes(filterCat)) return false;
      if (filterStatus && d.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        return d.title.toLowerCase().includes(q) || d.problem.toLowerCase().includes(q)
          || d.tags.some(t => t.includes(q)) || d.categories.some(c => c.toLowerCase().includes(q));
      }
      return true;
    });
  }, [ctx.docs, isBasic, userTeams, search, filterTeam, filterCat, filterStatus, favoriteOnly]);

  // Basic users only see teams they belong to; Mod/Admin see all
  const allTeams = isBasic
    ? userTeams
    : [...new Set(ctx.docs.flatMap(d => d.teams))];
  const allCats = [...new Set(ctx.docs.flatMap(d => d.categories))];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans]">
          {favoriteOnly ? "Favorites" : isBasic ? "All Documents" : "Document Library"}
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a0b4b5]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…"
              className="pl-9 pr-3 py-2 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5] w-64" />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
              ${showFilters ? "bg-[#005758] text-white border-[#005758]" : "bg-white border-[rgba(23,53,54,0.15)] text-[#587778] hover:border-[#005758]"}`}>
            <Filter size={14} />Filters
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-5 p-4 bg-white rounded-xl border border-[rgba(23,53,54,0.1)] grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Team</label>
            <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
              className="w-full px-2.5 py-2 bg-[#F5F8F8] border border-[rgba(23,53,54,0.12)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]">
              <option value="">All teams</option>
              {allTeams.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Category</label>
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="w-full px-2.5 py-2 bg-[#F5F8F8] border border-[rgba(23,53,54,0.12)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]">
              <option value="">All categories</option>
              {allCats.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {!isBasic && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#173536] mb-1.5">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as DocStatus | "")}
                className="w-full px-2.5 py-2 bg-[#F5F8F8] border border-[rgba(23,53,54,0.12)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]">
                <option value="">All statuses</option>
                {Object.entries(STATUS_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <button onClick={() => { setFilterTeam(""); setFilterCat(""); setFilterStatus(""); }} className="text-sm text-[#587778] hover:text-[#173536] font-medium">Clear filters</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {docs.map(doc => <DocCard key={doc.id} doc={doc} ctx={ctx} />)}
        {docs.length === 0 && (
          <div className="col-span-3">
            <EmptyState icon={FileText} title="No documents found" desc={search ? "Try different search terms or clear your filters." : "No documents are available yet."} />
          </div>
        )}
      </div>
    </div>
  );
}

function DocCard({ doc, ctx }: { doc: TDSDoc; ctx: Ctx }) {
  return (
    <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4 hover:shadow-md hover:border-[#08BED5]/30 transition-all cursor-pointer group flex flex-col"
      onClick={() => ctx.nav("document-detail", doc)}>
      <div className="flex items-center justify-between mb-2">
        <StatusBadge status={doc.status} />
        <button onClick={e => { e.stopPropagation(); ctx.updateDoc(doc.id, { isFavorite: !doc.isFavorite }); }}
          className={`p-1 rounded transition-colors ${doc.isFavorite ? "text-amber-500" : "text-[#a0b4b5] hover:text-amber-500"}`}>
          <Star size={15} fill={doc.isFavorite ? "currentColor" : "none"} />
        </button>
      </div>
      <h3 className="text-sm font-semibold text-[#173536] font-[Plus_Jakarta_Sans] leading-snug mb-2 group-hover:text-[#005758] transition-colors line-clamp-2 flex-1">{doc.title}</h3>
      <p className="text-xs text-[#587778] line-clamp-2 mb-3 leading-relaxed">{doc.problem}</p>
      <div className="flex flex-wrap gap-1 mb-3">
        {doc.categories.slice(0,3).map(c => <Chip key={c} label={c} />)}
      </div>
      <div className="pt-3 border-t border-[rgba(23,53,54,0.07)] flex items-center justify-between text-xs text-[#587778]">
        <span className="flex items-center gap-1"><Users size={11} />{doc.author}</span>
        <span>{doc.updatedAt}</span>
      </div>
    </div>
  );
}

/* ── Document Detail Screen ─────────────────────────────────────────────────── */
function DocumentDetailScreen({ ctx }: { ctx: Ctx }) {
  const doc = ctx.selDoc!;
  const [changeNote, setChangeNote] = useState("");
  const [showChange, setShowChange] = useState(false);

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-5">
        <button onClick={() => ctx.back()} className="text-sm text-[#587778] hover:text-[#173536] flex items-center gap-1 mb-3"><ChevronLeft size={14} />Back</button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={doc.status} />
              {doc.verified && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200"><CheckCircle size={11} />Verified</span>}
            </div>
            <h1 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans] leading-snug">{doc.title}</h1>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => ctx.updateDoc(doc.id, { isFavorite: !doc.isFavorite })}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
                ${doc.isFavorite ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-white border-[rgba(23,53,54,0.15)] text-[#587778] hover:border-amber-300"}`}>
              <Star size={14} fill={doc.isFavorite ? "currentColor" : "none"} />
              {doc.isFavorite ? "Saved" : "Save"}
            </button>
            {(ctx.role === "admin" || ctx.role === "moderator") && (
              <button onClick={() => ctx.nav("review-editor", doc)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#005758] text-white text-sm font-semibold hover:bg-[#00696a] transition-colors">
                <Pencil size={14} />Edit
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#587778]">
          <span className="flex items-center gap-1"><Users size={11} />Author: <strong className="text-[#173536]">{doc.author}</strong></span>
          <span className="flex items-center gap-1"><MessageSquare size={11} />Source: <strong className="text-[#173536]">{doc.webexSpace}</strong></span>
          <span className="flex items-center gap-1"><Globe size={11} />Teams: <strong className="text-[#173536]">{doc.teams.join(", ")}</strong></span>
          <span className="flex items-center gap-1"><Clock size={11} />Updated: <strong className="text-[#173536]">{doc.updatedAt}</strong></span>
        </div>
      </div>

      <div className="space-y-5">
        {/* Problem */}
        <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-2">Problem</h2>
          <p className="text-sm text-[#173536] leading-relaxed">{doc.problem}</p>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-2">Solution Summary</h2>
          <p className="text-sm text-[#173536] leading-relaxed">{doc.summary}</p>
        </div>

        {/* Steps */}
        <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-3">Resolution Steps</h2>
          <ol className="space-y-3">
            {doc.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[#005758] text-white text-xs flex items-center justify-center flex-shrink-0 font-bold mt-0.5">{i+1}</span>
                <p className="text-sm text-[#173536] leading-relaxed pt-0.5 font-mono bg-[#F5F8F8] rounded-lg px-3 py-2 flex-1">{step}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Warnings */}
        {doc.warnings.length > 0 && (
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-3 flex items-center gap-1.5"><AlertTriangle size={13} />Warnings & Cautions</h2>
            <ul className="space-y-2">
              {doc.warnings.map((w, i) => (
                <li key={i} className="flex gap-2 text-sm text-amber-800"><span className="flex-shrink-0 mt-0.5">⚠</span>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Metadata row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-2">Categories & Tags</h2>
            <div className="flex flex-wrap gap-1.5">
              {doc.categories.map(c => <Chip key={c} label={c} />)}
              {doc.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EBF1F1] text-[#587778] text-xs">
                  <Tag size={9} />{t}
                </span>
              ))}
            </div>
          </div>
          {doc.attachments.length > 0 && (
            <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-2">Attachments</h2>
              {doc.attachments.map(f => (
                <div key={f} className="flex items-center gap-2 py-1.5">
                  <Paperclip size={12} className="text-[#587778]" />
                  <span className="text-sm text-[#173536] flex-1 truncate">{f}</span>
                  <button className="text-[#08BED5] hover:text-[#005758] text-xs font-medium flex items-center gap-1"><Download size={12} />Download</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transcript (if enabled) */}
        {doc.showTranscript && doc.transcript.length > 0 && (
          <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-4 flex items-center gap-1.5"><MessageSquare size={13} />Source Transcript — {doc.webexSpace}</h2>
            <div className="space-y-4 max-h-80 overflow-y-auto scrollbar-hide">
              {doc.transcript.map(msg => (
                <div key={msg.id} className="flex gap-2.5">
                  <Avatar initials={msg.author.split(" ").map(w=>w[0]).join("")} size="sm" className={msg.isQ ? "bg-[#08BED5]" : "bg-[#005758]"} />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-semibold text-[#173536]">{msg.author}</span>
                      <span className="text-[10px] text-[#a0b4b5]">{msg.time}</span>
                    </div>
                    <p className="text-sm text-[#173536] leading-relaxed bg-[#F5F8F8] rounded-lg px-3 py-2">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request change */}
        {ctx.role === "basic" && (
          <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778] mb-3">Request a Change</h2>
            {!showChange ? (
              <button onClick={() => setShowChange(true)} className="flex items-center gap-1.5 text-sm text-[#08BED5] hover:text-[#005758] font-medium">
                <Pencil size={13} />Submit a correction or update request
              </button>
            ) : (
              <div className="space-y-2">
                <textarea value={changeNote} onChange={e => setChangeNote(e.target.value)} rows={3} placeholder="Describe the issue or correction needed…"
                  className="w-full px-3 py-2.5 border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5] resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => { ctx.updateDoc(doc.id, { status: "change_request", notes: changeNote }); setShowChange(false); setChangeNote(""); }}
                    className="px-4 py-2 bg-[#005758] text-white rounded-lg text-sm font-semibold hover:bg-[#00696a] transition-colors">Submit</button>
                  <button onClick={() => { setShowChange(false); setChangeNote(""); }} className="px-4 py-2 border border-[rgba(23,53,54,0.15)] rounded-lg text-sm text-[#587778] hover:bg-[#F5F8F8] transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Rejected Screen ────────────────────────────────────────────────────────── */
function RejectedScreen({ ctx }: { ctx: Ctx }) {
  const docs = ctx.docs.filter(d => d.status === "rejected");
  return (
    <div className="p-6 max-w-4xl">
      <SectionHeader title="Rejected Documents" count={docs.length} />
      <p className="text-sm text-[#587778] mb-5">Rejected documents are permanently deleted after 30 days. Restore to move back to review queue.</p>
      <div className="space-y-3">
        {docs.map(doc => <ExpiredCard key={doc.id} doc={doc} ctx={ctx} />)}
        {docs.length === 0 && <EmptyState icon={XCircle} title="No rejected documents" desc="Documents that are rejected will appear here with a 30-day purge countdown." />}
      </div>
    </div>
  );
}

/* ── Archive Screen ─────────────────────────────────────────────────────────── */
function ArchiveScreen({ ctx }: { ctx: Ctx }) {
  const docs = ctx.docs.filter(d => d.status === "archived");
  return (
    <div className="p-6 max-w-4xl">
      <SectionHeader title="Archive" count={docs.length} />
      <p className="text-sm text-[#587778] mb-5">Archived documents are purged after 90 days unless restored. Restore moves a document back to approved status.</p>
      <div className="space-y-3">
        {docs.map(doc => <ExpiredCard key={doc.id} doc={doc} ctx={ctx} isArchive />)}
        {docs.length === 0 && <EmptyState icon={Archive} title="Archive is empty" desc="Documents moved to the archive will appear here." />}
      </div>
    </div>
  );
}

function ExpiredCard({ doc, ctx, isArchive = false }: { doc: TDSDoc; ctx: Ctx; isArchive?: boolean }) {
  const days = doc.expiresAt ? daysUntil(doc.expiresAt) : 30;
  const urgent = days <= 7;
  return (
    <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <StatusBadge status={doc.status} />
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border
              ${urgent ? "text-red-700 bg-red-50 border-red-200" : "text-amber-700 bg-amber-50 border-amber-200"}`}>
              <AlertTriangle size={11} />{days} days until purge
            </span>
          </div>
          <h3 className="font-semibold text-[#173536] font-[Plus_Jakarta_Sans] mb-1 leading-snug">{doc.title}</h3>
          <p className="text-xs text-[#587778]">{doc.requester} · {doc.webexSpace} · Updated {doc.updatedAt}</p>
          {doc.notes && (
            <p className="mt-2 text-xs text-[#587778] italic bg-[#F5F8F8] px-2 py-1.5 rounded border-l-2 border-red-300">{doc.notes}</p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => ctx.nav("document-detail", doc)} className="px-3 py-1.5 rounded-lg border border-[rgba(23,53,54,0.15)] text-xs font-medium text-[#587778] hover:bg-[#F5F8F8] transition-colors flex items-center gap-1">
            <Eye size={12} />View
          </button>
          <button onClick={() => ctx.updateDoc(doc.id, { status: isArchive ? "approved" : "pending", expiresAt: undefined })}
            className="px-3 py-1.5 rounded-lg bg-[#005758] text-white text-xs font-semibold hover:bg-[#00696a] transition-colors flex items-center gap-1">
            <RotateCcw size={12} />{isArchive ? "Restore" : "Send to Review"}
          </button>
          <button onClick={() => {}}
            className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1">
            <Trash2 size={12} />Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Users Screen ───────────────────────────────────────────────────────────── */
function UsersScreen({ ctx }: { ctx: Ctx }) {
  const [search, setSearch] = useState("");
  const userStatusCfg: Record<AppUser["status"], { label: string; cls: string }> = {
    active:    { label: "Active",    cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    pending:   { label: "Pending",   cls: "text-amber-700 bg-amber-50 border-amber-200" },
    suspended: { label: "Suspended", cls: "text-red-700 bg-red-50 border-red-200" },
  };
  const roleColors: Record<Role, string> = {
    admin:     "text-purple-700 bg-purple-50 border-purple-200",
    moderator: "text-blue-700 bg-blue-50 border-blue-200",
    basic:     "text-gray-600 bg-gray-50 border-gray-200",
  };

  const filtered = USERS.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <SectionHeader title="User Management" count={USERS.length} />
        <div className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a0b4b5]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…"
              className="pl-8 pr-3 py-2 bg-white border border-[rgba(23,53,54,0.15)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#08BED5] w-52" />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-[#005758] text-white rounded-lg text-sm font-semibold hover:bg-[#00696a] transition-colors">
            <UserPlus size={14} />Invite User
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(23,53,54,0.08)] bg-[#F5F8F8]">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#587778]">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#587778] hidden md:table-cell">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#587778] hidden lg:table-cell">Teams</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#587778]">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#587778] hidden md:table-cell">Joined</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => (
              <tr key={u.id} className={`hover:bg-[#F5F8F8] transition-colors ${i < filtered.length-1 ? "border-b border-[rgba(23,53,54,0.06)]" : ""}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={u.initials} size="sm" />
                    <div>
                      <p className="font-medium text-[#173536]">{u.name}</p>
                      <p className="text-xs text-[#587778]">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium capitalize ${roleColors[u.role]}`}>
                    <Shield size={10} />{u.role}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {u.teams.map(t => <Chip key={t} label={t} />)}
                    {u.teams.length === 0 && <span className="text-xs text-[#a0b4b5]">No teams</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${userStatusCfg[u.status].cls}`}>
                    {userStatusCfg[u.status].label}
                  </span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-xs text-[#587778]">{u.joined}</td>
                <td className="px-4 py-3 text-right">
                  <button className="text-[#587778] hover:text-[#173536] p-1 rounded hover:bg-[#EBF1F1] transition-colors"><MoreHorizontal size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending access requests */}
      <div className="mt-6">
        <h2 className="text-base font-semibold text-[#173536] font-[Plus_Jakarta_Sans] mb-3">Access Requests</h2>
        <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Avatar initials="DO" size="sm" className="bg-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-[#173536]">David Okafor <span className="font-normal text-[#587778]">requests access to</span> Network Infrastructure</p>
            <p className="text-xs text-[#587778]">david.okafor@tdsynnex.com · Submitted Nov 22, 2024</p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors">Approve</button>
            <button className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">Deny</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Teams Screen ───────────────────────────────────────────────────────────── */
function TeamsScreen({ ctx }: { ctx: Ctx }) {
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans]">Team Management</h1>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-[#005758] text-white rounded-lg text-sm font-semibold hover:bg-[#00696a] transition-colors">
          <Plus size={14} />New Team
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {TEAMS.map(team => (
          <div key={team.id} className={`bg-white rounded-xl border cursor-pointer transition-all p-5 hover:shadow-md
            ${selectedTeam?.id === team.id ? "border-[#08BED5] shadow-md" : "border-[rgba(23,53,54,0.1)] hover:border-[#08BED5]/30"}`}
            onClick={() => setSelectedTeam(selectedTeam?.id === team.id ? null : team)}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#E2EFEF] flex items-center justify-center">
                <Building2 size={20} className="text-[#005758]" />
              </div>
              <span className="text-xs text-[#587778] bg-[#F5F8F8] px-2 py-0.5 rounded border border-[rgba(23,53,54,0.08)]">{team.members.length} members</span>
            </div>
            <h3 className="font-bold text-[#173536] font-[Plus_Jakarta_Sans] mb-1">{team.name}</h3>
            <p className="text-xs text-[#587778] mb-4 leading-relaxed">{team.desc}</p>

            {selectedTeam?.id === team.id && (
              <div className="border-t border-[rgba(23,53,54,0.08)] pt-4 space-y-4">
                {/* Members */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#587778] mb-2">Members</p>
                  <div className="space-y-1.5">
                    {usersByIds(team.members).map(u => (
                      <div key={u.id} className="flex items-center gap-2">
                        <Avatar initials={u.initials} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#173536] truncate">{u.name}</p>
                          <p className="text-[10px] text-[#587778] capitalize">{u.role}</p>
                        </div>
                      </div>
                    ))}
                    {team.members.length === 0 && <p className="text-xs text-[#a0b4b5]">No members yet</p>}
                  </div>
                </div>

                {/* Pinned spaces */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#587778] mb-2">Pinned Webex Spaces</p>
                  {team.spaces.map(s => (
                    <div key={s} className="flex items-center gap-1.5 py-1 text-xs text-[#173536]">
                      <MessageSquare size={11} className="text-[#08BED5]" />{s}
                    </div>
                  ))}
                </div>

                {/* Categories */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#587778] mb-2">Categories</p>
                  <div className="flex flex-wrap gap-1">
                    {team.cats.map(c => <Chip key={c} label={c} />)}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button className="flex-1 py-1.5 rounded-lg border border-[rgba(23,53,54,0.15)] text-xs font-medium text-[#587778] hover:bg-[#F5F8F8] transition-colors flex items-center justify-center gap-1"><Pencil size={11} />Edit</button>
                  <button className="flex-1 py-1.5 rounded-lg border border-[rgba(23,53,54,0.15)] text-xs font-medium text-[#587778] hover:bg-[#F5F8F8] transition-colors flex items-center justify-center gap-1"><UserPlus size={11} />Add Member</button>
                </div>
              </div>
            )}

            {selectedTeam?.id !== team.id && (
              <div className="flex flex-wrap gap-1">
                {team.cats.slice(0,4).map(c => <Chip key={c} label={c} />)}
                {team.cats.length > 4 && <span className="text-xs text-[#587778]">+{team.cats.length-4}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Audit history */}
      <div className="mt-8 max-w-3xl">
        <h2 className="text-base font-semibold text-[#173536] font-[Plus_Jakarta_Sans] mb-3">Recent Audit Events</h2>
        <div className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] overflow-hidden">
          {[
            { user: "Sarah Chen", action: "Added David Okafor to Enterprise Cloud", time: "Nov 22, 2024 · 3:12 PM" },
            { user: "Sarah Chen", action: "Removed Lisa Park from Network Infrastructure", time: "Nov 20, 2024 · 10:05 AM" },
            { user: "Jamie Torres", action: "Updated Security team categories", time: "Nov 18, 2024 · 2:40 PM" },
            { user: "Sarah Chen", action: "Created Unified Communications team", time: "Nov 15, 2024 · 9:00 AM" },
          ].map((e, i, arr) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i < arr.length-1 ? "border-b border-[rgba(23,53,54,0.06)]" : ""}`}>
              <div className="w-1.5 h-1.5 rounded-full bg-[#08BED5] flex-shrink-0" />
              <p className="text-sm text-[#173536] flex-1"><strong>{e.user}</strong> {e.action}</p>
              <span className="text-xs text-[#587778] whitespace-nowrap">{e.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Categories Screen ──────────────────────────────────────────────────────── */
function CategoriesScreen({ ctx }: { ctx: Ctx }) {
  const allCats = [...new Set(ctx.docs.flatMap(d => d.categories))].sort();
  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans]">Categories</h1>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-[#005758] text-white rounded-lg text-sm font-semibold hover:bg-[#00696a] transition-colors"><Plus size={14} />Add Category</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {allCats.map(cat => (
          <div key={cat} className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] p-4 flex items-center justify-between group hover:border-[#08BED5]/30 hover:shadow-sm transition-all">
            <div>
              <p className="font-semibold text-[#173536] text-sm">{cat}</p>
              <p className="text-xs text-[#587778]">{ctx.docs.filter(d => d.categories.includes(cat)).length} docs</p>
            </div>
            <button className="opacity-0 group-hover:opacity-100 text-[#587778] hover:text-[#173536] transition-all"><Pencil size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Settings Screen ────────────────────────────────────────────────────────── */
function SettingsScreen({ ctx }: { ctx: Ctx }) {
  const settings = [
    { section: "Document Lifecycle", items: [
      { label: "Rejected document purge period", value: "30 days", type: "select" },
      { label: "Archived document purge period", value: "90 days", type: "select" },
      { label: "Approaching purge warning threshold", value: "14 days", type: "select" },
    ]},
    { section: "AI & Automation", items: [
      { label: "Enable AI tag suggestions", value: true, type: "toggle" },
      { label: "Auto-generate draft on capture", value: true, type: "toggle" },
      { label: "Minimum Q&A length for capture", value: "3 messages", type: "select" },
    ]},
    { section: "Access & Permissions", items: [
      { label: "Require admin approval for new accounts", value: true, type: "toggle" },
      { label: "Allow Basic Users to request changes", value: true, type: "toggle" },
      { label: "Show transcript to Basic Users by default", value: false, type: "toggle" },
    ]},
  ];

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans] mb-6">Settings</h1>
      <div className="space-y-6">
        {settings.map(s => (
          <div key={s.section} className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] overflow-hidden">
            <div className="px-5 py-3 bg-[#F5F8F8] border-b border-[rgba(23,53,54,0.08)]">
              <h2 className="text-xs font-bold uppercase tracking-wide text-[#587778]">{s.section}</h2>
            </div>
            <div className="divide-y divide-[rgba(23,53,54,0.06)]">
              {s.items.map(item => (
                <div key={item.label} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <label className="text-sm font-medium text-[#173536]">{item.label}</label>
                  {item.type === "toggle" ? (
                    <div className={`w-10 h-5.5 rounded-full flex-shrink-0 cursor-pointer transition-colors relative ${item.value ? "bg-[#005758]" : "bg-[#a0b4b5]"}`}
                      style={{ height: "22px", width: "40px" }}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${item.value ? "translate-x-5" : "translate-x-0.5"}`} />
                    </div>
                  ) : (
                    <select className="px-2.5 py-1.5 bg-[#F5F8F8] border border-[rgba(23,53,54,0.12)] rounded-lg text-sm text-[#173536] focus:outline-none focus:ring-2 focus:ring-[#08BED5]">
                      <option>{item.value}</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <button className="px-5 py-2.5 bg-[#005758] text-white rounded-lg text-sm font-semibold hover:bg-[#00696a] transition-colors">Save Settings</button>
      </div>
    </div>
  );
}

/* ── FAQ Screen ─────────────────────────────────────────────────────────────── */
function FaqScreen({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<number | null>(null);
  const faqs = [
    { q: "What is The Document Source?", a: "TDS is TD SYNNEX's private knowledge platform that captures Webex Q&A threads, uses AI to create structured solution documents, and publishes approved content to a searchable internal library." },
    { q: "How are documents captured from Webex?", a: "Moderators or Admins can request that a specific Webex space thread be captured. TDS monitors pinned spaces and prompts when Q&A threads exceed the minimum length threshold. The AI draft is then sent to a Moderator for review." },
    { q: "What roles exist and what can each do?", a: "Basic Users: search and view approved documents, save favorites, and request changes. Moderators: review, approve, reject, and archive documents. Admins: all Moderator permissions plus user management, team configuration, and system settings." },
    { q: "How does the 30-day purge work?", a: "Rejected documents are automatically deleted after 30 days from the rejection date. Archived documents are purged after 90 days. Approaching purge is flagged at 14 days (configurable in Settings). Admins and Moderators can restore documents before purge." },
    { q: "Can Basic Users see the Webex transcript?", a: "Only if the Moderator or Admin checked 'Show transcript to Basic Users' during the review process. By default, transcripts are hidden from Basic Users." },
    { q: "How do I request access to a team?", a: "Submit a team access request from the User Management screen. An Admin will receive a notification and can approve or deny the request." },
    { q: "What happens when I submit a change request?", a: "Your change request note is sent to Moderators and Admins. The document status changes to Change Request and it appears in the Review Queue for attention." },
  ];
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-[#173536] font-[Plus_Jakarta_Sans] mb-6">FAQ & Help</h1>
      <div className="space-y-2">
        {faqs.map((f, i) => (
          <div key={i} className="bg-white rounded-xl border border-[rgba(23,53,54,0.1)] overflow-hidden">
            <button onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#F5F8F8] transition-colors">
              <span className="font-semibold text-sm text-[#173536] font-[Plus_Jakarta_Sans]">{f.q}</span>
              <ChevronDown size={16} className={`text-[#587778] flex-shrink-0 ml-3 transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
            {open === i && (
              <div className="px-5 pb-4 border-t border-[rgba(23,53,54,0.07)]">
                <p className="text-sm text-[#173536] leading-relaxed pt-3">{f.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 p-5 bg-[#005758] rounded-xl text-white">
        <p className="font-semibold font-[Plus_Jakarta_Sans] mb-1">Need more help?</p>
        <p className="text-sm text-white/75 mb-3">Reach out to the TDS team in the internal Webex space or raise a support ticket.</p>
        <button className="px-4 py-2 bg-white text-[#005758] rounded-lg text-sm font-semibold hover:bg-[#F5F8F8] transition-colors flex items-center gap-1.5">
          <MessageSquare size={14} />Open TDS Support Space
        </button>
      </div>
    </div>
  );
}

/* ── Search Screen ──────────────────────────────────────────────────────────── */
function SearchScreen({ ctx }: { ctx: Ctx }) {
  return <DocumentsScreen ctx={ctx} initialSearch="" />;
}

/* ── Favorites Screen ───────────────────────────────────────────────────────── */
function FavoritesScreen({ ctx }: { ctx: Ctx }) {
  return <DocumentsScreen ctx={ctx} favoriteOnly />;
}

/* ── App ────────────────────────────────────────────────────────────────────── */
export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [role, setRole] = useState<Role>("admin");
  const [selDoc, setSelDoc] = useState<TDSDoc | null>(null);
  const [docs, setDocs] = useState<TDSDoc[]>(INIT_DOCS);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevScreen, setPrevScreen] = useState<Screen>("dashboard");
  const [noTeamDemo, setNoTeamDemo] = useState(false);

  function nav(s: Screen, doc?: TDSDoc) {
    setPrevScreen(screen);
    if (doc !== undefined) setSelDoc(doc);
    setScreen(s);
    setMobileOpen(false);
  }

  function back() { nav(prevScreen); }

  function updateDoc(id: string, updates: Partial<TDSDoc>) {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    if (selDoc?.id === id) setSelDoc(prev => prev ? { ...prev, ...updates } : prev);
  }

  function handleRoleChange(r: Role) {
    setRole(r);
    setDocs(INIT_DOCS);
    setSelDoc(null);
    setNoTeamDemo(false);
    // Navigate to role-appropriate default screen
    setScreen(ROLE_DEFAULT_SCREEN[r]);
    setPrevScreen(ROLE_DEFAULT_SCREEN[r]);
  }

  const currentUser = ROLE_PROFILES[role];
  const ctx: Ctx = { nav, back, role, currentUser, docs, updateDoc, selDoc, currentScreen: screen, noTeamDemo };

  if (!loggedIn) {
    return (
      <LoginScreen
        onLogin={r => {
          setRole(r);
          setScreen(ROLE_DEFAULT_SCREEN[r]);
          setLoggedIn(true);
        }}
      />
    );
  }

  const renderScreen = () => {
    // Permission guard — deny access to restricted screens
    if (!canAccess(screen, role)) {
      return <PermissionDeniedPage ctx={ctx} />;
    }

    switch (screen) {
      case "dashboard":       return <DashboardScreen ctx={ctx} />;
      case "search":          return <SearchScreen ctx={ctx} />;
      case "documents":       return <DocumentsScreen ctx={ctx} />;
      case "favorites":       return <FavoritesScreen ctx={ctx} />;
      case "review-queue":    return <ReviewQueueScreen ctx={ctx} />;
      case "review-editor":   return selDoc ? <ReviewEditorScreen ctx={ctx} /> : <ReviewQueueScreen ctx={ctx} />;
      case "document-detail": return selDoc ? <DocumentDetailScreen ctx={ctx} /> : <DocumentsScreen ctx={ctx} />;
      case "rejected":        return <RejectedScreen ctx={ctx} />;
      case "archive":         return <ArchiveScreen ctx={ctx} />;
      case "users":           return <UsersScreen ctx={ctx} />;
      case "teams":           return <TeamsScreen ctx={ctx} />;
      case "categories":      return <CategoriesScreen ctx={ctx} />;
      case "settings":        return <SettingsScreen ctx={ctx} />;
      case "faq":             return <FaqScreen ctx={ctx} />;
      default:                return role === "basic" ? <DocumentsScreen ctx={ctx} /> : <DashboardScreen ctx={ctx} />;
    }
  };

  const isEditor = screen === "review-editor";

  return (
    <div className="flex h-screen overflow-hidden bg-background" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 flex-shrink-0" style={{ backgroundColor: "#005758" }}>
        <Sidebar ctx={ctx} />
      </aside>

      {/* Mobile drawer */}
      <aside
        className="fixed inset-y-0 left-0 z-50 flex flex-col w-64 transition-transform duration-200 ease-in-out md:hidden"
        style={{ backgroundColor: "#005758", transform: mobileOpen ? "translateX(0)" : "translateX(-100%)" }}
      >
        <Sidebar ctx={ctx} onClose={() => setMobileOpen(false)} />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          ctx={ctx}
          role={role}
          setRole={handleRoleChange}
          onMenuClick={() => setMobileOpen(true)}
          noTeamDemo={noTeamDemo}
          setNoTeamDemo={setNoTeamDemo}
        />
        <main className={`flex-1 overflow-hidden ${isEditor ? "flex flex-col" : "overflow-y-auto"}`}>
          {renderScreen()}
        </main>
      </div>
    </div>
  );
}
