/**
 * The `catalog` admin principal.
 *
 * Core publishes it on `admin_me` beside `dates`, in the same `{role, rank, capabilities}` shape, so
 * this mirrors `lib/datesAdmin.ts` rather than inventing a second mechanism.
 *
 * WA-00.4: hidden buttons are not authorization. The console renders controls from the capability
 * list the server sent, and every action is refused independently by Core — the console is not the
 * enforcement point. Capability membership is checked by **name in a published list**, never by
 * comparing ranks at a call site: a rank comparison is a second copy of the table, and Core's
 * call-site census records what thirteen copies of one predicate cost.
 */

export const CATALOG_ROLES = ["viewer", "editor", "approver", "owner"] as const;
export type CatalogRole = (typeof CATALOG_ROLES)[number];

/** The eight capability strings Core committed to and pins by name in its own test. */
export const CATALOG_CAPABILITIES = [
  "catalog_inventory_read",
  "catalog_rule_edit",
  "catalog_dryrun_read",
  "catalog_promotion_propose",
  "catalog_promotion_approve",
  "catalog_member_support_read",
  "catalog_member_support_write",
  "catalog_layer2_edit",
] as const;
export type CatalogCapability = (typeof CATALOG_CAPABILITIES)[number];

export type CatalogPrincipal = {
  role: CatalogRole;
  rank: number;
  capabilities: string[];
};

const ROLES: ReadonlySet<string> = new Set(CATALOG_ROLES);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Read the `catalog` block out of an `admin_me` payload, failing closed. An unrecognised role, a
 * missing block or a malformed capability list all resolve to `null`, which holds nothing — so a
 * response the console cannot understand grants nothing rather than inheriting a default.
 */
export function normalizeCatalogPrincipal(value: unknown): CatalogPrincipal | null {
  // Only the `catalog` block, never the surrounding body. The fallback that used to accept the
  // whole payload was a trap waiting to matter: `owner` is a value in BOTH the global webadmin
  // ladder and this one, so an `admin_me` response with no catalog block would have been read as a
  // catalogue owner holding zero capabilities. Harmless today because capabilities drive every
  // decision, and exactly the kind of coincidence that stops being harmless later.
  const row = record(record(value)?.catalog);
  const role = String(row?.role ?? "");
  if (!row || !ROLES.has(role)) return null;
  return {
    role: role as CatalogRole,
    rank: Number(row.rank) || 0,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function hasCatalogCapability(
  principal: CatalogPrincipal | null,
  capability: CatalogCapability,
): boolean {
  return principal?.capabilities.includes(capability) ?? false;
}
