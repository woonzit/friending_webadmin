"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import SignupPageComposer from "@/components/SignupPageComposer";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  addPage,
  sameLayout,
  serialize,
  signupPageConflict,
  signupPageSaveIssues,
  signupPageSaveRevision,
  signupPagesPayload,
  validate,
  withRevision,
  type SignupPageIssue,
  type SignupPageLayout,
  type SignupPagesPayload,
} from "@/lib/signupPages";

function issueIdentity(issue: SignupPageIssue): string {
  return `${issue.code}:${issue.page_key ?? ""}:${issue.field_key ?? ""}`;
}

function pageKey(layout: SignupPageLayout): string | null {
  const existing = new Set(layout.pages.map((page) => page.key));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const key = `p_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (!existing.has(key)) return key;
  }
  return null;
}

export default function SignupOptionsPage() {
  const t = useTranslations("signupOptions");
  const [payload, setPayload] = useState<SignupPagesPayload | null>(null);
  const [baseline, setBaseline] = useState<SignupPageLayout | null>(null);
  const [draft, setDraft] = useState<SignupPageLayout | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [serverIssues, setServerIssues] = useState<SignupPageIssue[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyPayload = useCallback((value: unknown): boolean => {
    const parsed = signupPagesPayload(value);
    if (!parsed) return false;
    setPayload(parsed);
    setBaseline(parsed.pages);
    setDraft(parsed.pages);
    setServerIssues([]);
    setError("");
    return true;
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    const response = await adminCall("list_signup_options");
    if (response?.success !== true || response.status_code !== 200 || !applyPayload(response)) {
      setStatus("error");
      return false;
    }
    setStatus("ready");
    return true;
  }, [applyPayload]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const localIssues = useMemo(
    () => draft && payload ? validate(draft, payload.eligible_fields) : [],
    [draft, payload],
  );
  const issues = useMemo(() => {
    const rows = [...localIssues, ...serverIssues];
    return rows.filter((row, index) => (
      rows.findIndex((candidate) => issueIdentity(candidate) === issueIdentity(row)) === index
    ));
  }, [localIssues, serverIssues]);
  const dirty = Boolean(baseline && draft && !sameLayout(baseline, draft));

  function change(next: SignupPageLayout) {
    setDraft(next);
    setServerIssues([]);
    setError("");
    setNotice("");
  }

  function createPage() {
    if (!draft) return;
    const key = pageKey(draft);
    if (key) change(addPage(draft, key));
  }

  async function save() {
    if (!payload || !draft || localIssues.length > 0) return;
    const body = serialize(draft);
    setBusy(true);
    setError("");
    setNotice("");
    const response = await adminCall("save_signup_page_layout", body);
    if (signupPageConflict(response)) {
      setBusy(false);
      const reloaded = await load();
      if (reloaded) setNotice(t("conflictReloaded"));
      return;
    }
    const refusalIssues = signupPageSaveIssues(response);
    if (refusalIssues) {
      setBusy(false);
      setServerIssues(refusalIssues);
      return;
    }
    const revision = signupPageSaveRevision(response);
    if (revision === null) {
      setBusy(false);
      setError(response?.success ? t("invalidResponse") : t("saveError"));
      return;
    }
    const saved = withRevision({ ...draft, pages: body.pages }, revision);
    if (!saved) {
      setBusy(false);
      setError(t("invalidResponse"));
      return;
    }
    setPayload({ ...payload, pages: saved, dropped_items: [] });
    setBaseline(saved);
    setDraft(saved);
    setServerIssues([]);
    setBusy(false);
    setNotice(t("saved"));
  }

  if (status === "loading") return <LoadingPanel />;
  if (status === "error" || !payload || !baseline || !draft) {
    return <ErrorPanel message={t("loadError")} retry={load} />;
  }

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <SignupPageComposer
        layout={draft}
        eligibleFields={payload.eligible_fields}
        systemQuestions={payload.system_questions}
        droppedItems={payload.dropped_items}
        issues={issues}
        busy={busy}
        dirty={dirty}
        notice={notice}
        error={error}
        onChange={change}
        onCreatePage={createPage}
        onReset={() => {
          setDraft(baseline);
          setServerIssues([]);
          setError("");
          setNotice("");
        }}
        onSave={() => void save()}
      />
    </>
  );
}
