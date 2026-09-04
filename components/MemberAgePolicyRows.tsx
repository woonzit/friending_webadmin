"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { UserDetailProfile } from "@/lib/userDetail";

/**
 * The three D-122 age facts as read-only support rows (T-730).
 *
 * Read-only on purpose: restoring a spent birthday change needs a receipted
 * Core action that does not exist yet (T-759), and an operator control that
 * cannot be audited is worse than none.
 *
 * Each row prints an em dash when the response did not state the fact, which is
 * exactly what a Core older than T-729 sends. Nothing here is inferred from the
 * neighbouring `age` / `generation` / `show_age` values: an operator reading
 * "Hidden" must be reading the server's own answer.
 */
export function MemberAgePolicyRows({ profile }: { profile: UserDetailProfile }) {
  const t = useTranslations("userDetail");
  const rows: Array<[string, string]> = [
    [
      t("ageDisplay"),
      profile.age_display === null ? "—" : t(`ageDisplayValues.${profile.age_display}`),
    ],
    [
      t("birthdayLocked"),
      profile.birthday_locked === null
        ? "—"
        : t(profile.birthday_locked ? "birthdayLockedValues.locked" : "birthdayLockedValues.changeable"),
    ],
    [
      t("realdob"),
      profile.realdob === null
        ? "—"
        : t(profile.realdob ? "realdobValues.confirmed" : "realdobValues.legacy"),
    ],
  ];
  return (
    <>
      {rows.map(([label, value]) => (
        <div className="detail-row" data-age-policy-row={label} key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </>
  );
}

export default MemberAgePolicyRows;
