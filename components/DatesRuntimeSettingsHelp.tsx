"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  DATES_RUNTIME_HELP_GROUPS,
  DATES_RUNTIME_HELP_KEY_SET,
} from "@/lib/datesRuntimeHelp";

type HelpSetting = {
  key: string;
  type: string;
  value: unknown;
  effective_value: unknown;
  default_value: unknown;
  minimum: number | null;
  maximum: number | null;
  allowed_values: string[] | null;
  valid: boolean;
};

function displayValue(
  value: unknown,
  type: string,
  emptyLabel: string,
  enabledLabel: string,
  disabledLabel: string,
): string {
  if (value === null || value === undefined || value === "") return emptyLabel;
  if (type === "quiet_hours" && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return `${String(row.start || "—")}–${String(row.end || "—")}`;
  }
  if (typeof value === "boolean") return value ? enabledLabel : disabledLabel;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SettingHelpCard({ settingKey, setting }: { settingKey: string; setting?: HelpSetting }) {
  const t = useTranslations("datesAdmin.configuration.runtimeHelp");
  const common = useTranslations("common");
  const type = setting?.type ?? "unknown";
  const emptyLabel = t("notSet");
  const value = (item: unknown) => displayValue(
    item,
    type,
    emptyLabel,
    common("enabled"),
    common("disabled"),
  );

  return (
    <article className="dates-help-card">
      <div className="dates-help-card-heading">
        <div>
          <h4>{t(`settings.${settingKey}.title`)}</h4>
          <code>{settingKey}</code>
        </div>
        {setting && (
          <span className={`badge ${setting.valid ? "badge-active" : "badge-warning"}`}>
            {setting.valid ? t("valid") : t("invalid")}
          </span>
        )}
      </div>

      <dl className="dates-help-values">
        <div>
          <dt>{t("effectiveValue")}</dt>
          <dd>{setting ? value(setting.effective_value) : t("notReturned")}</dd>
        </div>
        <div>
          <dt>{t("storedValue")}</dt>
          <dd>{setting ? value(setting.value) : t("notReturned")}</dd>
        </div>
        <div>
          <dt>{t("defaultValue")}</dt>
          <dd>{setting ? value(setting.default_value) : t("notReturned")}</dd>
        </div>
        {setting && setting.minimum !== null && setting.maximum !== null && (
          <div>
            <dt>{t("allowedRange")}</dt>
            <dd>{setting.minimum}–{setting.maximum}</dd>
          </div>
        )}
        {setting?.allowed_values && setting.allowed_values.length > 0 && (
          <div>
            <dt>{t("allowedValues")}</dt>
            <dd>{setting.allowed_values.join(" · ")}</dd>
          </div>
        )}
      </dl>

      <div className="dates-help-detail">
        <p><strong>{t("purposeLabel")}</strong> {t(`settings.${settingKey}.purpose`)}</p>
        <p><strong>{t("effectLabel")}</strong> {t(`settings.${settingKey}.effect`)}</p>
        <p><strong>{t("cautionLabel")}</strong> {t(`settings.${settingKey}.caution`)}</p>
      </div>
    </article>
  );
}

export default function DatesRuntimeSettingsHelp({
  settings,
  onClose,
}: {
  settings: HelpSetting[];
  onClose: () => void;
}) {
  const t = useTranslations("datesAdmin.configuration.runtimeHelp");
  const common = useTranslations("common");
  const closeRef = useRef<HTMLButtonElement>(null);
  const settingsByKey = useMemo(
    () => new Map(settings.map((setting) => [setting.key, setting])),
    [settings],
  );
  const unknownSettings = settings.filter(
    (setting) => !DATES_RUNTIME_HELP_KEY_SET.has(setting.key),
  );

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="dialog dates-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dates-runtime-help-title"
        aria-describedby="dates-runtime-help-intro"
      >
        <div className="dialog-header dates-help-dialog-header">
          <div>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h2 id="dates-runtime-help-title">{t("title")}</h2>
          </div>
          <button
            ref={closeRef}
            className="dialog-close"
            type="button"
            onClick={onClose}
            aria-label={common("close")}
          >×</button>
        </div>

        <div className="dialog-body dates-help-body">
          <p id="dates-runtime-help-intro" className="dates-help-intro">{t("intro")}</p>

          <aside className="dates-help-rollout" aria-labelledby="dates-help-rollout-title">
            <h3 id="dates-help-rollout-title">{t("beforeChangingTitle")}</h3>
            <p>{t("beforeChangingCopy")}</p>
            <ol>
              <li>{t("rolloutStepRetention")}</li>
              <li>{t("rolloutStepWorker")}</li>
              <li>{t("rolloutStepMaster")}</li>
              <li>{t("rolloutStepCapabilities")}</li>
              <li>{t("rolloutStepVerify")}</li>
            </ol>
            <p className="dates-help-note"><strong>{t("effectiveNoteLabel")}</strong> {t("effectiveNote")}</p>
            <p className="dates-help-note"><strong>{t("timingNoteLabel")}</strong> {t("timingNote")}</p>
          </aside>

          <nav className="dates-help-nav" aria-label={t("sectionsLabel")}>
            {DATES_RUNTIME_HELP_GROUPS.map((group) => (
              <a key={group.id} href={`#dates-help-${group.id}`}>{t(`groups.${group.id}.title`)}</a>
            ))}
          </nav>

          <div className="dates-help-groups">
            {DATES_RUNTIME_HELP_GROUPS.map((group) => (
              <section className="dates-help-group" id={`dates-help-${group.id}`} key={group.id}>
                <div className="dates-help-group-heading">
                  <h3>{t(`groups.${group.id}.title`)}</h3>
                  <p>{t(`groups.${group.id}.copy`)}</p>
                </div>
                <div className="dates-help-grid">
                  {group.settingKeys.map((settingKey) => (
                    <SettingHelpCard
                      key={settingKey}
                      settingKey={settingKey}
                      setting={settingsByKey.get(settingKey)}
                    />
                  ))}
                </div>
              </section>
            ))}

            {unknownSettings.length > 0 && (
              <section className="dates-help-group">
                <div className="dates-help-group-heading">
                  <h3>{t("unknownTitle")}</h3>
                  <p>{t("unknownCopy")}</p>
                </div>
                <div className="dates-help-grid">
                  {unknownSettings.map((setting) => (
                    <article className="dates-help-card" key={setting.key}>
                      <div className="dates-help-card-heading">
                        <div><h4>{setting.key}</h4><code>{setting.key}</code></div>
                        <span className="badge badge-warning">{t("undocumented")}</span>
                      </div>
                      <p className="dates-help-unknown">{t("unknownSettingCopy")}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
