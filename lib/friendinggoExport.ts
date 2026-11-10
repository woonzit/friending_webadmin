import type { FriendingGoPreorder } from "@/lib/friendinggo";

/**
 * The FriendingGO preorder CSV (D-153, T-937), built on the server from Core's unmasked export:
 * UTF-8 with a byte-order mark (so a spreadsheet opens the names as UTF-8), RFC 4180 (CRLF lines,
 * a field with a comma, a quote, CR or LF in double quotes, quotes doubled), and a formula-injection
 * guard: a cell that a spreadsheet would read as a formula (`=`, `+`, `-`, `@`, tab or CR first) is
 * prefixed with a single quote. The column names are a data format, not console copy, so they stay
 * English in both locales.
 */

export const FRIENDINGGO_CSV_COLUMNS = [
  "Name",
  "First name",
  "Email",
  "Phone",
  "City",
  "City ID",
  "City from list",
  "Status",
  "Status changed (UTC)",
  "Status source",
  "Signed up (UTC)",
  "Consent version",
  "Consent captured (UTC)",
  "Source",
  "Confirmation email",
  "Preorder ID",
] as const;

const BOM = "﻿";
const FORMULA_START = /^[=+\-@\t\r]/u;

function isoUtc(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

/** One cell: the formula guard first, then RFC 4180 quoting when the value needs it. */
export function friendingGoCsvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, "\"\"")}"` : guarded;
}

export function friendingGoCsvRow(row: FriendingGoPreorder): string[] {
  return [
    row.name,
    row.first_name,
    row.email,
    row.phone ?? "",
    row.city_label,
    row.city_id ?? "",
    row.city_from_list ? "yes" : "no",
    row.status,
    isoUtc(row.status_changed_at),
    row.status_source ?? "",
    isoUtc(row.created_at),
    row.consent.text_version,
    isoUtc(row.consent.captured_at),
    row.source,
    row.confirmation.state ?? "",
    row.id,
  ];
}

/** The whole file: the mark, the header and one CRLF-terminated line per row. */
export function friendingGoCsv(rows: readonly FriendingGoPreorder[]): string {
  const lines = [[...FRIENDINGGO_CSV_COLUMNS], ...rows.map(friendingGoCsvRow)]
    .map((cells) => cells.map(friendingGoCsvCell).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** `friendinggo-preorders-YYYY-MM-DD.csv`, the UTC date of the export. */
export function friendingGoExportFilename(now: Date): string {
  return `friendinggo-preorders-${now.toISOString().slice(0, 10)}.csv`;
}
