"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";

type AdminRow = {
  email: string;
  role?: string;
  is_active: boolean;
  created_at: number;
  last_login_at: number;
  banned_until: number;
};

export default function AdminsPage() {
  const t = useTranslations("admins");
  const common = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [actorEmail, setActorEmail] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busyEmail, setBusyEmail] = useState("");
  const [deleting, setDeleting] = useState<AdminRow | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (rows.length === 0) setState("loading");
    const response = await adminCall("list_admins");
    if (!response?.success || !Array.isArray(response.data)) {
      setState("error");
      return;
    }
    setRows(response.data as AdminRow[]);
    setActorEmail(String(response.actor_email ?? ""));
    setState("ready");
  }, [rows.length]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function errorText(error: unknown): string {
    switch (String(error ?? "")) {
      case "email-invalid": return t("invalidEmail");
      case "already-exists": return t("alreadyExists");
      case "cannot-disable-self":
      case "cannot-delete-self": return t("cannotSelf");
      case "last-active-admin": return t("lastAdmin");
      default: return t("saveError");
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setBusyEmail(normalized);
    setMessage(null);
    const response = await adminCall("add_admin", { email: normalized });
    setBusyEmail("");
    if (!response?.success || !response.admin) {
      setMessage({ tone: "error", text: errorText(response?.error) });
      return;
    }
    setRows((current) => [...current, response.admin as AdminRow].sort((a, b) => a.email.localeCompare(b.email)));
    setEmail("");
  }

  async function update(row: AdminRow, body: Record<string, unknown>) {
    setBusyEmail(row.email);
    setMessage(null);
    const response = await adminCall("update_admin", { email: row.email, ...body });
    setBusyEmail("");
    if (!response?.success || !response.admin) {
      setMessage({ tone: "error", text: errorText(response?.error) });
      return;
    }
    setRows((current) => current.map((item) => item.email === row.email ? response.admin as AdminRow : item));
  }

  async function remove() {
    if (!deleting) return;
    setBusyEmail(deleting.email);
    const response = await adminCall("delete_admin", { email: deleting.email });
    setBusyEmail("");
    if (!response?.success) {
      setMessage({ tone: "error", text: errorText(response?.error) });
      setDeleting(null);
      return;
    }
    setRows((current) => current.filter((row) => row.email !== deleting.email));
    setDeleting(null);
  }

  const activeCount = useMemo(() => rows.filter((row) => row.is_active).length, [rows]);

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <section className="panel admin-add-panel">
        <div className="panel-header"><h2>{t("addTitle")}</h2></div>
        <div className="panel-body">
          <form className="admin-add-form" onSubmit={add}>
            <label className="field">
              <span className="sr-only">{common("email")}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value.slice(0, 320))}
                placeholder={t("emailPlaceholder")}
              />
            </label>
            <button className="button button-primary" disabled={!!busyEmail || !email.trim()}>
              {t("add")}
            </button>
          </form>
        </div>
      </section>
      {message && <div className={`alert ${message.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="alert">{message.text}</div>}
      <div className="list-summary"><strong>{t("activeAdmins", { count: activeCount })}</strong></div>
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={load} />
      ) : rows.length === 0 ? (
        <EmptyPanel title={t("empty")} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{common("email")}</th>
                <th>{common("status")}</th>
                <th>{common("createdAt")}</th>
                <th>{common("lastLogin")}</th>
                <th><span className="sr-only">{common("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelf = row.email === actorEmail;
                const locked = row.banned_until > Math.floor(Date.now() / 1000);
                const busy = busyEmail === row.email;
                return (
                  <tr key={row.email}>
                    <td>
                      <div className="user-cell">
                        <span className="avatar-dot">{row.email.slice(0, 1).toUpperCase()}</span>
                        <span><strong>{row.email}</strong><small>{row.role || "admin"}{isSelf ? ` · ${common("you")}` : ""}</small></span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-stack">
                        <span className={`badge ${row.is_active ? "badge-active" : "badge-inactive"}`}>
                          {row.is_active ? common("active") : common("inactive")}
                        </span>
                        {locked && <small>{t("lockedUntil", { date: formatDate(row.banned_until, locale, true) })}</small>}
                      </div>
                    </td>
                    <td>{formatDate(row.created_at, locale)}</td>
                    <td>{row.last_login_at ? formatDate(row.last_login_at, locale, true) : common("never")}</td>
                    <td>
                      <div className="row-actions">
                        {locked && (
                          <button className="button button-secondary button-small" disabled={busy} onClick={() => void update(row, { clear_ban: true })}>
                            {t("clearBan")}
                          </button>
                        )}
                        <button
                          className="button button-secondary button-small"
                          disabled={busy || (isSelf && row.is_active)}
                          title={isSelf && row.is_active ? t("cannotSelf") : undefined}
                          onClick={() => void update(row, { is_active: !row.is_active })}
                        >
                          {row.is_active ? t("disable") : t("enable")}
                        </button>
                        <button
                          className="button button-danger button-small"
                          disabled={busy || isSelf}
                          title={isSelf ? t("cannotSelf") : undefined}
                          onClick={() => setDeleting(row)}
                        >
                          {t("remove")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          busyLabel={common("deleting")}
          title={t("removeTitle")}
          copy={t("removeCopy", { email: deleting.email })}
          confirmLabel={t("remove")}
          busy={busyEmail === deleting.email}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}
