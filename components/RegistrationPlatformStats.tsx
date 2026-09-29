"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";
import { registeredUsersHref } from "@/lib/registeredUsers";
import {
  REGISTRATION_STATS_RANGES,
  SIGNUP_PLATFORMS,
  chartTicks,
  dayTotal,
  registrationPlatformStats,
  registrationStatsFailure,
  share,
  type RegistrationBlock,
  type RegistrationDay,
  type RegistrationPlatformStats as Stats,
  type RegistrationStatsFailure,
  type RegistrationStatsRange,
  type SignupPlatform,
} from "@/lib/registrationStats";

const CHART_HEIGHT = 220;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 28;
const AXIS_WIDTH = 34;
const BAR_MAX = 24;
const SEGMENT_GAP = 2;

/** A column whose top segment has the 4px rounded data-end and a square foot on the baseline. */
function segmentPath(x: number, y: number, width: number, height: number, rounded: boolean): string {
  const radius = rounded ? Math.min(4, width / 2, height) : 0;
  return `M${x},${y + height}V${y + radius}${radius ? `Q${x},${y} ${x + radius},${y}` : ""}H${x + width - radius}`
    + `${radius ? `Q${x + width},${y} ${x + width},${y + radius}` : ""}V${y + height}Z`;
}

function dayLabel(date: string, locale: string, withWeekday = false): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    month: "short", day: "numeric", ...(withWeekday ? { weekday: "short" } : {}), timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function DailyChart({ daily, platforms, locale }: {
  daily: RegistrationDay[];
  platforms: readonly SignupPlatform[];
  locale: string;
}) {
  const t = useTranslations("registrationStats");
  const wrap = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(0, ...daily.map(dayTotal));
  const scale = chartTicks(max);
  const top = scale[scale.length - 1]!;
  const plotWidth = Math.max(0, width - AXIS_WIDTH);
  const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const band = daily.length > 0 ? plotWidth / daily.length : 0;
  const barWidth = Math.max(2, Math.min(BAR_MAX, band - SEGMENT_GAP));
  const y = (value: number) => PLOT_TOP + plotHeight - (top > 0 ? (value / top) * plotHeight : 0);
  const labelEvery = daily.length > 45 ? 15 : 7;
  const activeDay = active === null ? null : daily[active] ?? null;

  return (
    <div className="registration-chart" ref={wrap} onMouseLeave={() => setActive(null)}>
      {width > 0 ? (
        <svg
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label={t("chartLabel", { days: daily.length, total: daily.reduce((sum, row) => sum + dayTotal(row), 0) })}
        >
          {scale.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "registration-chart-baseline" : "registration-chart-grid"}
                x1={AXIS_WIDTH}
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="registration-chart-tick" x={AXIS_WIDTH - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {formatNumber(tick, locale)}
              </text>
            </g>
          ))}
          {daily.map((row, index) => {
            const x = AXIS_WIDTH + index * band + (band - barWidth) / 2;
            const present = platforms.filter((platform) => row[platform] > 0);
            let base = 0;
            return (
              <g key={row.date}>
                {present.map((platform, position) => {
                  const from = y(base) - (position > 0 ? SEGMENT_GAP : 0);
                  base += row[platform];
                  const to = y(base);
                  const height = Math.max(1, from - to);
                  return (
                    <path
                      key={platform}
                      className={`registration-fill-${platform}`}
                      d={segmentPath(x, from - height, barWidth, height, position === present.length - 1)}
                    />
                  );
                })}
                {(daily.length - 1 - index) % labelEvery === 0 ? (
                  <text
                    className="registration-chart-tick"
                    x={index === daily.length - 1 ? width : AXIS_WIDTH + index * band + band / 2}
                    y={CHART_HEIGHT - 8}
                    textAnchor={index === daily.length - 1 ? "end" : "middle"}
                  >
                    {index === daily.length - 1 ? t("today") : dayLabel(row.date, locale)}
                  </text>
                ) : null}
                <rect
                  className="registration-chart-hit"
                  x={AXIS_WIDTH + index * band}
                  y={PLOT_TOP}
                  width={band}
                  height={plotHeight}
                  onMouseEnter={() => setActive(index)}
                  onPointerDown={() => setActive(index)}
                />
              </g>
            );
          })}
          {active !== null ? (
            <rect
              className="registration-chart-focus"
              x={AXIS_WIDTH + active * band}
              y={PLOT_TOP}
              width={band}
              height={plotHeight}
              pointerEvents="none"
            />
          ) : null}
        </svg>
      ) : null}
      {activeDay && active !== null ? (
        <div
          className="registration-tooltip"
          role="status"
          style={{ left: Math.min(Math.max(AXIS_WIDTH + active * band + band / 2, 90), Math.max(90, width - 90)) }}
        >
          <strong>{dayLabel(activeDay.date, locale, true)}</strong>
          {platforms.map((platform) => (
            <span key={platform} className="registration-tooltip-row">
              <i className={`registration-swatch registration-swatch-${platform}`} aria-hidden="true" />
              {t(`platforms.${platform}`)}<b>{formatNumber(activeDay[platform], locale)}</b>
            </span>
          ))}
          <span className="registration-tooltip-row is-total">{t("dayTotal")}<b>{formatNumber(dayTotal(activeDay), locale)}</b></span>
          <span className="registration-tooltip-row is-muted">{t("dayDeleted")}<b>{formatNumber(activeDay.deleted, locale)}</b></span>
        </div>
      ) : null}
    </div>
  );
}

function Percent({ part, whole, locale }: { part: number; whole: number; locale: string }) {
  return <>{formatNumber(part, locale)} <small>({share(part, whole)}%)</small></>;
}

export type RegistrationStatsState = "loading" | "ready" | RegistrationStatsFailure;

/** The panel body for one read; pure so both locales and every state can be rendered in tests. */
export function RegistrationPlatformStatsView({
  data,
  state,
  range,
  onRange,
  onReload,
}: {
  data: Stats | null;
  state: RegistrationStatsState;
  range: RegistrationStatsRange;
  onRange: (days: RegistrationStatsRange) => void;
  onReload: () => void;
}) {
  const t = useTranslations("registrationStats");
  const locale = useLocale();

  // Unknown is shown only when some registration actually lacks a platform.
  const shown = useMemo<SignupPlatform[]>(() => SIGNUP_PLATFORMS.filter((platform) => platform !== "unknown"
    || (data?.platforms.unknown.registered ?? 0) > 0), [data]);
  const columns: { key: SignupPlatform | "all"; block: RegistrationBlock }[] = data
    ? [...shown.map((platform) => ({ key: platform, block: data.platforms[platform] })), { key: "all" as const, block: data.all }]
    : [];
  const rangeTotal = data ? data.daily.reduce((sum, row) => sum + dayTotal(row), 0) : 0;
  const rows: { key: string; label: string; value: (block: RegistrationBlock) => React.ReactNode }[] = [
    { key: "registered", label: t("rows.registered"), value: (block) => <strong>{formatNumber(block.registered, locale)}</strong> },
    { key: "accounts", label: t("rows.accounts"), value: (block) => formatNumber(block.accounts, locale) },
    { key: "deleted", label: t("rows.deleted"), value: (block) => formatNumber(block.deleted, locale) },
    { key: "newToday", label: t("rows.newToday"), value: (block) => formatNumber(block.new_today, locale) },
    { key: "new7", label: t("rows.new7"), value: (block) => formatNumber(block.new_7_days, locale) },
    { key: "new30", label: t("rows.new30"), value: (block) => formatNumber(block.new_30_days, locale) },
    { key: "deleted30", label: t("rows.deleted30"), value: (block) => formatNumber(block.deleted_30_days, locale) },
    {
      key: "legacy",
      label: t("rows.legacy"),
      value: (block) => <>
        {formatNumber(block.legacy_converted, locale)}
        {block.legacy_converted_30_days > 0 ? <small> ({t("rows.legacy30", { count: block.legacy_converted_30_days })})</small> : null}
      </>,
    },
    { key: "photo", label: t("rows.photo"), value: (block) => <Percent part={block.with_photo} whole={block.accounts} locale={locale} /> },
    { key: "active7", label: t("rows.active7"), value: (block) => <Percent part={block.active_7_days} whole={block.accounts} locale={locale} /> },
    { key: "signedIn30", label: t("rows.signedIn30"), value: (block) => formatNumber(block.signed_in_30_days, locale) },
    { key: "suspended", label: t("rows.suspended"), value: (block) => formatNumber(block.suspended, locale) },
    { key: "male", label: t("rows.male"), value: (block) => <Percent part={block.gender.male} whole={block.accounts} locale={locale} /> },
    { key: "female", label: t("rows.female"), value: (block) => <Percent part={block.gender.female} whole={block.accounts} locale={locale} /> },
    { key: "otherGender", label: t("rows.otherGender"), value: (block) => <Percent part={block.gender.other} whole={block.accounts} locale={locale} /> },
    {
      key: "countries",
      label: t("rows.countries"),
      value: (block) => block.top_countries.length > 0
        ? block.top_countries
          .map((country) => `${country.country_code || t("unknownCountry")} ${formatNumber(country.count, locale)}`)
          .join(" · ")
        : "—",
    },
  ];
  const failure = state === "daysInvalid" || state === "unavailable" || state === "error" ? state : null;

  return (
    <section className="panel registration-stats" aria-labelledby="registration-stats-title" data-registration-stats-state={state}>
      <div className="panel-header">
        <div><h2 id="registration-stats-title">{t("title")}</h2><p>{t("subtitle")}</p></div>
        <div className="row-actions">
          <div className="segmented-control" role="group" aria-label={t("rangeLabel")}>
            {REGISTRATION_STATS_RANGES.map((days) => (
              <button
                key={days}
                type="button"
                className={range === days ? "active" : ""}
                aria-pressed={range === days}
                onClick={() => onRange(days)}
              >
                {t("rangeDays", { days })}
              </button>
            ))}
          </div>
          <button className="button button-secondary button-small" type="button" disabled={state === "loading"} onClick={onReload}>
            {t("reload")}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {failure ? <div className="alert alert-error" role="alert">{t(`failures.${failure}`)}</div> : null}
        {state === "loading" && !data ? <p className="page-subtitle">{t("loading")}</p> : null}
        {data ? (
          <div className={state === "loading" ? "registration-stats-body is-refreshing" : "registration-stats-body"}>
            <div className="registration-tiles">
              {shown.map((platform) => {
                const block = data.platforms[platform];
                return (
                  <article className="registration-tile" key={platform}>
                    <span className="registration-tile-label">
                      <i className={`registration-swatch registration-swatch-${platform}`} aria-hidden="true" />
                      {t(`platforms.${platform}`)}
                      <small>{t("shareOfAll", { share: share(block.registered, data.all.registered) })}</small>
                    </span>
                    <strong className="registration-tile-value">{formatNumber(block.registered, locale)}</strong>
                    <span className="registration-tile-meta">{t("tileAccounts", { accounts: block.accounts, deleted: block.deleted })}</span>
                    <span className="registration-tile-meta">{t("tileRecent", {
                      today: block.new_today, week: block.new_7_days, month: block.new_30_days,
                    })}</span>
                    <Link className="button-link" href={registeredUsersHref(platform, "real")} prefetch={false}>{t("openList")}</Link>
                  </article>
                );
              })}
            </div>
            <p className="registration-list-note">{t("openListNote")}</p>

            <div className="registration-chart-head">
              <h3>{t("chartTitle", { days: data.days })}</h3>
              <span>{t("chartTotal", { total: rangeTotal })}</span>
            </div>
            <ul className="registration-legend" aria-label={t("legendLabel")}>
              {shown.map((platform) => (
                <li key={platform}>
                  <i className={`registration-swatch registration-swatch-${platform}`} aria-hidden="true" />{t(`platforms.${platform}`)}
                </li>
              ))}
            </ul>
            <DailyChart daily={data.daily} platforms={shown} locale={locale} />
            <details className="registration-daily-table">
              <summary>{t("dailyTable")}</summary>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("date")}</th>
                      {shown.map((platform) => <th scope="col" key={platform}>{t(`platforms.${platform}`)}</th>)}
                      <th scope="col">{t("dayTotal")}</th>
                      <th scope="col">{t("dayDeleted")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.daily].reverse().map((row) => (
                      <tr key={row.date}>
                        <th scope="row">{dayLabel(row.date, locale, true)}</th>
                        {shown.map((platform) => <td key={platform}>{formatNumber(row[platform], locale)}</td>)}
                        <td><strong>{formatNumber(dayTotal(row), locale)}</strong></td>
                        <td>{formatNumber(row.deleted, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <h3 className="registration-section-title">{t("detailsTitle")}</h3>
            <div className="table-wrap">
              <table className="data-table registration-details">
                <thead>
                  <tr>
                    <th scope="col">{t("metric")}</th>
                    {columns.map((column) => (
                      <th scope="col" key={column.key}>
                        {column.key === "all" ? t("allPlatforms") : <>
                          <i className={`registration-swatch registration-swatch-${column.key}`} aria-hidden="true" />
                          {t(`platforms.${column.key}`)}
                        </>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      {columns.map((column) => <td key={column.key}>{row.value(column.block)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="registration-notes">
              <li>{t("notes.scope")}</li>
              <li>{t("notes.deleted")}</li>
              <li>{t("notes.legacy")}</li>
              <li>{t("notes.signedIn")}</li>
              <li>{t("notes.generated", { time: formatDate(data.generated_at, locale, true) })}</li>
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Registrations per signup platform on the overview. It loads on its own: an unavailable Core
 * provider leaves the rest of the overview untouched, and a failed read says so instead of zeros.
 */
export default function RegistrationPlatformStats() {
  const [range, setRange] = useState<RegistrationStatsRange>(30);
  const [data, setData] = useState<Stats | null>(null);
  const [state, setState] = useState<RegistrationStatsState>("loading");
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (days: RegistrationStatsRange) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState("loading");
    const response = await adminCall("registration_platform_stats", { days }, controller.signal);
    if (controller.signal.aborted) return;
    const parsed = registrationPlatformStats(response, days);
    if (!parsed) {
      setState(registrationStatsFailure(response));
      return;
    }
    setData(parsed);
    setState("ready");
  }, []);

  useEffect(() => {
    void load(range);
    return () => inFlight.current?.abort();
  }, [load, range]);

  return (
    <RegistrationPlatformStatsView
      data={data}
      state={state}
      range={range}
      onRange={setRange}
      onReload={() => void load(range)}
    />
  );
}
