#!/usr/bin/env bash
# The release's dependency audit: `npm audit --omit=dev`, with one narrow,
# owner-approved escape hatch for an advisory that has no fixed release yet.
#
# FRIENDING_WEBADMIN_AUDIT_ALLOW is a comma-separated list of GHSA ids the
# owner explicitly accepted for this release. When it is empty the gate is
# exactly `npm audit --omit=dev`. When it is set, the release continues only
# if every advisory npm reports is on that list; any other advisory, or an
# unreadable report, still stops the release. Never set it in a profile.
set -euo pipefail

allow="${FRIENDING_WEBADMIN_AUDIT_ALLOW:-}"
if [[ -z "$allow" ]]; then
  exec npm audit --omit=dev
fi

report="$(npm audit --omit=dev --json || true)"
AUDIT_ALLOW="$allow" node -e '
  const allow = new Set(process.env.AUDIT_ALLOW.split(",").map((id) => id.trim()).filter(Boolean));
  for (const id of allow) {
    if (!/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(id)) { console.error("audit gate: not a GHSA id: " + id); process.exit(1); }
  }
  let report;
  try { report = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error("audit gate: unreadable npm audit report"); process.exit(1); }
  const vulnerabilities = report && typeof report === "object" ? report.vulnerabilities : null;
  if (!vulnerabilities || typeof vulnerabilities !== "object") { console.error("audit gate: unreadable npm audit report"); process.exit(1); }
  const found = new Set();
  for (const entry of Object.values(vulnerabilities)) {
    for (const via of entry.via ?? []) {
      if (typeof via === "string") continue;
      const id = String(via?.url ?? "").split("/").pop();
      if (!/^GHSA-/.test(id)) { console.error("audit gate: advisory without a GHSA id: " + JSON.stringify(via?.title ?? via)); process.exit(1); }
      found.add(id);
    }
  }
  const refused = [...found].filter((id) => !allow.has(id));
  if (refused.length > 0) { console.error("audit gate: advisories not accepted for this release: " + refused.join(", ")); process.exit(1); }
  console.log(found.size === 0 ? "audit gate: no advisories"
    : "audit gate: continuing with owner-accepted advisories " + [...found].join(", "));
' <<<"$report"
