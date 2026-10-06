"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";

type Policy = {
  country_code: string;
  max_distance_km: number;
  active: boolean;
  updated_at: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function policy(value: unknown): Policy | null {
  const source = record(value);
  const code = typeof source?.country_code === "string" ? source.country_code : "";
  const distance = Number(source?.max_distance_km);
  if (!(code === "*" || /^[A-Z]{2}$/.test(code)) || !Number.isInteger(distance) || distance < 1 || distance > 1000) return null;
  return {
    country_code: code,
    max_distance_km: distance,
    active: source?.active === true,
    updated_at: Math.max(0, Number(source?.updated_at) || 0),
  };
}

function payload(value: unknown): { global: Policy; countries: Policy[] } | null {
  const source = record(value);
  const global = policy(source?.global);
  if (!global || global.country_code !== "*" || !Array.isArray(source?.countries)) return null;
  const countries = source.countries.map(policy);
  return countries.every((item): item is Policy => item !== null)
    ? { global, countries }
    : null;
}

export default function ProfileLocationPage() {
  const t = useTranslations("profileLocation");
  const common = useTranslations("common");
  const [data, setData] = useState<{ global: Policy; countries: Policy[] } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [countryCode, setCountryCode] = useState("");
  const [globalDistance, setGlobalDistance] = useState("100");
  const [countryDistance, setCountryDistance] = useState("100");
  const [countryActive, setCountryActive] = useState(true);
  const [editingCountry, setEditingCountry] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const response = await adminCall("profile_location_policies");
    const parsed = response?.success ? payload(response.data) : null;
    if (!parsed) {
      setState("error");
      return;
    }
    setData(parsed);
    setGlobalDistance(String(parsed.global.max_distance_km));
    setCountryDistance(String(parsed.global.max_distance_km));
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(code: string, value: number, active = true) {
    setBusy(code);
    setNotice(null);
    const response = await adminCall("save_profile_location_policy", {
      country_code: code,
      max_distance_km: value,
      active,
    });
    const parsed = response?.success ? payload(response.data) : null;
    setBusy("");
    if (!parsed) {
      setNotice({ tone: "error", text: t("saveError") });
      return;
    }
    setData(parsed);
    setCountryCode("");
    setCountryActive(true);
    setEditingCountry("");
    setGlobalDistance(String(parsed.global.max_distance_km));
    setCountryDistance(String(parsed.global.max_distance_km));
    setNotice({ tone: "success", text: t("saved") });
  }

  async function remove(code: string) {
    if (!window.confirm(t("deleteConfirm", { country: code }))) return;
    setBusy(code);
    const response = await adminCall("delete_profile_location_policy", { country_code: code });
    const parsed = response?.success ? payload(response.data) : null;
    setBusy("");
    if (!parsed) {
      setNotice({ tone: "error", text: t("saveError") });
      return;
    }
    setData(parsed);
    if (editingCountry === code) {
      setCountryCode("");
      setCountryActive(true);
      setEditingCountry("");
      setCountryDistance(String(parsed.global.max_distance_km));
    }
    setNotice({ tone: "success", text: t("deleted") });
  }

  function edit(item: Policy) {
    setNotice(null);
    setCountryCode(item.country_code);
    setCountryDistance(String(item.max_distance_km));
    setCountryActive(item.active);
    setEditingCountry(item.country_code);
  }

  function cancelEdit() {
    setCountryCode("");
    setCountryDistance(String(data?.global.max_distance_km ?? 100));
    setCountryActive(true);
    setEditingCountry("");
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !data) return <ErrorPanel message={t("loadError")} retry={load} />;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {notice ? <div className={`alert ${notice.tone === "error" ? "alert-error" : "alert-success"} page-alert`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div> : null}
      <div className="profile-location-policy-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("globalTitle")}</h2><p>{t("globalCopy")}</p></div></div>
          <div className="panel-body profile-location-policy-form">
            <label><span>{t("distance")}</span><input type="number" min="1" max="1000" value={globalDistance} onChange={(event) => setGlobalDistance(event.target.value)} /></label>
            <button type="button" className="button button-primary" disabled={Boolean(busy) || Number(globalDistance) < 1 || Number(globalDistance) > 1000} onClick={() => void save("*", Number(globalDistance))}>{busy === "*" ? common("loading") : common("save")}</button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><div><h2>{t("overrideTitle")}</h2><p>{t("overrideCopy")}</p></div></div>
          <div className="panel-body profile-location-policy-form is-country">
            <label><span>{t("country")}</span><input value={countryCode} maxLength={2} placeholder="HU" disabled={Boolean(editingCountry)} onChange={(event) => setCountryCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} /></label>
            <label><span>{t("distance")}</span><input type="number" min="1" max="1000" value={countryDistance} onChange={(event) => setCountryDistance(event.target.value)} /></label>
            <label className="checkbox-field profile-location-active"><input type="checkbox" checked={countryActive} onChange={(event) => setCountryActive(event.target.checked)} /><span>{common("active")}</span></label>
            <div className="profile-location-form-actions">
              {editingCountry ? <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={cancelEdit}>{common("cancel")}</button> : null}
              <button type="button" className="button button-primary" disabled={Boolean(busy) || !/^[A-Z]{2}$/.test(countryCode) || Number(countryDistance) < 1 || Number(countryDistance) > 1000} onClick={() => void save(countryCode, Number(countryDistance), countryActive)}>{busy === countryCode ? common("loading") : common("save")}</button>
            </div>
          </div>
        </section>
      </div>
      <section className="panel profile-location-overrides">
        <div className="panel-header"><h2>{t("currentOverrides")}</h2></div>
        <div className="panel-body">
          {data.countries.length === 0 ? <p className="page-subtitle">{t("noOverrides")}</p> : (
            <div className="table-wrap"><table><thead><tr><th>{t("country")}</th><th>{t("distance")}</th><th>{t("status")}</th><th /></tr></thead><tbody>
              {data.countries.map((item) => <tr key={item.country_code}><td><strong>{item.country_code}</strong></td><td>{item.max_distance_km} km</td><td>{item.active ? common("active") : common("inactive")}</td><td><div className="row-actions"><button type="button" className="button button-secondary button-small" disabled={Boolean(busy)} onClick={() => edit(item)}>{common("edit")}</button><button type="button" className="button button-danger button-small" disabled={Boolean(busy)} onClick={() => void remove(item.country_code)}>{common("delete")}</button></div></td></tr>)}
            </tbody></table></div>
          )}
        </div>
      </section>
    </>
  );
}
