"use client";

import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import {
  memberBirthdayLockErrorMessageKey,
  memberBirthdayLockRefusal,
  memberBirthdayLockResetPayload,
  memberBirthdayLockResetResponse,
  type MemberBirthdayLockReceipt,
} from "@/lib/memberBirthdayLock";
import type { UserDetailProfile } from "@/lib/userDetail";

/**
 * The three D-122 age facts as read-only support rows (T-730).
 *
 * The facts remain read-only. T-759 adds one adjacent control only while Core
 * says the birthday is locked; it restores the allowance through a receipted,
 * audited action and never edits any birthday or presentation value itself.
 *
 * Each row prints an em dash when the response did not state the fact, which is
 * exactly what a Core older than T-729 sends. Nothing here is inferred from the
 * neighbouring `age` / `generation` / `show_age` values: an operator reading
 * "Hidden" must be reading the server's own answer.
 */
export function MemberAgePolicyRows({
  profile,
  uid,
  onReset,
}: {
  profile: UserDetailProfile;
  uid?: number;
  onReset?: () => Promise<void>;
}) {
  const t = useTranslations("userDetail");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [receipt, setReceipt] = useState<MemberBirthdayLockReceipt | null>(null);
  // On a timeout the next click reuses the same receipt identity; `onReset`
  // also refreshes the authoritative member projection before another choice.
  const pendingRequestId = useRef<string | null>(null);

  async function resetBirthdayLock() {
    if (busy || uid === undefined || onReset === undefined) return;
    if (!window.confirm(t("birthdayReset.confirm"))) return;
    const requestId = pendingRequestId.current ?? globalThis.crypto?.randomUUID?.();
    const payload = memberBirthdayLockResetPayload(uid, requestId);
    if (!payload) {
      setNotice({ tone: "error", text: t("birthdayReset.errors.unavailable") });
      return;
    }
    pendingRequestId.current = payload.request_id;
    setBusy(true);
    setNotice(null);
    try {
      const response = await adminCall("reset_member_birthday_lock", payload);
      const result = memberBirthdayLockResetResponse(response, uid, payload.request_id);
      if (result) {
        pendingRequestId.current = null;
        setReceipt(result.receipt);
        setNotice({
          tone: "success",
          text: t(result.changed ? "birthdayReset.changed" : "birthdayReset.notLocked"),
        });
        await onReset();
        return;
      }
      const refusal = memberBirthdayLockRefusal(response);
      if (refusal) {
        // An in-progress command can safely be retried under the same identity;
        // every other known refusal is terminal for this button press.
        if (refusal.error !== "birthday-lock-request-in-progress") {
          pendingRequestId.current = null;
        }
        setNotice({
          tone: "error",
          text: t(`birthdayReset.errors.${memberBirthdayLockErrorMessageKey(refusal.error)}`),
        });
        return;
      }
      // Transport uncertainty: keep the request id, then re-read Core. If the
      // action landed, the refreshed lock is false; otherwise Retry replays it.
      setNotice({ tone: "error", text: t("birthdayReset.errors.uncertain") });
      await onReset();
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<["age_display" | "birthday_locked" | "realdob", string, string]> = [
    [
      "age_display",
      t("ageDisplay"),
      profile.age_display === null ? "—" : t(`ageDisplayValues.${profile.age_display}`),
    ],
    [
      "birthday_locked",
      t("birthdayLocked"),
      profile.birthday_locked === null
        ? "—"
        : t(profile.birthday_locked ? "birthdayLockedValues.locked" : "birthdayLockedValues.changeable"),
    ],
    [
      "realdob",
      t("realdob"),
      profile.realdob === null
        ? "—"
        : t(profile.realdob ? "realdobValues.confirmed" : "realdobValues.legacy"),
    ],
  ];
  return (
    <>
      {rows.map(([key, label, value]) => (
        <div className="detail-row" data-age-policy-row={label} key={label}>
          <dt>{label}</dt>
          <dd className={key === "birthday_locked" ? "birthday-lock-policy-value" : undefined}>
            <span>{value}</span>
            {key === "birthday_locked" && profile.birthday_locked === true && uid !== undefined && onReset ? (
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={busy}
                onClick={() => void resetBirthdayLock()}
              >
                {busy
                  ? t("birthdayReset.working")
                  : t(pendingRequestId.current ? "birthdayReset.retry" : "birthdayReset.unlock")}
              </button>
            ) : null}
          </dd>
        </div>
      ))}
      {notice ? (
        <div className="detail-row birthday-lock-reset-notice">
          <dt>{t("birthdayReset.result")}</dt>
          <dd><span className={`status-badge status-${notice.tone}`}>{notice.text}</span></dd>
        </div>
      ) : null}
      {receipt ? (
        <div className="detail-row birthday-lock-reset-receipt">
          <dt>{t("birthdayReset.receipt")}</dt>
          <dd>
            <code>{receipt.request_id}</code><br />
            <code>{receipt.audit_id}</code>
            {receipt.replayed ? ` · ${t("birthdayReset.replayed")}` : ""}
          </dd>
        </div>
      ) : null}
    </>
  );
}

export default MemberAgePolicyRows;
