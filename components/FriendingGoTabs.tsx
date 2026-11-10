"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/** The three route tabs of the FriendingGO section (D-153): Preorders, Email, Sent. */
export const FRIENDINGGO_TABS = [
  { href: "/friendinggo", key: "preorders", exact: true },
  { href: "/friendinggo/email", key: "email", exact: false },
  { href: "/friendinggo/sent", key: "sent", exact: false },
] as const;

export default function FriendingGoTabs() {
  const pathname = usePathname() ?? "";
  const t = useTranslations("friendinggo.tabs");
  return (
    <nav className="friendinggo-tabs" aria-label={t("label")}>
      {FRIENDINGGO_TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
