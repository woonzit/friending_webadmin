"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  VERIFICATION_BADGE_SLOTS,
  VERIFICATION_FEATURE_KEYS,
  VERIFICATION_GATE_VARIANTS,
  VERIFICATION_LEVELS,
  VERIFICATION_LOCALES,
  VERIFICATION_METHODS,
  VERIFICATION_METHOD_STATUSES,
  VERIFICATION_PENDING_STORAGE_KEY,
  VERIFICATION_REQUIREMENTS,
  VERIFICATION_TAB_KEYS,
  normalizeVerificationProxyBody,
  verificationBadgeFileError,
  verificationBadgeMutationResponse,
  verificationCityDetailResponse,
  verificationCitySearchResponse,
  verificationConflictResponse,
  verificationConsoleResponse,
  verificationCopyMutationResponse,
  verificationErrorResponse,
  verificationGrantMutationResponse,
  verificationPendingFrom,
  verificationPendingMutation,
  verificationPendingSettingsMutationResponse,
  verificationPendingSummaryResponse,
  verificationPersistBeforeMutation,
  verificationPolicyImpactPreviewResponse,
  verificationPolicyLifecycle,
  verificationPolicyMutationResponse,
  verificationPolicyOperationsFor,
  verificationShouldRetainMutation,
  verificationSimulationResponse,
  type VerificationBadgeAsset,
  type VerificationBadgeSlot,
  type VerificationCapability,
  type VerificationCityDetailData,
  type VerificationCitySuggestion,
  type VerificationConsoleData,
  type VerificationCopyBehavior,
  type VerificationLevel,
  type VerificationLocale,
  type VerificationLocalizedGateCopy,
  type VerificationMethodStatus,
  type VerificationMutationAction,
  type VerificationPendingMutation,
  type VerificationPendingSummaryData,
  type VerificationPolicy,
  type VerificationPolicyImpactPreviewData,
  type VerificationPolicyOperation,
  type VerificationSimulationData,
  type VerificationSimulationInput,
  type VerificationStoredPolicyBlock,
  type VerificationTabKey,
} from "@/lib/verificationAdmin";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;
type LoadState = "loading" | "ready" | "error";
type CopyDraft = {
  copy_key: string;
  behavior: VerificationCopyBehavior;
  locales: Record<VerificationLocale, VerificationLocalizedGateCopy>;
  expectedRevision: number;
  active: boolean;
};
type SimulationInputMethod = VerificationSimulationInput["video"];

const VERIFICATION_COPY_KEYS = [
  ...VERIFICATION_GATE_VARIANTS.map((variant) => `default.${variant}`),
  ...VERIFICATION_FEATURE_KEYS.flatMap((feature) => (
    VERIFICATION_GATE_VARIANTS.map((variant) => `feature.${feature}.${variant}`)
  )),
].sort();
const COPY_VALIDATION_REQUEST_ID = "00000000-0000-4000-8000-000000000000";

function clone<T>(value: T): T { return structuredClone(value); }

function methodChoice(methods: VerificationStoredPolicyBlock["enabled_methods"]): string {
  if (methods === "inherit") return "inherit";
  if (methods.length === 0) return "none";
  if (methods.length === 2) return "both";
  return methods[0];
}

function methodsFromChoice(value: string): VerificationStoredPolicyBlock["enabled_methods"] {
  if (value === "inherit") return "inherit";
  if (value === "both") return ["video", "persona"];
  if (value === "video" || value === "persona") return [value];
  return [];
}

function mutationResult(action: VerificationMutationAction, response: unknown): { replayed: boolean } | null {
  if (action === "verification_policy_save_draft" || action === "verification_policy_apply") {
    return verificationPolicyMutationResponse(response);
  }
  if (action === "verification_copy_save" || action === "verification_copy_remove") {
    return verificationCopyMutationResponse(response);
  }
  if (action === "verification_pending_settings_save") return verificationPendingSettingsMutationResponse(response);
  if (action === "verification_badge_upload" || action === "verification_badge_remove") {
    return verificationBadgeMutationResponse(response);
  }
  return verificationGrantMutationResponse(response);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function defaultOverrideDraft(): VerificationStoredPolicyBlock {
  return {
    enabled_methods: "inherit",
    feature_requirements: Object.fromEntries(
      VERIFICATION_FEATURE_KEYS.map((feature) => [feature, "inherit"]),
    ) as VerificationStoredPolicyBlock["feature_requirements"],
  };
}

function defaultSimulation(): VerificationSimulationInput {
  return {
    video: { status: "not_started", pending_age_seconds: null, attempt: null, retry_available: true },
    persona: { status: "not_started", pending_age_seconds: null, attempt: null, retry_available: true },
    imported_level: "none",
    imported_method_hint: null,
    grant_level: "none",
    badge_visible: true,
  };
}

function consoleSnapshotIdentity(value: VerificationConsoleData): string {
  return JSON.stringify({
    principal: value.principal,
    evaluated_at: value.evaluated_at,
    feature_keys: value.feature_keys,
    method_availability: value.method_availability,
    total_policies: value.total_policies,
    copy_pairs: value.copy_pairs,
    pending_settings: value.pending_settings,
    badges: value.badges,
    import_health: value.import_health,
    activation_guard: value.activation_guard,
  });
}

function policyPrecedes(left: VerificationPolicy, right: VerificationPolicy): boolean {
  const rank = { global: 0, country: 1, city: 2 } as const;
  return (rank[left.scope.kind] - rank[right.scope.kind]
    || left.scope.display.localeCompare(right.scope.display)
    || left.scope_key.localeCompare(right.scope_key)) < 0;
}

function samePrincipal(left: VerificationConsoleData["principal"], right: VerificationConsoleData["principal"]): boolean {
  return left.role === right.role
    && left.capabilities.length === right.capabilities.length
    && left.capabilities.every((capability, index) => capability === right.capabilities[index]);
}

function completePolicyPage(value: VerificationConsoleData, accumulated = value.policies.length): boolean {
  if (value.next_cursor === null) return accumulated === value.total_policies;
  return value.policies.length > 0 && accumulated < value.total_policies;
}

function badgeSymbol(slot: VerificationBadgeSlot): string {
  if (slot === "pending") return "◷";
  return slot === "strong" ? "◆" : "✓";
}

export default function VerificationAdminConsole({ initialTab }: { initialTab: VerificationTabKey }) {
  const t = useTranslations("verificationAdmin");
  const locale = useLocale() === "hu" ? "hu" : "en";
  const [tab, setTab] = useState<VerificationTabKey>(initialTab);
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<VerificationConsoleData | null>(null);
  const [summary, setSummary] = useState<VerificationPendingSummaryData | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<VerificationPendingMutation | null>(null);
  const pendingRef = useRef<VerificationPendingMutation | null>(null);
  const [selectedScope, setSelectedScope] = useState("global");
  const [policyDraft, setPolicyDraft] = useState<VerificationStoredPolicyBlock | null>(null);
  const [impact, setImpact] = useState<VerificationPolicyImpactPreviewData | null>(null);
  const [operation, setOperation] = useState<VerificationPolicyOperation>("publish");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cityCountry, setCityCountry] = useState("");
  const [citySuggestions, setCitySuggestions] = useState<VerificationCitySuggestion[]>([]);
  const [cityDetail, setCityDetail] = useState<VerificationCityDetailData["city"] | null>(null);
  const searchTokenRef = useRef<string | null>(null);
  const [selectedCopy, setSelectedCopy] = useState("");
  const [copyDraft, setCopyDraft] = useState<CopyDraft | null>(null);
  const [copyEditorLocale, setCopyEditorLocale] = useState<VerificationLocale>("en");
  const [badgeFiles, setBadgeFiles] = useState<Partial<Record<VerificationBadgeSlot, File>>>({});
  const [pendingOverdue, setPendingOverdue] = useState("1800");
  const [pendingLongCopy, setPendingLongCopy] = useState(false);
  const [pendingThreshold, setPendingThreshold] = useState("1800");
  const [simulation, setSimulation] = useState<VerificationSimulationInput>(defaultSimulation);
  const [simulationScope, setSimulationScope] = useState("global");
  const [simulationResult, setSimulationResult] = useState<VerificationSimulationData | null>(null);

  const can = useCallback((capability: VerificationCapability): boolean => (
    data?.principal.capabilities.includes(capability) ?? false
  ), [data]);

  const load = useCallback(async () => {
    setState((current) => current === "ready" ? current : "loading");
    const [consoleResponse, pendingResponse] = await Promise.all([
      adminCall("verification_console", { contract_version: 1, scope_kind: "all", page_size: 50 }),
      adminCall("verification_pending_summary", { contract_version: 1 }),
    ]);
    const parsed = verificationConsoleResponse(consoleResponse);
    const parsedSummary = verificationPendingSummaryResponse(pendingResponse);
    if (!parsed || !parsedSummary || !completePolicyPage(parsed)
      || !parsed.policies.some((row) => row.scope_key === "global")
      || !samePrincipal(parsed.principal, parsedSummary.principal)) {
      setState("error");
      return;
    }
    setData(parsed);
    setSummary(parsedSummary);
    setSelectedScope((current) => parsed.policies.some((row) => row.scope_key === current) ? current : parsed.policies[0]?.scope_key ?? "global");
    setSelectedCopy((current) => VERIFICATION_COPY_KEYS.includes(current) ? current : "default.video");
    setPendingOverdue(String(parsed.pending_settings.overdue_after_seconds));
    setPendingLongCopy(parsed.pending_settings.queue_average_long_copy_enabled);
    setPendingThreshold(String(parsed.pending_settings.queue_average_threshold_seconds));
    setState("ready");
  }, []);

  async function loadMorePolicies() {
    if (!data?.next_cursor || busy) return;
    const current = data;
    setBusy(true);
    const response = await adminCall("verification_console", {
      contract_version: 1,
      scope_kind: "all",
      page_size: 50,
      cursor: current.next_cursor,
    });
    const parsed = verificationConsoleResponse(response);
    const boundaryValid = parsed !== null && (current.policies.length === 0 || parsed.policies.length === 0
      || policyPrecedes(current.policies[current.policies.length - 1], parsed.policies[0]));
    const keys = parsed ? [...current.policies, ...parsed.policies].map((row) => row.scope_key) : [];
    if (!parsed || consoleSnapshotIdentity(current) !== consoleSnapshotIdentity(parsed)
      || !boundaryValid || new Set(keys).size !== keys.length || !completePolicyPage(parsed, keys.length)) {
      setNotice({ tone: "error", text: t("live.loadMoreFailed") });
      setBusy(false);
      return;
    }
    setData({ ...parsed, policies: [...current.policies, ...parsed.policies] });
    setNotice(null);
    setBusy(false);
  }

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(VERIFICATION_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = verificationPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else window.sessionStorage.removeItem(VERIFICATION_PENDING_STORAGE_KEY);
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load();
  }, [load, t]);

  const selectedPolicy = useMemo(
    () => data?.policies.find((row) => row.scope_key === selectedScope) ?? null,
    [data, selectedScope],
  );
  const policyLifecycle = useMemo(
    () => selectedPolicy ? verificationPolicyLifecycle(selectedPolicy) : null,
    [selectedPolicy],
  );
  const policyOperations = useMemo(
    () => selectedPolicy ? verificationPolicyOperationsFor(selectedPolicy) : [],
    [selectedPolicy],
  );

  useEffect(() => {
    if (selectedPolicy) setPolicyDraft(clone(selectedPolicy.draft));
    setOperation((current) => policyOperations.includes(current) ? current : policyOperations[0] ?? "publish");
    setImpact(null);
    setConfirmation("");
  }, [policyOperations, selectedPolicy]);

  useEffect(() => {
    const pair = data?.copy_pairs.find((row) => row.copy_key === selectedCopy) ?? null;
    if (pair) {
      setCopyDraft({
        copy_key: pair.copy_key,
        behavior: clone(pair.behavior),
        locales: clone(pair.locales),
        expectedRevision: pair.revision,
        active: pair.active,
      });
      return;
    }
    const variant = VERIFICATION_GATE_VARIANTS.find((candidate) => selectedCopy.endsWith(`.${candidate}`));
    const fallback = variant
      ? data?.copy_pairs.find((row) => row.copy_key === `default.${variant}`)
      : null;
    setCopyDraft(fallback ? {
      copy_key: selectedCopy,
      behavior: clone(fallback.behavior),
      locales: clone(fallback.locales),
      expectedRevision: 0,
      active: false,
    } : null);
  }, [data, selectedCopy]);

  useEffect(() => {
    setSimulationResult(null);
  }, [simulation, simulationScope]);

  const copyCanSave = useMemo(() => copyDraft !== null && Boolean(normalizeVerificationProxyBody(
    "verification_copy_save",
    {
      contract_version: 1,
      copy_json: {
        copy_key: copyDraft.copy_key,
        behavior: copyDraft.behavior,
        locales: copyDraft.locales,
      },
      expected_revision: copyDraft.expectedRevision,
      request_id: COPY_VALIDATION_REQUEST_ID,
    },
  )), [copyDraft]);

  function clearPending(): boolean {
    try { window.sessionStorage.removeItem(VERIFICATION_PENDING_STORAGE_KEY); } catch { return false; }
    pendingRef.current = null;
    setPending(null);
    return true;
  }

  async function executeMutation(next: VerificationPendingMutation) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const existing = pendingRef.current;
    let response: AdminResponse | null;
    if (existing) {
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await verificationPersistBeforeMutation(
        window.sessionStorage,
        next,
        () => adminCall(next.action, next.payload),
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      pendingRef.current = next;
      setPending(next);
      response = persisted.response;
    }
    const durable = pendingRef.current ?? next;
    const success = mutationResult(durable.action, response);
    if (success) {
      const cleared = clearPending();
      setNotice({ tone: cleared ? "success" : "error", text: cleared ? t(success.replayed ? "live.replayed" : "live.saved") : t("live.persistenceCleanupFailed") });
      setBusy(false);
      if (cleared) void load();
      return;
    }
    const conflict = verificationConflictResponse(response);
    if (conflict) {
      const cleared = clearPending();
      setNotice({ tone: "error", text: cleared ? t("live.conflict") : t("live.persistenceCleanupFailed") });
      setBusy(false);
      if (cleared) void load();
      return;
    }
    const error = verificationErrorResponse(response);
    if (!verificationShouldRetainMutation(error)) clearPending();
    setNotice({ tone: "error", text: t("live.errorCode", { code: error ?? t("live.unknownError") }) });
    setBusy(false);
  }

  function startMutation(action: VerificationMutationAction, target: string, body: Record<string, unknown>) {
    const next = verificationPendingMutation(action, target, body);
    if (!next) {
      setNotice({ tone: "error", text: t("live.invalidDraft") });
      return;
    }
    void executeMutation(next);
  }

  function selectTab(value: VerificationTabKey) {
    setTab(value);
    setNotice(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  }

  function updateFeature(feature: (typeof VERIFICATION_FEATURE_KEYS)[number], value: string) {
    if (!policyDraft || !(VERIFICATION_REQUIREMENTS as readonly string[]).includes(value)) return;
    setPolicyDraft({ ...policyDraft, feature_requirements: { ...policyDraft.feature_requirements, [feature]: value } as VerificationStoredPolicyBlock["feature_requirements"] });
    setImpact(null);
  }

  function savePolicyDraft(policy: VerificationPolicy, draft = policyDraft, placeToken?: string) {
    if (!draft) return;
    startMutation("verification_policy_save_draft", policy.scope_key, {
      contract_version: 1,
      scope_key: policy.scope_key,
      draft_json: draft,
      ...(placeToken ? { place_token: placeToken } : {}),
      expected_revision: policy.revision,
      request_id: crypto.randomUUID(),
    });
  }

  function saveNewScope(key: string, placeToken?: string) {
    if (!data || data.next_cursor !== null || data.policies.length !== data.total_policies) {
      setNotice({ tone: "error", text: t("live.loadAllBeforeAdd") });
      return;
    }
    if (data.policies.some((row) => row.scope_key === key)) {
      setSelectedScope(key);
      setNotice({ tone: "info", text: t("live.scopeAlreadyExists") });
      return;
    }
    startMutation("verification_policy_save_draft", key, {
      contract_version: 1,
      scope_key: key,
      draft_json: defaultOverrideDraft(),
      ...(placeToken ? { place_token: placeToken } : {}),
      expected_revision: 0,
      request_id: crypto.randomUUID(),
    });
  }

  async function previewImpact() {
    if (!selectedPolicy || busy || !policyOperations.includes(operation)) return;
    setBusy(true);
    const response = await adminCall("verification_policy_impact_preview", {
      contract_version: 1,
      scope_key: selectedPolicy.scope_key,
      operation,
      expected_revision: selectedPolicy.revision,
    });
    const parsed = verificationPolicyImpactPreviewResponse(response);
    const bound = parsed?.scope_key === selectedPolicy.scope_key
      && parsed.operation === operation
      && parsed.expected_revision === selectedPolicy.revision
      ? parsed
      : null;
    setImpact(bound);
    setConfirmation("");
    setNotice(bound ? { tone: "info", text: t("live.previewReady") } : { tone: "error", text: t("live.previewFailed") });
    setBusy(false);
  }

  function applyImpact() {
    if (!impact || confirmation !== impact.confirmation_phrase) return;
    startMutation("verification_policy_apply", impact.scope_key, {
      contract_version: 1,
      scope_key: impact.scope_key,
      operation: impact.operation,
      expected_revision: impact.expected_revision,
      normalized_fingerprint: impact.normalized_fingerprint,
      confirmation_phrase: confirmation,
      reason,
      request_id: crypto.randomUUID(),
    });
  }

  async function searchCity() {
    if (busy) return;
    const token = searchTokenRef.current ?? crypto.randomUUID();
    searchTokenRef.current = token;
    setBusy(true);
    const response = await adminCall("verification_places_city_search", {
      contract_version: 1,
      search_token: token,
      query: cityQuery.trim(),
      ...(cityCountry ? { country_code: cityCountry.trim().toUpperCase() } : {}),
    });
    const parsed = verificationCitySearchResponse(response);
    const bound = parsed?.search_token === token ? parsed : null;
    setCitySuggestions(bound?.suggestions ?? []);
    setCityDetail(null);
    setNotice(bound ? null : { tone: "error", text: t("live.citySearchFailed") });
    setBusy(false);
  }

  async function selectCity(place: string) {
    const token = searchTokenRef.current;
    if (!token || busy) return;
    setBusy(true);
    const response = await adminCall("verification_places_city_detail", { contract_version: 1, search_token: token, place_id: place });
    const parsed = verificationCityDetailResponse(response);
    const bound = parsed?.city.place_id === place ? parsed : null;
    setCityDetail(bound?.city ?? null);
    setNotice(bound ? null : { tone: "error", text: t("live.cityDetailFailed") });
    setBusy(false);
  }

  function saveCopy() {
    if (!copyDraft) return;
    startMutation("verification_copy_save", copyDraft.copy_key, {
      contract_version: 1,
      copy_json: { copy_key: copyDraft.copy_key, behavior: copyDraft.behavior, locales: copyDraft.locales },
      expected_revision: copyDraft.expectedRevision,
      request_id: crypto.randomUUID(),
    });
  }

  function updateCopyLocale(patch: Partial<VerificationLocalizedGateCopy>) {
    if (!copyDraft) return;
    setCopyDraft({
      ...copyDraft,
      locales: {
        ...copyDraft.locales,
        [copyEditorLocale]: { ...copyDraft.locales[copyEditorLocale], ...patch },
      },
    });
  }

  function updateCopyAction(
    field: "primary_action" | "secondary_action",
    value: VerificationCopyBehavior[typeof field],
  ) {
    if (!copyDraft) return;
    const primary = field === "primary_action";
    const actionIsNone = value === "none";
    const actionUsesUrl = value === "url";
    const labelKey = primary ? "primary_label" : "secondary_label";
    const urlKey = primary ? "primary_url" : "secondary_url";
    const locales = Object.fromEntries(VERIFICATION_LOCALES.map((entry) => [entry, {
      ...copyDraft.locales[entry],
      [labelKey]: actionIsNone ? null : copyDraft.locales[entry][labelKey] ?? "",
    }])) as CopyDraft["locales"];
    setCopyDraft({
      ...copyDraft,
      behavior: {
        ...copyDraft.behavior,
        [field]: value,
        [urlKey]: actionUsesUrl ? copyDraft.behavior[urlKey] ?? "" : null,
      },
      locales,
    });
  }

  function removeCopy() {
    if (!copyDraft?.copy_key.startsWith("feature.") || !copyDraft.active) return;
    startMutation("verification_copy_remove", copyDraft.copy_key, {
      contract_version: 1,
      copy_key: copyDraft.copy_key,
      reason,
      expected_revision: copyDraft.expectedRevision,
      request_id: crypto.randomUUID(),
    });
  }

  function savePendingSettings() {
    if (!data) return;
    startMutation("verification_pending_settings_save", "pending", {
      contract_version: 1,
      overdue_after_seconds: Number(pendingOverdue),
      queue_average_long_copy_enabled: false,
      queue_average_threshold_seconds: Number(pendingThreshold),
      expected_revision: data.pending_settings.revision,
      request_id: crypto.randomUUID(),
    });
  }

  async function uploadBadge(asset: VerificationBadgeAsset) {
    const file = badgeFiles[asset.slot];
    if (!file) return;
    const error = await verificationBadgeFileError(file);
    if (error) {
      setNotice({ tone: "error", text: t(`badges.errors.${error}`) });
      return;
    }
    const png = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    startMutation("verification_badge_upload", asset.slot, {
      contract_version: 1,
      slot: asset.slot,
      png_base64: png,
      expected_revision: asset.revision,
      request_id: crypto.randomUUID(),
    });
  }

  function removeBadge(asset: VerificationBadgeAsset) {
    startMutation("verification_badge_remove", asset.slot, {
      contract_version: 1,
      slot: asset.slot,
      reason,
      expected_revision: asset.revision,
      request_id: crypto.randomUUID(),
    });
  }

  function updateSimulationMethod(
    method: (typeof VERIFICATION_METHODS)[number],
    patch: Partial<SimulationInputMethod>,
  ) {
    setSimulation((current) => ({
      ...current,
      [method]: { ...current[method], ...patch },
    }));
  }

  async function runSimulation() {
    if (busy) return;
    setBusy(true);
    const response = await adminCall("verification_simulate", {
      contract_version: 1,
      scope_key: simulationScope,
      locale,
      simulation_json: simulation,
    });
    const parsed = verificationSimulationResponse(response);
    const requestedScope = data?.policies.find((row) => row.scope_key === simulationScope)?.scope;
    const expectedSeal = parsed !== null
      && simulation.badge_visible
      && parsed.effective_level !== "none"
      && parsed.enabled_methods.length > 0;
    const bound = parsed && requestedScope
      && JSON.stringify(parsed.scope) === JSON.stringify(requestedScope)
      && parsed.method_statuses.video === simulation.video.status
      && parsed.method_statuses.persona === simulation.persona.status
      && parsed.imported_level === simulation.imported_level
      && parsed.granted_level === simulation.grant_level
      && parsed.external_seal_would_show === expectedSeal
      ? parsed
      : null;
    setSimulationResult(bound);
    setNotice(bound ? null : { tone: "error", text: t("live.simulationFailed") });
    setBusy(false);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !data || !summary) return <ErrorPanel message={t("live.loadError")} retry={load} />;

  const locked = busy || pending !== null;
  const tabIndex = VERIFICATION_TAB_KEYS.indexOf(tab);
  const copyLocale = copyDraft?.locales[copyEditorLocale];
  const copyVariant = VERIFICATION_GATE_VARIANTS.find((variant) => selectedCopy.endsWith(`.${variant}`)) ?? "video";
  const copyPreviewIcon = copyVariant === "pending" ? "◷" : copyVariant === "rejected" ? "!" : copyVariant === "both" ? "1·2" : "✓";
  const canCreateScope = data.next_cursor === null && data.policies.length === data.total_policies;
  const impactActivationBlocked = impact?.impact.features.some((feature) => feature.effective_after !== "none") === true
    && !impact.activation_guard.non_none_publish_ready;

  function tabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? VERIFICATION_TAB_KEYS.length - 1
      : (tabIndex + (event.key === "ArrowRight" ? 1 : -1) + VERIFICATION_TAB_KEYS.length) % VERIFICATION_TAB_KEYS.length;
    const next = VERIFICATION_TAB_KEYS[index];
    selectTab(next);
    document.getElementById(`verification-tab-${next}`)?.focus();
  }

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} actions={<button type="button" className="button button-secondary button-small" onClick={() => void load()}>{t("live.refresh")}</button>} />
      {!data.activation_guard.non_none_publish_ready ? <div className="alert alert-warning page-alert"><strong>{t("live.activationBlocked")}</strong> {data.activation_guard.blocking_reasons.map((value) => t(`live.activationReasons.${value}`)).join(", ")}</div> : null}
      {pending ? <div className="alert alert-info page-alert"><strong>{t("live.pendingMutation")}</strong> {pending.action} · {pending.target} <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void executeMutation(pending)}>{t("live.retryExact")}</button></div> : null}
      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      <div className="verification-tabs" role="tablist" aria-label={t("tabs.label")}>
        {VERIFICATION_TAB_KEYS.map((value) => <button id={`verification-tab-${value}`} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} key={value} onKeyDown={tabKeyDown} onClick={() => selectTab(value)}>{t(`tabs.${value}`)}</button>)}
      </div>

      <div role="tabpanel" aria-labelledby={`verification-tab-${tab}`}>
        {tab === "scopes" ? <div className="verification-scopes-workspace">
          <section className="panel">
            <div className="panel-header"><div><h2>{t("scopes.listTitle")}</h2><p>{t("scopes.listCopy")}</p></div><div className="row-actions"><span className="badge">{t("live.shownPolicies", { shown: data.policies.length, total: data.total_policies })}</span>{data.next_cursor ? <button type="button" className="button button-secondary button-small" disabled={locked} onClick={() => void loadMorePolicies()}>{t("live.loadMore")}</button> : null}</div></div>
            <div className="panel-body">
              <label className="field"><span>{t("live.scope")}</span><select value={selectedScope} onChange={(event) => setSelectedScope(event.target.value)}>{data.policies.map((row) => <option value={row.scope_key} key={row.scope_key}>{row.scope.display} · {row.scope_key}</option>)}</select></label>
              {selectedPolicy && policyDraft ? <div className="form-stack">
                {policyLifecycle ? <div className="verification-provenance-card">
                  <strong>{t(`live.policyStates.${policyLifecycle}`)}</strong>
                  <small>{t(`live.policyStateHelp.${policyLifecycle}`)}</small>
                </div> : null}
                <label className="field">
                  <span>{t("live.enabledMethods")}</span>
                  <select value={methodChoice(policyDraft.enabled_methods)} disabled={locked || !can("verification_policy_edit")} onChange={(event) => { setPolicyDraft({ ...policyDraft, enabled_methods: methodsFromChoice(event.target.value) }); setImpact(null); }}>
                    {selectedPolicy.scope.kind !== "global" ? <option value="inherit">{t("requirements.values.inherit")}</option> : null}
                    <option value="none">{t("live.methodChoices.none")}</option>
                    <option value="video" disabled={!data.method_availability.video.policy_enable_allowed}>{t("methods.video")}</option>
                    <option value="persona" disabled={!data.method_availability.persona.policy_enable_allowed}>{t("methods.persona")}</option>
                    <option value="both" disabled={VERIFICATION_METHODS.some((method) => !data.method_availability[method].policy_enable_allowed)}>{t("live.methodChoices.both")}</option>
                  </select>
                  <small className="field-hint">{VERIFICATION_METHODS.map((method) => {
                    const availability = data.method_availability[method];
                    return `${t(`methods.${method}`)}: ${availability.reason ? t(`live.methodReasons.${availability.reason}`) : t("live.methodAvailable")}`;
                  }).join(" · ")}</small>
                </label>
                <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("requirements.feature")}</th><th>{t("live.draftRequirement")}</th><th>{t("live.effectiveRequirement")}</th></tr></thead><tbody>{VERIFICATION_FEATURE_KEYS.map((feature) => {
                  const effective = selectedPolicy.effective?.feature_requirements[feature];
                  return <tr key={feature}><th><strong>{t(`features.${feature}.title`)}</strong><small>{feature}</small></th><td><select value={policyDraft.feature_requirements[feature]} disabled={locked || !can("verification_policy_edit")} onChange={(event) => updateFeature(feature, event.target.value)}>{VERIFICATION_REQUIREMENTS.filter((value) => selectedPolicy.scope.kind !== "global" || value !== "inherit").map((value) => <option value={value} key={value}>{t(`requirements.values.${value}`)}</option>)}</select></td><td>{effective ? <><strong>{t(`requirements.values.${effective.required_tier}`)}</strong><small>{effective.source_scope_key}</small></> : t("live.notLive")}</td></tr>;
                })}</tbody></table></div>
                <div className="row-actions"><button type="button" className="button button-primary" disabled={locked || !can("verification_policy_edit")} onClick={() => savePolicyDraft(selectedPolicy)}>{t("live.saveDraft")}</button></div>
                <div className="verification-grant-editor">
                  <label className="field"><span>{t("live.operation")}</span><select value={operation} disabled={locked || !can("verification_policy_publish")} onChange={(event) => { setOperation(event.target.value as VerificationPolicyOperation); setImpact(null); }}>{policyOperations.map((value) => <option value={value} key={value}>{t(`live.operations.${value}`)}</option>)}</select></label>
                  <button type="button" className="button button-secondary" disabled={locked || !can("verification_policy_publish")} onClick={() => void previewImpact()}>{t("live.previewImpact")}</button>
                  {impact ? <div className="form-stack">
                    <div className="verification-queue-metric"><strong>{impact.impact.members_changed}</strong><span>{t("live.membersChanged", { total: impact.impact.members_evaluated })}</span></div>
                    <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("requirements.feature")}</th><th>{t("live.impactConfigured")}</th><th>{t("live.impactEffective")}</th><th>{t("live.impactAffected")}</th></tr></thead><tbody>{impact.impact.features.map((feature) => <tr key={feature.feature}>
                      <th><strong>{t(`features.${feature.feature}.title`)}</strong><small>{feature.feature}</small></th>
                      <td>{t("live.impactTransition", { before: t(`requirements.values.${feature.configured_before}`), after: t(`requirements.values.${feature.configured_after}`) })}</td>
                      <td>{t("live.impactTransition", { before: t(`requirements.values.${feature.effective_before}`), after: t(`requirements.values.${feature.effective_after}`) })}</td>
                      <td>{feature.affected_members}</td>
                    </tr>)}</tbody></table></div>
                    <label className="field"><span>{t("live.typePhrase", { phrase: impact.confirmation_phrase })}</span><input disabled={locked} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
                    <label className="field"><span>{t("live.reason")}</span><textarea disabled={locked} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                    {impactActivationBlocked ? <div className="alert alert-warning">{t("live.previewActivationBlocked")}</div> : null}
                    <button type="button" className="button button-danger" disabled={locked || !can("verification_policy_publish") || impactActivationBlocked || confirmation !== impact.confirmation_phrase || reason.trim() === ""} onClick={applyImpact}>{t("live.apply")}</button>
                  </div> : null}
                </div>
              </div> : null}
            </div>
          </section>
          <aside className="verification-scope-sidecards">
            <section className="panel"><div className="panel-header"><h2>{t("live.addCountry")}</h2></div><div className="panel-body"><label className="field"><span>{t("scopes.country")}</span><input disabled={locked || !can("verification_policy_edit")} maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} /></label>{!canCreateScope ? <p className="field-hint">{t("live.loadAllBeforeAdd")}</p> : null}<button type="button" className="button button-secondary" disabled={locked || !can("verification_policy_edit") || !canCreateScope || !/^[A-Z]{2}$/.test(countryCode)} onClick={() => saveNewScope(`country:${countryCode}`)}>{t("scopes.addDraft")}</button></div></section>
            <section className="panel"><div className="panel-header"><h2>{t("live.addCity")}</h2></div><div className="panel-body form-stack"><label className="field"><span>{t("scopes.citySearch")}</span><input disabled={locked || !can("verification_policy_edit")} type="search" value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} /></label><label className="field"><span>{t("scopes.country")}</span><input disabled={locked || !can("verification_policy_edit")} maxLength={2} value={cityCountry} onChange={(event) => setCityCountry(event.target.value.toUpperCase())} /></label><button type="button" className="button button-secondary" disabled={locked || !can("verification_policy_edit") || cityQuery.trim().length < 2} onClick={() => void searchCity()}>{t("live.search")}</button>{citySuggestions.map((row) => <button type="button" className="button button-ghost" disabled={locked || !can("verification_policy_edit")} key={row.place_id} onClick={() => void selectCity(row.place_id)}>{row.display} · {row.secondary}</button>)}{cityDetail ? <div className="verification-provenance-card"><strong>{cityDetail.display}</strong><small>{cityDetail.scope_key}</small>{!canCreateScope ? <p className="field-hint">{t("live.loadAllBeforeAdd")}</p> : null}<button type="button" className="button button-primary" disabled={locked || !can("verification_policy_edit") || !canCreateScope} onClick={() => saveNewScope(cityDetail.scope_key, cityDetail.place_token)}>{t("scopes.addDraft")}</button></div> : null}</div></section>
          </aside>
        </div> : null}

        {tab === "requirements" ? <section className="panel"><div className="panel-header"><div><h2>{t("requirements.title")}</h2><p>{t("requirements.copy")}</p></div></div><div className="panel-body"><div className="table-wrap"><table className="data-table"><thead><tr><th>{t("requirements.feature")}</th>{data.policies.map((row) => <th key={row.scope_key}>{row.scope.display}</th>)}</tr></thead><tbody>{VERIFICATION_FEATURE_KEYS.map((feature) => <tr key={feature}><th><strong>{t(`features.${feature}.title`)}</strong><small>{feature}</small></th>{data.policies.map((row) => {
          const effective = row.effective?.feature_requirements[feature];
          return <td key={row.scope_key}>{effective ? <><strong>{t(`requirements.values.${effective.required_tier}`)}</strong><small>{effective.source_scope_key}</small></> : t("live.notLive")}</td>;
        })}</tr>)}</tbody></table></div></div></section> : null}

        {tab === "messages" ? <div className="section-grid">
          <section className="panel">
            <div className="panel-header"><div><h2>{t("messages.title")}</h2><p>{t("messages.copy")}</p></div></div>
            <div className="panel-body form-stack">
              <label className="field"><span>{t("live.copyPair")}</span><select value={selectedCopy} onChange={(event) => setSelectedCopy(event.target.value)}>{VERIFICATION_COPY_KEYS.map((key) => <option value={key} key={key}>{key}</option>)}</select></label>
              {copyDraft && copyLocale ? <>
                <div className="row-actions">
                  {VERIFICATION_LOCALES.map((entry) => <button type="button" className={`button button-small ${copyEditorLocale === entry ? "button-primary" : "button-secondary"}`} aria-pressed={copyEditorLocale === entry} key={entry} onClick={() => setCopyEditorLocale(entry)}>{t(`messages.locales.${entry}`)}</button>)}
                  <span className="status-badge status-inactive">{copyDraft.expectedRevision === 0 ? t("live.newOverride") : t("live.revision", { revision: copyDraft.expectedRevision })}</span>
                </div>
                <small className="field-hint">{copyDraft.behavior.icon.asset_key}</small>
                <label className="field"><span>{t("messages.fields.title")}</span><input disabled={locked || !can("verification_copy_edit")} maxLength={80} value={copyLocale.title} onChange={(event) => updateCopyLocale({ title: event.target.value })} /></label>
                <label className="field"><span>{t("messages.fields.subtitle")}</span><input disabled={locked || !can("verification_copy_edit")} maxLength={120} value={copyLocale.subtitle} onChange={(event) => updateCopyLocale({ subtitle: event.target.value })} /></label>
                <label className="field"><span>{t("messages.fields.description")}</span><textarea disabled={locked || !can("verification_copy_edit")} maxLength={600} value={copyLocale.description} onChange={(event) => updateCopyLocale({ description: event.target.value })} /></label>
                <label className="field"><span>{t("messages.fields.overdueDescription")}</span><textarea disabled={locked || !can("verification_copy_edit")} maxLength={600} value={copyLocale.overdue_description ?? ""} onChange={(event) => updateCopyLocale({ overdue_description: event.target.value || null })} /></label>
                <label className="field"><span>{t("messages.fields.attentionNote")}</span><textarea disabled={locked || !can("verification_copy_edit")} maxLength={300} value={copyLocale.attention_note ?? ""} onChange={(event) => updateCopyLocale({ attention_note: event.target.value || null })} /></label>
                <label className="field"><span>{t("messages.fields.primaryAction")}</span><select disabled={locked || !can("verification_copy_edit")} value={copyDraft.behavior.primary_action} onChange={(event) => updateCopyAction("primary_action", event.target.value as VerificationCopyBehavior["primary_action"])}>{(["automatic", "open_verification_center", "url", "none"] as const).map((action) => <option value={action} key={action}>{t(`messages.behaviorActions.${action}`)}</option>)}</select></label>
                {copyDraft.behavior.primary_action !== "none" ? <label className="field"><span>{t("messages.fields.primaryLabel")}</span><input disabled={locked || !can("verification_copy_edit")} maxLength={40} value={copyLocale.primary_label ?? ""} onChange={(event) => updateCopyLocale({ primary_label: event.target.value })} /></label> : null}
                {copyDraft.behavior.primary_action === "url" ? <label className="field"><span>{t("messages.fields.primaryUrl")}</span><input disabled={locked || !can("verification_copy_edit")} type="url" maxLength={2048} value={copyDraft.behavior.primary_url ?? ""} onChange={(event) => setCopyDraft({ ...copyDraft, behavior: { ...copyDraft.behavior, primary_url: event.target.value } })} /></label> : null}
                <label className="field"><span>{t("messages.fields.secondaryAction")}</span><select disabled={locked || !can("verification_copy_edit")} value={copyDraft.behavior.secondary_action} onChange={(event) => updateCopyAction("secondary_action", event.target.value as VerificationCopyBehavior["secondary_action"])}>{(["open_verification_center", "url", "none"] as const).map((action) => <option value={action} key={action}>{t(`messages.behaviorActions.${action}`)}</option>)}</select></label>
                {copyDraft.behavior.secondary_action !== "none" ? <label className="field"><span>{t("messages.fields.secondaryLabel")}</span><input disabled={locked || !can("verification_copy_edit")} maxLength={40} value={copyLocale.secondary_label ?? ""} onChange={(event) => updateCopyLocale({ secondary_label: event.target.value })} /></label> : null}
                {copyDraft.behavior.secondary_action === "url" ? <label className="field"><span>{t("messages.fields.secondaryUrl")}</span><input disabled={locked || !can("verification_copy_edit")} type="url" maxLength={2048} value={copyDraft.behavior.secondary_url ?? ""} onChange={(event) => setCopyDraft({ ...copyDraft, behavior: { ...copyDraft.behavior, secondary_url: event.target.value } })} /></label> : null}
                <label className="field"><span>{t("messages.fields.cancelLabel")}</span><input disabled={locked || !can("verification_copy_edit")} maxLength={40} value={copyLocale.cancel_label} onChange={(event) => updateCopyLocale({ cancel_label: event.target.value })} /></label>
                {copyDraft.copy_key.startsWith("feature.") && copyDraft.active ? <label className="field"><span>{t("live.removeReason")}</span><textarea disabled={locked || !can("verification_copy_edit")} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
                <div className="row-actions">
                  <button type="button" className="button button-danger" disabled={locked || !can("verification_copy_edit") || !copyDraft.copy_key.startsWith("feature.") || !copyDraft.active || reason.trim() === ""} onClick={removeCopy}>{t("live.removeOverride")}</button>
                  <button type="button" className="button button-primary" disabled={locked || !can("verification_copy_edit") || !copyCanSave} onClick={saveCopy}>{t("live.saveCopy")}</button>
                </div>
              </> : null}
            </div>
          </section>
          <section className="panel">
            <div className="panel-header"><h2>{t("live.pendingSettings")}</h2></div>
            <div className="panel-body form-stack">
              <label className="field"><span>{t("live.overdueSeconds")}</span><input disabled={locked || !can("verification_copy_edit")} type="number" min={300} max={86400} value={pendingOverdue} onChange={(event) => setPendingOverdue(event.target.value)} /></label>
              <label className="checkbox-field"><input type="checkbox" checked={pendingLongCopy} disabled aria-describedby="verification-long-copy-v1-help" /><span>{t("live.longCopy")}</span></label>
              <small id="verification-long-copy-v1-help" className="field-hint">{t("live.longCopyV1Unavailable")}</small>
              <label className="field"><span>{t("live.thresholdSeconds")}</span><input disabled={locked || !can("verification_copy_edit")} type="number" min={300} max={86400} value={pendingThreshold} onChange={(event) => setPendingThreshold(event.target.value)} /></label>
              <button type="button" className="button button-primary" disabled={locked || !can("verification_copy_edit")} onClick={savePendingSettings}>{t("live.savePending")}</button>
              <dl className="detail-list"><div className="detail-row"><dt>{t("live.pendingTotal")}</dt><dd>{summary.total}</dd></div><div className="detail-row"><dt>{t("live.inSla")}</dt><dd>{summary.in_sla}</dd></div><div className="detail-row"><dt>{t("live.overdue")}</dt><dd>{summary.overdue}</dd></div></dl>
            </div>
          </section>
          {copyDraft && copyLocale ? <aside className={`verification-gate-preview preview-${copyVariant}`} aria-label={t("messages.previewLabel")}>
            <div className="verification-phone-status"><span>9:41</span><span>{copyEditorLocale.toUpperCase()}</span></div>
            <div className="verification-gate-sheet">
              <span className="verification-gate-icon" aria-hidden="true">{copyPreviewIcon}</span>
              <h3>{copyLocale.title || t("messages.emptyPreview")}</h3>
              {copyLocale.subtitle ? <strong>{copyLocale.subtitle}</strong> : null}
              {copyLocale.attention_note ? <p>{copyLocale.attention_note}</p> : null}
              {copyLocale.description ? <p>{copyLocale.description}</p> : null}
              {copyVariant === "pending" && copyLocale.overdue_description ? <p>{copyLocale.overdue_description}</p> : null}
              {copyDraft.behavior.primary_action !== "none" ? <button type="button" tabIndex={-1} aria-disabled="true">{copyLocale.primary_label || t("messages.emptyAction")}</button> : null}
              {copyDraft.behavior.secondary_action !== "none" ? <button type="button" className="verification-preview-secondary" tabIndex={-1} aria-disabled="true">{copyLocale.secondary_label || t("messages.emptyAction")}</button> : null}
              <button type="button" className="verification-preview-secondary" tabIndex={-1} aria-disabled="true">{copyLocale.cancel_label || t("messages.emptyCancel")}</button>
            </div>
            <small>{t("messages.nonInteractive")}</small>
          </aside> : null}
        </div> : null}

        {tab === "badges" ? <section className="panel">
          <div className="panel-header"><div><h2>{t("badges.title")}</h2><p>{t("badges.copy")}</p></div></div>
          <div className="panel-body form-stack">
            <p className="field-hint">{t("badges.limit", { size: 2 })}</p>
            <div className="verification-badge-grid">{data.badges.map((asset) => <article key={asset.slot} className="verification-badge-card">
              <h3>{t(`badges.slots.${asset.slot}`)}</h3>
              <small>{t("live.revision", { revision: asset.revision })}</small>
              <div className="verification-badge-previews">{([16, 24, 40] as const).map((size) => <div key={size}>
                <span className="verification-badge-stage stage-dark">{asset.managed_url ? <img src={asset.managed_url} alt="" width={size} height={size} /> : <b style={{ width: size, height: size }}>{badgeSymbol(asset.slot)}</b>}</span>
                <span className="verification-badge-stage stage-light">{asset.managed_url ? <img src={asset.managed_url} alt="" width={size} height={size} /> : <b style={{ width: size, height: size }}>{badgeSymbol(asset.slot)}</b>}</span>
                <small>{size}px</small>
              </div>)}</div>
              {!asset.managed_url ? <span className="verification-badge-placeholder">{t("live.fallback")}</span> : null}
              <input type="file" accept="image/png" disabled={locked || !can("verification_badge_edit")} onChange={(event) => { const file = event.target.files?.[0]; if (file) setBadgeFiles((current) => ({ ...current, [asset.slot]: file })); }} />
              <div className="row-actions"><button type="button" className="button button-danger button-small" disabled={locked || !can("verification_badge_edit") || !asset.active || reason.trim() === ""} onClick={() => removeBadge(asset)}>{t("live.remove")}</button><button type="button" className="button button-primary button-small" disabled={locked || !can("verification_badge_edit") || !badgeFiles[asset.slot]} onClick={() => void uploadBadge(asset)}>{t("live.upload")}</button></div>
            </article>)}</div>
            <label className="field"><span>{t("live.reason")}</span><textarea disabled={locked || !can("verification_badge_edit")} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
        </section> : null}

        {tab === "simulator" ? <div className="section-grid">
          <section className="panel">
            <div className="panel-header"><div><h2>{t("simulator.inputsTitle")}</h2><p>{t("simulator.inputsCopy")}</p></div></div>
            <div className="panel-body form-stack">
              <label className="field"><span>{t("simulator.scope")}</span><select disabled={locked || !can("verification_simulate")} value={simulationScope} onChange={(event) => setSimulationScope(event.target.value)}>{data.policies.map((row) => <option value={row.scope_key} key={row.scope_key}>{row.scope.display}</option>)}</select></label>
              {VERIFICATION_METHODS.map((method) => <fieldset className="verification-provenance-card" key={method}>
                <legend>{t(`methods.${method}`)}</legend>
                <label className="field"><span>{t("simulator.methodStatus")}</span><select disabled={locked || !can("verification_simulate")} value={simulation[method].status} onChange={(event) => {
                  const status = event.target.value as VerificationMethodStatus;
                  updateSimulationMethod(method, { status, pending_age_seconds: status === "pending" ? simulation[method].pending_age_seconds ?? 60 : null });
                }}>{VERIFICATION_METHOD_STATUSES.map((status) => <option value={status} key={status}>{t(`statuses.${status}`)}</option>)}</select></label>
                {simulation[method].status === "pending" ? <label className="field"><span>{t("simulator.pendingAge")}</span><input disabled={locked || !can("verification_simulate")} type="number" min={0} max={2_592_000} value={simulation[method].pending_age_seconds ?? ""} onChange={(event) => updateSimulationMethod(method, { pending_age_seconds: event.target.value === "" ? null : Number(event.target.value) })} /></label> : null}
                <label className="field"><span>{t("simulator.attempt")}</span><input disabled={locked || !can("verification_simulate")} type="number" min={1} max={method === "video" ? 5 : undefined} value={simulation[method].attempt ?? ""} onChange={(event) => updateSimulationMethod(method, { attempt: event.target.value === "" ? null : Number(event.target.value) })} /></label>
                <label className="checkbox-field"><input disabled={locked || !can("verification_simulate")} type="checkbox" checked={simulation[method].retry_available} onChange={(event) => updateSimulationMethod(method, { retry_available: event.target.checked })} /><span>{t("simulator.retryAvailable")}</span></label>
              </fieldset>)}
              <label className="field"><span>{t("simulator.imported")}</span><select disabled={locked || !can("verification_simulate")} value={simulation.imported_level} onChange={(event) => {
                const level = event.target.value as VerificationLevel;
                setSimulation({ ...simulation, imported_level: level, imported_method_hint: level === "none" ? null : simulation.imported_method_hint ?? "manual" });
              }}>{VERIFICATION_LEVELS.map((level) => <option value={level} key={level}>{t(`levels.${level}`)}</option>)}</select></label>
              {simulation.imported_level !== "none" ? <label className="field"><span>{t("simulator.importedHint")}</span><select disabled={locked || !can("verification_simulate")} value={simulation.imported_method_hint ?? "manual"} onChange={(event) => setSimulation({ ...simulation, imported_method_hint: event.target.value as "video" | "persona" | "manual" })}>{(["video", "persona", "manual"] as const).map((hint) => <option value={hint} key={hint}>{t(`methodHints.${hint}`)}</option>)}</select></label> : null}
              <label className="field"><span>{t("simulator.grant")}</span><select disabled={locked || !can("verification_simulate")} value={simulation.grant_level} onChange={(event) => setSimulation({ ...simulation, grant_level: event.target.value as VerificationLevel })}>{VERIFICATION_LEVELS.map((level) => <option value={level} key={level}>{t(`levels.${level}`)}</option>)}</select></label>
              <label className="checkbox-field"><input disabled={locked || !can("verification_simulate")} type="checkbox" checked={simulation.badge_visible} onChange={(event) => setSimulation({ ...simulation, badge_visible: event.target.checked })} /><span>{t("simulator.badgeVisible")}</span></label>
              <button type="button" className="button button-primary" disabled={locked || !can("verification_simulate")} onClick={() => void runSimulation()}>{t("live.runSimulation")}</button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header"><div><h2>{t("simulator.outputTitle")}</h2><p>{t("simulator.outputCopy")}</p></div></div>
            <div className="panel-body">{simulationResult ? <><div className="verification-queue-metric"><strong>{t(`levels.${simulationResult.effective_level}`)}</strong><span>{t(`sources.${simulationResult.effective_source}`)}</span></div><div className="verification-simulator-features">{simulationResult.feature_access.map((row) => <article key={row.feature}><strong>{t(`features.${row.feature}.title`)}</strong><span className={`status-badge ${row.allowed ? "status-accepted" : "status-denied"}`}>{row.allowed ? t("simulator.allowed") : t("simulator.blocked")}</span><small>{row.modal?.title ?? t(`requirements.values.${row.required_tier}`)}</small></article>)}</div></> : <p className="page-subtitle">{t("live.noSimulation")}</p>}</div>
          </section>
        </div> : null}
      </div>
      <div className="alert alert-info page-alert"><strong>{t("live.importHealth")}</strong> {data.import_health.invalid}/{data.import_health.total}</div>
    </>
  );
}
