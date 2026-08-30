"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import AdminHelp from "@/components/AdminHelp";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import {
  AUDIENCE_VISIBILITY_CONTRACT_READY,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
} from "@/lib/contractReadiness";

type IconName = "overview" | "users" | "membership" | "appReview" | "userGroups" | "chat" | "templates" | "invite" | "footprints" | "pinger" | "photoModeration" | "reportedContent" | "verification" | "persona" | "profileLocation" | "dates" | "heroes" | "landing" | "appLanding" | "signupOptions" | "signupPhotos" | "profileFields" | "icebreakers" | "config" | "admins" | "audit";

const NAV: Array<{ href: string; key: string; icon: IconName; exact?: boolean; ready?: boolean }> = [
  { href: "/", key: "overview", icon: "overview", exact: true },
  { href: "/users", key: "users", icon: "users" },
  { href: "/membership", key: "membership", icon: "membership" },
  { href: "/photo-moderation", key: "photoModeration", icon: "photoModeration" },
  { href: "/reported-content", key: "reportedContent", icon: "reportedContent" },
  { href: "/text-moderation", key: "textModeration", icon: "reportedContent", ready: PROFILE_TEXT_MODERATION_CONTRACT_READY },
  { href: "/profile-verification", key: "profileVerification", icon: "verification" },
  { href: "/verification", key: "verificationSettings", icon: "verification" },
  { href: "/persona", key: "persona", icon: "persona" },
  { href: "/profile-location", key: "profileLocation", icon: "profileLocation" },
  { href: "/dates", key: "dates", icon: "dates" },
  // D-052: one "Appearance & placements" page replaces the People hero and App
  // landing screens once Core's appearance-rules provider is live.
  { href: "/appearance", key: "appearance", icon: "appLanding" },
  { href: "/landing", key: "landing", icon: "landing" },
  { href: "/signup-options", key: "signupOptions", icon: "signupOptions" },
  { href: "/signup-photos", key: "signupPhotos", icon: "signupPhotos" },
  { href: "/audience-visibility", key: "audienceVisibility", icon: "userGroups", ready: AUDIENCE_VISIBILITY_CONTRACT_READY },
  { href: "/user-groups", key: "userGroups", icon: "userGroups" },
  { href: "/profile-fields", key: "profileFields", icon: "profileFields" },
  { href: "/profile-presentation", key: "profilePresentation", icon: "profileFields" },
  { href: "/profile-tags", key: "profileTags", icon: "profileFields" },
  { href: "/icebreakers", key: "icebreakers", icon: "icebreakers" },
  { href: "/layer2-intents", key: "layer2Intents", icon: "icebreakers" },
  { href: "/footprints", key: "footprints", icon: "footprints" },
  { href: "/pinger", key: "pinger", icon: "pinger" },
  { href: "/invite-configuration", key: "inviteConfiguration", icon: "invite" },
  { href: "/canned-templates", key: "cannedTemplates", icon: "templates" },
  { href: "/support", key: "support", icon: "chat" },
  { href: "/help-cms", key: "helpCms", icon: "audit" },
  { href: "/configuration", key: "configuration", icon: "config" },
  { href: "/app-review", key: "appReview", icon: "appReview" },
  { href: "/admins", key: "admins", icon: "admins" },
  { href: "/audit", key: "audit", icon: "audit" },
];

const PATHS: Record<IconName, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  membership: <><path d="m4 8 4 4 4-7 4 7 4-4-1.5 10h-13L4 8Z"/><path d="M6 21h12"/></>,
  appReview: <><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></>,
  // Two overlapping member circles inside a rule bracket: administrator-defined
  // cast groups. Deliberately not the `users` pair — this section defines WHO
  // BELONGS by rule, not a list of registered people.
  userGroups: <><circle cx="9" cy="10" r="3"/><circle cx="15" cy="10" r="3"/><path d="M4 19a5 5 0 0 1 8-3.5A5 5 0 0 1 20 19"/><path d="M3 3v4M3 3h4M21 3v4M21 3h-4"/></>,
  photoModeration: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3.5 3.5 2-2 5.5 5.5"/><path d="m14.5 8.5 2 2 4-4"/></>,
  reportedContent: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 7v5"/><path d="M12 16h.01"/></>,
  verification: <><path d="M12 2.8 14.1 4l2.4-.1 1.2 2.1 2.1 1.2-.1 2.4 1.2 2.1-1.2 2.1.1 2.4-2.1 1.2-1.2 2.1-2.4-.1L12 20.6l-2.1-1.2-2.4.1-1.2-2.1-2.1-1.2.1-2.4L3.1 11.7l1.2-2.1-.1-2.4L6.3 6l1.2-2.1 2.4.1L12 2.8Z"/><path d="m8.5 11.8 2.2 2.2 4.8-5"/></>,
  persona: <><path d="M12 22s7-3.7 7-10V5l-7-3-7 3v7c0 6.3 7 10 7 10Z"/><circle cx="12" cy="9" r="2.4"/><path d="M8.7 16a3.5 3.5 0 0 1 6.6 0"/></>,
  profileLocation: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  dates: <><path d="M5 4v3M19 4v3M4 9h16"/><rect x="3" y="5" width="18" height="16" rx="3"/><path d="m8 15 2.3 2.3L16 12"/></>,
  heroes: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
  landing: <><path d="M3 5.5h18v13H3z"/><path d="m3 15 4.5-4.5 3.5 3 3.5-4 6.5 6"/><circle cx="8" cy="8.5" r="1.3"/></>,
  appLanding: <><rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="m9 13.5 2.2-2.2 1.6 1.4 2.2-2.6"/><path d="M10.8 18.5h2.4"/></>,
  signupOptions: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></>,
  // A portrait card with a bust: the signup avatar tile. Deliberately not the `heroes` landscape
  // frame or the `photoModeration` frame-with-a-tick — this section configures the signup photo
  // step, and reusing either icon would read as "People hero" or "review queue" in the same list.
  signupPhotos: <><rect x="4" y="2.8" width="16" height="18.4" rx="3"/><circle cx="12" cy="10" r="2.6"/><path d="M7.6 18.4a4.6 4.6 0 0 1 8.8 0"/></>,
  profileFields: <><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z"/><path d="M16.5 13v7M13 16.5h7"/></>,
  icebreakers: <><path d="M5 5h14v11H9l-4 3v-3H5z"/><path d="M8 9h8M8 12h5"/></>,
  // A speech bubble with a reply arrow: the operator support inbox.
  chat: <><path d="M4 5h16v12H10l-5 3v-3H4z"/><path d="m9 11 2-2m-2 2 2 2m-2-2h6"/></>,
  templates: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M7 3v3M17 3v3"/></>,
  invite: <><path d="m3 11 18-8-7.5 18-3.2-7.3L3 11Z"/><path d="m10.3 13.7 4.4-4.4"/></>,
  // Two offset footprint soles: the badge-coin system members leave on
  // each other's profiles.
  footprints: <><ellipse cx="8.5" cy="8" rx="2.6" ry="3.6"/><path d="M7 13.2h3v1.6a1.5 1.5 0 0 1-3 0z"/><ellipse cx="15.5" cy="13" rx="2.6" ry="3.6"/><path d="M14 18.2h3v1.6a1.5 1.5 0 0 1-3 0z"/></>,
  pinger: <><path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z"/><path d="M3 5 1.5 3.5M21 5l1.5-1.5M12 3V1"/></>,
  config: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.6Z"/></>,
  admins: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
  audit: <><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
};

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export default function Shell({
  adminEmail,
  personaConsoleReady,
  verificationConsoleReady,
  audienceVisibilityConsoleReady,
  profileTextModerationConsoleReady,
  children,
}: {
  adminEmail: string;
  personaConsoleReady: boolean;
  verificationConsoleReady: boolean;
  audienceVisibilityConsoleReady: boolean;
  profileTextModerationConsoleReady: boolean;
  children: React.ReactNode;
}) {
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={`shell${open ? " nav-open" : ""}`}>
      <button className="nav-backdrop" aria-label={common("closeMenu")} onClick={() => setOpen(false)} />
      <aside className="sidebar">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" width="42" height="42" alt="" />
          <span>
            <strong>Friending</strong>
            <small>{common("adminBadge")}</small>
          </span>
        </Link>
        <nav className="main-nav" aria-label={common("mainNavigation")}>
          {NAV.filter((item) => item.ready !== false
            && (item.key !== "persona" || personaConsoleReady)
            && (item.key !== "verificationSettings" || verificationConsoleReady)
            && (item.key !== "audienceVisibility" || audienceVisibilityConsoleReady)
            && (item.key !== "textModeration" || profileTextModerationConsoleReady)
            && (!AUDIENCE_VISIBILITY_CONTRACT_READY
              || (item.key !== "userGroups" && item.key !== "layer2Intents"))).map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <NavIcon name={item.icon} />
                <span>{nav(item.key)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="admin-identity">
            <span className="avatar-dot">{adminEmail.slice(0, 1).toUpperCase()}</span>
            <span title={adminEmail}>{adminEmail}</span>
          </div>
          <div className="sidebar-actions">
            <LocaleSwitcher />
            <button className="text-button" onClick={logout}>{common("logout")}</button>
          </div>
        </div>
      </aside>
      <div className="content-column">
        <header className="topbar">
          <button className="menu-button" onClick={() => setOpen(true)} aria-label={common("openMenu")}>
            <span />
            <span />
            <span />
          </button>
          <span className="mobile-brand">Friending <b>{common("adminBadge")}</b></span>
          <LocaleSwitcher />
        </header>
        <main className="content">{children}</main>
      </div>
      <AdminHelp />
    </div>
  );
}
