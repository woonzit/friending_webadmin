/**
 * Layer 2 intent catalogue model.
 *
 * The semantics come from the frozen `freelove-audience-signup-spec-v2.5.md` §8. The field names
 * come from Core's `config/layer2_intent_catalog_v1.json`, which this module was checked against
 * directly: an earlier version used names of its own (`intent_catalog_revision`, `max_selected`,
 * `maps_to`, `sort_order`, `active`) and rejected the real seed outright. Core owns the wire, so
 * this follows it — one vocabulary rather than two.
 *
 * The rename that mattered: Core stores `archived`, not `active`. They are inverted, so a careless
 * mapping flips every item between selectable and hidden. `archivedFlag()` exists so the inversion
 * happens in exactly one visible, tested place.
 *
 * The rule that motivates most of the validation (§8 [v2.2], narrowed by DEC-011): every Layer 2
 * item is reciprocal, and only opting into the *same* named set unlocks that set's data. A flat
 * "reciprocal" flag would mean selecting ENM grants access to kink data, so the set id — not the
 * mode — is the disclosure boundary and is required on every item.
 *
 * DEC-011 (approved 2026-08-06) retires `public` as a Layer 2 visibility mode: a Layer 2 answer is
 * revealed only to members who selected the same thing and never appears on a profile. The field
 * stays on the wire and is always `reciprocal`, because the released-client contract requires it
 * and discards the whole catalogue when it is absent. A stored `public` item is therefore refused
 * here rather than displayed as reciprocal — showing an operator a comfortable lie about a stale
 * document is how a disclosure rule silently stops being true.
 */

/** Spec §8 Layer 1 groups. A Layer 2 item must map to at least one. */
export const LAYER1_GROUPS = ["sex", "friends", "love"] as const;
export type Layer1Group = (typeof LAYER1_GROUPS)[number];

/**
 * One mode, kept as a named type rather than dropped. DEC-011 keeps `visibility_mode` on the wire
 * and narrows its vocabulary; removing the now-invariant field is a separate, later, client-first
 * change. The literal type is what stops the editor offering a second option.
 */
export type IntentVisibilityMode = "reciprocal";

/**
 * Spec §8: optional, multi-select. How many Layer 2 answers a member may pick is an administrator
 * parameter that Core stores and serves; the console reads it and writes it back.
 *
 * The ceiling is NOT a preference. Released-client evidence validates `layer2_max` against the
 * closed `1...5` range while initializing the whole V2 catalogue. A refused value does not merely
 * cap wrong: it discards the ENTIRE catalogue and fails signup on that build. A missing
 * `layer2_max` resolves as 0 and fails the same guard.
 *
 * The floor is 1 for that structural reason, not a product one: 0 fails the guard exactly as 6
 * does. "Nobody may pick a Layer 2 answer" is expressed by archiving the items, not by a zero.
 *
 * So 1..5 is refused on write and clamped on read, the same split Core applies. Note what the clamp
 * means for the operator-facing story: Core clamps on its member wire too
 * (`SignupCatalogV2::layer2_max` resolves through `IntentsPolicy::selectionLimit()`), so a stored
 * value outside the bound is silently corrected before any client sees it. Out of range is
 * therefore storage that is wrong, written by some path other than this console — not an outage.
 */
export const LAYER2_SELECTION_LIMIT_MIN = 1;
export const LAYER2_SELECTION_LIMIT_MAX = 5;

/** The values the editor may offer, in order. A bounded selector, never a free number field. */
export const LAYER2_SELECTION_LIMIT_CHOICES: readonly number[] =
  Array.from({ length: LAYER2_SELECTION_LIMIT_MAX - LAYER2_SELECTION_LIMIT_MIN + 1 },
    (_unused, index) => LAYER2_SELECTION_LIMIT_MIN + index);

/** Clamp a stored value into the range every deployed client can honour. */
export function clampSelectionLimit(value: number): number {
  if (value < LAYER2_SELECTION_LIMIT_MIN) return LAYER2_SELECTION_LIMIT_MIN;
  if (value > LAYER2_SELECTION_LIMIT_MAX) return LAYER2_SELECTION_LIMIT_MAX;
  return value;
}

/** Whether a value may be SENT to Core. The write bound, stricter than the read bound. */
export function selectionLimitIsWritable(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= LAYER2_SELECTION_LIMIT_MIN
    && Number(value) <= LAYER2_SELECTION_LIMIT_MAX;
}

export type IntentLocalizedText = Record<string, string>;

export type Layer2Intent = {
  /** Stable and immutable after creation. Never renamed; archive and replace instead. */
  id: string;
  labels: IntentLocalizedText;
  /** §8: "Every item needs an EN and a HU glossary string." Long-press opens it. */
  glossary: IntentLocalizedText;
  layer1: Layer1Group[];
  visibility_mode: IntentVisibilityMode;
  /** Required on every item: it is the disclosure boundary, and there is no unbounded mode left. */
  reciprocal_set_id: string;
  order: number;
  archived: boolean;
};

/**
 * Why Core will not serve an item. `error` is one of `layer2-archived`,
 * `layer2-glossary-missing` or `layer2-glossary-missing-<locale>`; the locale is carried in the
 * code rather than in a field of its own, so it is derived here instead of invented.
 */
export type Layer2Blocker = { id: string; error: string; locale: string | null };

const GLOSSARY_MISSING_PREFIX = "layer2-glossary-missing-";

export type Layer2Catalog = {
  schema_version: 1;
  /**
   * Echoed by a client on write; a mismatch rejects and returns the current catalogue (§15).
   *
   * The wire calls this `intents_revision` and Core's seed file calls it `catalog_revision`. Both
   * are read, because the console consumes the wire in production and the pinned seed fixture in
   * tests. This is a documented tolerance for two sources of the same number, not a second
   * vocabulary for one.
   */
  catalog_revision: number;
  /** Ids Core will actually serve. An item may be stored without a glossary but is not servable. */
  publishable_ids: string[];
  /** Per-locale readiness blockers, so the UI can name which string holds an item back. */
  blockers: Layer2Blocker[];
  /** Core versions the glossary separately, because the copy lands after the structure. */
  glossary_revision: number;
  /**
   * How many Layer 2 answers a member may select, clamped into 1..5.
   *
   * Everything the console renders or pre-fills uses this, so no screen and no draft can ever carry
   * a number a deployed client would refuse.
   */
  selection_limit: number;
  /**
   * The same number exactly as Core stores it.
   *
   * It differs from `selection_limit` only when storage is outside the bound, and the console must
   * be able to say so. Showing only the clamped value would present a document that needs
   * correcting as a healthy one, and the operator would have no way to tell that the number they
   * are about to confirm is not the number on disk.
   */
  selection_limit_stored: number;
  items: Layer2Intent[];
  /** Declared by Core, and cross-checked against the sets the items actually reference. */
  reciprocal_sets: string[];
};

export type Layer2CatalogError =
  | "malformed"
  | "schema-version-unsupported"
  | "revision-invalid"
  | "selection-limit-invalid"
  | "item-id-invalid"
  | "item-id-duplicate"
  | "label-translation-missing"
  | "glossary-translation-missing"
  | "layer1-mapping-missing"
  | "layer1-mapping-invalid"
  | "visibility-mode-invalid"
  /** A stored `public` item: the document predates DEC-011 and Core has not been migrated yet. */
  | "visibility-mode-public"
  | "reciprocal-set-required"
  | "reciprocal-set-undeclared"
  | "order-invalid";

export type Layer2CatalogResult =
  | { ok: true; catalog: Layer2Catalog }
  | { ok: false; error: Layer2CatalogError; item_id?: string };

const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const LOCALE_PATTERN = /^[a-z]{2}(_[A-Z]{2})?$/;
const REQUIRED_LOCALES = ["en", "hu"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Locale maps keep unknown locales so a future language added by Core survives a console round
 * trip, but every key must look like a locale and every value must be a non-empty string.
 */
function textMap(value: unknown): IntentLocalizedText | null {
  const source = record(value);
  if (!source) return null;
  const result: IntentLocalizedText = {};
  for (const [locale, text] of Object.entries(source)) {
    if (!LOCALE_PATTERN.test(locale)) return null;
    if (typeof text !== "string" || text.trim() === "") return null;
    result[locale] = text;
  }
  return result;
}

function hasRequiredLocales(map: IntentLocalizedText): boolean {
  return REQUIRED_LOCALES.every((locale) => typeof map[locale] === "string" && map[locale].trim() !== "");
}

/**
 * `archived` is the stored polarity and it is the inverse of "active". Isolated here so the
 * inversion is visible at the single place it happens; mapping it the wrong way round would flip
 * every item in the catalogue, silently and without a parse error.
 */
function archivedFlag(value: unknown): boolean {
  return value === true;
}

function fail(error: Layer2CatalogError, itemId?: string): Layer2CatalogResult {
  return itemId === undefined ? { ok: false, error } : { ok: false, error, item_id: itemId };
}

function setIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === "string" && ID_PATTERN.test(entry))
    ? value as string[]
    : null;
}

/** Parse the catalogue, failing closed. An unreadable catalogue is never a partially usable one. */
export function layer2Catalog(value: unknown): Layer2CatalogResult {
  const source = record(value);
  if (!source || !Array.isArray(source.items)) return fail("malformed");
  if (source.schema_version !== 1) return fail("schema-version-unsupported");
  const revision = source.intents_revision ?? source.catalog_revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    return fail("revision-invalid");
  }
  const glossaryRevision = source.glossary_revision ?? 0;
  if (!Number.isInteger(glossaryRevision) || Number(glossaryRevision) < 0) {
    return fail("revision-invalid");
  }
  // Required, with no fallback. The console used to substitute a compiled default when the field
  // was absent, which was harmless while the number was read-only. It is not harmless now: this
  // page pre-fills an editable control from it, so an invented default is a number an operator can
  // confirm and save without ever having seen what Core actually holds. Core's `catalog()` always
  // emits the field, so absence means a payload nobody should be editing against.
  const storedLimit = source.selection_limit;
  if (!Number.isInteger(storedLimit)) {
    return fail("selection-limit-invalid");
  }
  // An integer OUTSIDE the bound — either end — is clamped rather than refused, and deliberately
  // so. Refusing would blank the page, including the one control that can repair it, at exactly the
  // moment the app is already failing signup. The page reports the stored value beside the clamp
  // instead. This matches Core's own read path (`IntentsPolicy::selectionLimit()`, which clamps
  // both ends for the same reason), so the console and the member wire never disagree about what a
  // deployed client is being served.
  const selectionLimit = clampSelectionLimit(Number(storedLimit));
  const declaredSets = setIdList(source.reciprocal_sets ?? []);
  if (!declaredSets) return fail("malformed");
  const publishableIds = setIdList(source.publishable_ids ?? []);
  if (!publishableIds) return fail("malformed");
  // Core sends a map from item id to a single blocker code, not a list of objects. An earlier
  // version of this parser expected the list, which is why the page failed to load against the real
  // endpoint: the shape was inferred from prose rather than read from the response builder.
  const blockers: Layer2Blocker[] = [];
  if (source.blockers !== undefined && source.blockers !== null) {
    // PHP serialises an empty associative array as `[]`, not `{}`, so "no blockers" arrives as an
    // empty JSON array. A non-empty array is still malformed — Core never sends a list here.
    const map = Array.isArray(source.blockers)
      ? (source.blockers.length === 0 ? {} : null)
      : record(source.blockers);
    if (!map) return fail("malformed");
    for (const [id, code] of Object.entries(map)) {
      if (!ID_PATTERN.test(id) || typeof code !== "string" || code === "") return fail("malformed");
      blockers.push({
        id,
        error: code,
        locale: code.startsWith(GLOSSARY_MISSING_PREFIX)
          ? code.slice(GLOSSARY_MISSING_PREFIX.length)
          : null,
      });
    }
  }

  const items: Layer2Intent[] = [];
  const seen = new Set<string>();
  for (const raw of source.items) {
    const item = record(raw);
    if (!item) return fail("malformed");

    const id = typeof item.id === "string" ? item.id : "";
    if (!ID_PATTERN.test(id)) return fail("item-id-invalid", id || undefined);
    if (seen.has(id)) return fail("item-id-duplicate", id);
    seen.add(id);

    const labels = textMap(item.labels);
    if (!labels || !hasRequiredLocales(labels)) return fail("label-translation-missing", id);
    const glossary = textMap(item.glossary);
    if (!glossary || !hasRequiredLocales(glossary)) return fail("glossary-translation-missing", id);

    if (!Array.isArray(item.layer1)) return fail("layer1-mapping-invalid", id);
    const layer1 = item.layer1 as unknown[];
    if (layer1.length === 0) return fail("layer1-mapping-missing", id);
    if (
      !layer1.every((group) => typeof group === "string" && (LAYER1_GROUPS as readonly string[]).includes(group))
      || new Set(layer1 as string[]).size !== layer1.length
    ) return fail("layer1-mapping-invalid", id);

    const mode = String(item.visibility_mode ?? "");
    // DEC-011: `public` is refused, and refused under its own name. Folding it into
    // `visibility-mode-invalid` would send an operator to fix an item, when the actual state is
    // that the whole document predates the decision and Core must be migrated first. Refusing it
    // at all is the point: rendering it as "reciprocal" would tell an operator that an answer is
    // protected while Core is still publishing it to every profile visitor.
    if (mode === "public") return fail("visibility-mode-public", id);
    if (mode !== "reciprocal") return fail("visibility-mode-invalid", id);
    // Required on every item now, because there is no mode left that does without one. An item
    // with no named set can never be reciprocated with, so nobody could ever qualify to see it.
    const setId = typeof item.reciprocal_set_id === "string" ? item.reciprocal_set_id : "";
    if (!ID_PATTERN.test(setId)) return fail("reciprocal-set-required", id);
    // A set the catalogue never declared is a typo, and a typo here silently creates a private
    // island nobody else can ever opt into.
    if (declaredSets.length > 0 && !declaredSets.includes(setId)) {
      return fail("reciprocal-set-undeclared", id);
    }

    if (!Number.isInteger(item.order) || Number(item.order) < 0) {
      return fail("order-invalid", id);
    }

    items.push({
      id,
      labels,
      glossary,
      layer1: layer1 as Layer1Group[],
      visibility_mode: mode,
      reciprocal_set_id: setId,
      order: Number(item.order),
      archived: archivedFlag(item.archived),
    });
  }

  const usedSets = [...new Set(items.map((item) => item.reciprocal_set_id))].sort();

  return {
    ok: true,
    catalog: {
      schema_version: 1,
      catalog_revision: Number(revision),
      publishable_ids: publishableIds,
      blockers,
      glossary_revision: Number(glossaryRevision),
      selection_limit: selectionLimit,
      selection_limit_stored: Number(storedLimit),
      items,
      reciprocal_sets: declaredSets.length > 0 ? [...declaredSets].sort() : usedSets,
    },
  };
}

/**
 * Whether a write may proceed against the revision the catalogue was read at.
 *
 * §15 [v2.4]: a stale client will otherwise resurrect an archived or re-categorised entry. One rule
 * for Layer 2, the desires board, the tag catalogues and the reciprocal set ids — not four fixes.
 */
export function intentsRevisionIsCurrent(expected: number, current: number): boolean {
  return Number.isInteger(expected) && Number.isInteger(current) && expected === current;
}

/**
 * Declared reciprocal sets that no live item uses.
 *
 * This began as a "a set with only one item is probably a typo" heuristic, which was wrong: run
 * against Core's seeded catalogue it flagged both `enm` and `kink`, because spec §8 gives each set
 * exactly one item. A warning that fires on the canonical catalogue teaches operators to ignore
 * warnings.
 *
 * The genuine hazard is the opposite shape — a set that exists in the registry with nothing live in
 * it. Members can opt into it and will never see anything, and nothing in the UI explains why. That
 * happens when the last item in a set is archived, which is an ordinary edit with a non-obvious
 * consequence. Surfaced for the WA-03 registry, never corrected automatically.
 */
export function emptyReciprocalSets(catalog: Layer2Catalog): string[] {
  const live = new Set(
    catalog.items.filter((item) => !item.archived).map((item) => item.reciprocal_set_id),
  );
  return catalog.reciprocal_sets.filter((setId) => !live.has(setId)).sort();
}

/**
 * Whether storage holds a selection limit outside the bound clients accept.
 *
 * Deliberately NOT described as an outage. Core clamps the same value on its member wire, so
 * members are being served the clamped number and signup works; what is wrong is the document. It
 * is still worth an operator's attention, because Core refuses an out-of-bound write, so reaching
 * this state means something other than this console wrote the field — and the next honest write
 * from here corrects it.
 */
export function selectionLimitOutOfRange(catalog: Layer2Catalog): boolean {
  return catalog.selection_limit_stored !== catalog.selection_limit;
}

/** Items a member may select, in render order. Archived items stay parseable but unselectable. */
export function selectableIntents(catalog: Layer2Catalog): Layer2Intent[] {
  return catalog.items
    .filter((item) => !item.archived)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
