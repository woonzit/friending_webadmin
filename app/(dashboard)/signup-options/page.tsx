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
  signupPageConflictLayout,
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

  const adopt = useCallback((parsed: SignupPagesPayload) => {
    setPayload(parsed);
    setBaseline(parsed.pages);
    setDraft(parsed.pages);
    setServerIssues([]);
    setError("");
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    const response = await adminCall("list_signup_options");
    const parsed = response?.success === true && response.status_code === 200
      ? signupPagesPayload(response)
      : null;
    if (!parsed) {
      setStatus("error");
      return false;
    }
    adopt(parsed);
    setStatus("ready");
    return true;
  }, [adopt]);

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
      // Core's 409 answers with the document that won, so authority is
      // recoverable even when the re-read that follows it fails.
      const authoritative = signupPageConflictLayout(response);
      const reloaded = await load();
      if (!reloaded && authoritative) {
        setPayload({ ...payload, pages: authoritative });
        setBaseline(authoritative);
        setDraft(authoritative);
        setServerIssues([]);
        setStatus("ready");
      }
      setNotice(t("conflictReloaded"));
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
    // An accepted save answers with the whole payload — the stored document
    // (whose `dropped_items` are what THIS save healed), the catalogue and the
    // System questions — so the console adopts Core's answer rather than the
    // draft it sent. `withRevision` stays the CAS rule: the served revision
    // must be the exact successor of the one the draft was saved against.
    const parsed = signupPagesPayload(response);
    if (!withRevision(draft, revision) || !parsed || parsed.pages.revision !== revision) {
      setBusy(false);
      setError(t("invalidResponse"));
      return;
    }
    adopt(parsed);
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
