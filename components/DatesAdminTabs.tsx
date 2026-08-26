"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/dates", key: "activities", exact: true },
  { href: "/dates/moderation", key: "moderation", exact: false },
  { href: "/dates/configuration", key: "configuration", exact: false },
] as const;

export default function DatesAdminTabs() {
  const pathname = usePathname();
  const t = useTranslations("datesAdmin.tabs");
  return (
    <nav className="dates-tabs" aria-label={t("label")}>
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href || /^\/dates\/act_/.test(pathname) : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
