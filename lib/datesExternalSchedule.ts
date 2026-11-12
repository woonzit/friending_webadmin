/**
 * D-149 yield: how an external event's time is shown on the console - one-off timed events as before, multi-day spans
 * as a date range, all-day events without a clock time, and a span that is running as "until <last day>".
 *
 * Core's rules (docs/DATES_EXTERNAL_ADMIN_V1.md "Editor rules"; the member app follows the same, core.md "iOS"):
 * - an all-day event is stored from the local midnight that begins its first day to the local midnight that ends its
 *   last day: the end is EXCLUSIVE, so the last day shown is the day before `end_at`;
 * - a span is multi-day when it is longer than 25 hours (a clock-change all-day day is 25 hours long);
 * - a running span is one whose start has passed and whose end has not.
 * Pure: no clock of its own (the caller passes Core's `server_now`), no browser time zone (the event's own is used).
 */
export type DatesExternalScheduleInput = { start_at: number; end_at: number; start_local: string; end_local: string; timezone: string; all_day?: boolean };
type DatesExternalSchedule = {
  allDay: boolean; multiDay: boolean; running: boolean;
  /** The date or date range, with clock times only for a timed event. */
  text: string;
  /** The last day the event takes place, for "until <date>" (a running multi-day span only). */
  until: string | null;
};

const MULTI_DAY_SECONDS = 25 * 3600;
const midnight = (local: string) => /T00:00:00[+-]\d{2}:\d{2}$/.test(local);

/**
 * The list row carries no `all_day` (only the detail does). A row that runs from a local midnight to a local midnight
 * and lasts at least 23 hours is shown as all day - display only; nothing is decided on it.
 */
export function datesExternalLooksAllDay(row: DatesExternalScheduleInput): boolean {
  return row.all_day ?? (midnight(row.start_local) && midnight(row.end_local) && row.end_at - row.start_at >= 23 * 3600);
}

export function datesExternalSchedule(row: DatesExternalScheduleInput, now: number, locale: string): DatesExternalSchedule {
  const allDay = datesExternalLooksAllDay(row), multiDay = row.end_at - row.start_at > MULTI_DAY_SECONDS;
  const running = row.start_at <= now && now < row.end_at;
  // The last instant of the event: for an all-day event the second before its exclusive end.
  const last = allDay ? row.end_at - 1 : row.end_at;
  const dates = new Intl.DateTimeFormat(locale, { timeZone: row.timezone, dateStyle: "medium" });
  const withTime = new Intl.DateTimeFormat(locale, { timeZone: row.timezone, dateStyle: "medium", timeStyle: "short" });
  let text: string;
  if (allDay) text = multiDay ? dates.formatRange(row.start_at * 1000, last * 1000) : new Intl.DateTimeFormat(locale, { timeZone: row.timezone, dateStyle: "full" }).format(row.start_at * 1000);
  else text = multiDay ? withTime.formatRange(row.start_at * 1000, row.end_at * 1000) : withTime.format(row.start_at * 1000);
  return { allDay, multiDay, running, text, until: running && multiDay ? dates.format(last * 1000) : null };
}
