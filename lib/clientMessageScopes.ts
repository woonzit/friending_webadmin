import type { AbstractIntlMessages } from "next-intl";

/**
 * What each client message provider ships to the browser.
 *
 * `NextIntlClientProvider` serialises its `messages` into every document it renders,
 * so a provider handing over the whole catalogue (about 754 KB raw, 235 KB gzip) put
 * every console's copy into every page, the sign-in page and each redirect included.
 * Server components keep reading the full catalogue through `getTranslations`; only
 * what the CLIENT components under a provider read crosses to the browser.
 *
 * Each layout that declares a provider names one scope below:
 * - `root`: `app/layout.tsx`; what renders with no deeper provider (the neutral
 *   membership page of the dashboard layout, and Next's own not-found and error pages);
 * - `login`, `frames`: the sign-in page and the Appearance map frame;
 * - `dashboard`: the shell, the overview page and the `/heroes`, `/app-landing` redirects;
 * - one scope per dashboard segment, named by its directory under `app/(dashboard)`
 *   (`dashboardSegmentLayout`). The AreYouIn (`dates/…`) and member detail
 *   (`users/[uid]`) screens have their own nested scopes because they share little
 *   with their siblings and each is large.
 *
 * Nested providers REPLACE their parent's messages, they do not merge them, so a scope
 * lists everything the client components it serves read, shared namespaces such as
 * `common` included. An entry is a namespace or a dotted subtree. `help` names the
 * operator guides (`adminHelp.pages.<key>`) the scope's help mount shows; a scope with
 * guides also ships the dialog chrome. Exactly one mount on a screen ships its guide.
 *
 * `tests/clientMessageScopes.test.mts` derives from source what every route's client
 * components read (`scripts/clientMessageCensus.mts`, which also prints these lists)
 * and fails when a scope misses a path, lists one nothing reads, or names a path the
 * catalogue does not have.
 */
type ClientMessageScope = { readonly messages: readonly string[]; readonly help?: readonly string[] };

/** The help dialog's own copy: every `adminHelp` key outside `pages`. */
export const ADMIN_HELP_CHROME = [
  "adminHelp.actionsTitle",
  "adminHelp.boundaryTitle",
  "adminHelp.button",
  "adminHelp.closeLabel",
  "adminHelp.eyebrow",
  "adminHelp.guidanceTitle",
  "adminHelp.openLabel",
  "adminHelp.overviewEyebrow",
  "adminHelp.overviewTitle",
  "adminHelp.roleBoundary",
  "adminHelp.sectionNavigationLabel",
  "adminHelp.sectionsCopy",
  "adminHelp.sectionsEyebrow",
  "adminHelp.sectionsTitle",
  "adminHelp.sourceBoundary",
  "adminHelp.startTitle",
  "adminHelp.unavailableCopy",
  "adminHelp.unavailableTitle",
] as const;

export const CLIENT_MESSAGE_SCOPES = {
  // Whatever renders with no deeper provider: the dashboard layout's neutral membership page.
  root: { messages: ["adminMembership", "adminWriteOutcome", "common"] },
  login: { messages: ["adminMembership", "adminWriteOutcome", "common", "login"] },
  frames: { messages: ["adminMembership", "adminWriteOutcome", "appearance.map", "common"] },
  // The shell (navigation, notices, the research-leave dialog), the overview and the redirects.
  dashboard: {
    messages: [
      "adminMembership", "adminWriteOutcome", "common", "datesAdmin.research.navigation", "nav", "overview",
      "registrationStats",
    ],
    help: ["overview"],
  },
  admins: { messages: ["admins", "common"], help: ["admins"] },
  "app-review": { messages: ["appReview", "common"], help: ["appReview"] },
  appearance: { messages: ["appearance", "common", "imageUpload", "videoUpload"], help: ["appearance"] },
  "audience-visibility": {
    messages: [
      "adminMembership", "adminWriteOutcome", "audienceVisibilityAdmin", "common",
    ],
    help: ["audienceVisibility"],
  },
  audit: { messages: ["audit", "common"], help: ["audit"] },
  "canned-templates": { messages: ["cannedTemplates", "common"], help: ["cannedTemplates"] },
  configuration: {
    messages: [
      "adminMembership", "common", "configuration", "featureSwitches", "imageUpload", "profilePresence.configuration",
      "profileVerification.configuration", "verificationAdmin.live.methodReasons",
    ],
    help: ["configuration"],
  },
  dates: {
    messages: [
      "common", "datesAdmin.activities", "datesAdmin.external.aiBadge", "datesAdmin.external.badge",
      "datesAdmin.external.editor", "datesAdmin.external.origin", "datesAdmin.external.tierValues",
      "datesAdmin.external.unknownFact", "datesAdmin.tabs",
    ],
    help: ["datesActivities"],
  },
  "dates/[activityId]": {
    messages: [
      "adminMembership", "common", "datesAdmin.activities.values", "datesAdmin.activityDetail",
      "datesAdmin.commandOutcome", "datesAdmin.eventContent", "datesAdmin.external.aiBadge",
      "datesAdmin.external.badge", "datesAdmin.external.channelValues", "datesAdmin.external.columns",
      "datesAdmin.external.editor", "datesAdmin.external.form", "datesAdmin.external.provenance",
      "datesAdmin.external.tierValues", "datesAdmin.external.unknownFact", "datesAdmin.intake.channelValues",
      "datesAdmin.tabs",
    ],
    help: ["datesActivityDetail"],
  },
  "dates/ai-usage": {
    messages: [
      "common", "datesAdmin.intake.access", "datesAdmin.intake.channelValues", "datesAdmin.intake.detail",
      "datesAdmin.intake.eyebrow", "datesAdmin.intake.providerValues", "datesAdmin.intake.queue",
      "datesAdmin.intake.refusals", "datesAdmin.intake.taskValues", "datesAdmin.intake.usage", "datesAdmin.tabs",
    ],
    help: ["datesAiUsage"],
  },
  "dates/configuration": {
    messages: [
      "common", "datesAdmin.commandOutcome", "datesAdmin.configuration", "datesAdmin.eventIcons",
      "datesAdmin.external.form.categories", "datesAdmin.externalPins", "datesAdmin.intake.providerValues",
      "datesAdmin.suggestionLeaderboard", "datesAdmin.tabs",
    ],
    help: ["datesConfiguration"],
  },
  "dates/corrections": {
    messages: [
      "common", "datesAdmin.corrections", "datesAdmin.external.review.refusals", "datesAdmin.external.statusValues",
      "datesAdmin.tabs",
    ],
    help: ["datesCorrections"],
  },
  "dates/external": {
    messages: [
      "common", "datesAdmin.corrections", "datesAdmin.external", "datesAdmin.intake.channelValues",
      "datesAdmin.intake.inputKindValues", "datesAdmin.intake.refusals", "datesAdmin.intake.source",
      "datesAdmin.tabs",
    ],
    help: ["datesExternalDetail", "datesExternalList", "datesExternalNew"],
  },
  "dates/intakes": {
    messages: [
      "common", "datesAdmin.external.editor", "datesAdmin.external.form", "datesAdmin.external.pending",
      "datesAdmin.external.places", "datesAdmin.intake", "datesAdmin.research", "datesAdmin.tabs",
    ],
    help: ["datesIntakeDetail", "datesIntakeQueue"],
  },
  "dates/moderation": {
    messages: [
      "adminMembership", "common", "datesAdmin.activities.values", "datesAdmin.activityDetail.featuredPhoto",
      "datesAdmin.activityDetail.galleryPhoto", "datesAdmin.caseDetail", "datesAdmin.commandOutcome",
      "datesAdmin.external", "datesAdmin.intake.channelValues", "datesAdmin.moderation", "datesAdmin.tabs",
    ],
    help: ["datesModeration", "datesModerationDetail"],
  },
  "dates/research": {
    messages: [
      "appearance.map", "common", "datesAdmin.intake.hardFails", "datesAdmin.intake.outcomeValues",
      "datesAdmin.intake.resultValues", "datesAdmin.research", "datesAdmin.tabs",
    ],
    help: ["datesResearch", "datesResearchFollowups"],
  },
  footprints: { messages: ["adminMembership", "common", "footprints", "imageUpload"], help: ["footprints"] },
  friendinggo: {
    messages: [
      "adminMembership", "adminWriteOutcome", "common", "friendinggo",
    ],
    help: ["friendingGoEmail", "friendingGoPreorders", "friendingGoSent"],
  },
  "help-cms": { messages: ["common", "helpCms"], help: ["helpCms"] },
  icebreakers: { messages: ["common", "icebreakers"], help: ["icebreakers"] },
  "into-tag-moderation": { messages: ["common", "intoTagModeration"], help: ["intoTagModeration"] },
  "invite-configuration": { messages: ["common", "inviteConfiguration"], help: ["inviteConfiguration"] },
  landing: { messages: ["common", "imageUpload", "landing", "videoUpload"], help: ["landing"] },
  "mail-delivery": { messages: ["common", "mailDelivery"], help: ["mailDelivery"] },
  membership: { messages: ["common", "membershipConfig", "membershipErrors"], help: ["membership"] },
  persona: { messages: ["adminMembership", "adminWriteOutcome", "common", "personaAdmin"], help: ["persona"] },
  "photo-moderation": {
    messages: [
      "adminMembership", "common", "imageEditor", "photoModeration",
    ],
    help: ["photoModeration"],
  },
  pinger: {
    messages: [
      "common", "pinger.audit", "pinger.copy", "pinger.errors", "pinger.eyebrow", "pinger.icon", "pinger.overview",
      "pinger.runtime", "pinger.saved", "pinger.sectionHelp", "pinger.subtitle", "pinger.title",
    ],
    help: ["pinger"],
  },
  "profile-fields": { messages: ["common", "profileFields"], help: ["profileFields"] },
  "profile-location": { messages: ["common", "profileLocation"], help: ["profileLocation"] },
  "profile-presentation": { messages: ["common", "profilePresentation"], help: ["profilePresentation"] },
  "profile-tags": { messages: ["common", "profileTags"], help: ["profileTags"] },
  "profile-verification": {
    messages: [
      "common", "profileVerification.detail", "profileVerification.queue",
    ],
    help: ["profileVerificationDetail", "profileVerificationQueue"],
  },
  "reported-content": {
    messages: [
      "common", "reportedContent.detail", "reportedContent.queue",
    ],
    help: ["reportedContentDetail", "reportedContentQueue"],
  },
  "signup-options": { messages: ["common", "signupOptions"], help: ["signupOptions"] },
  "signup-photos": { messages: ["common", "imageUpload", "signupPhotos"], help: ["signupPhotos"] },
  support: { messages: ["common", "support"], help: ["support"] },
  "text-moderation": {
    messages: [
      "adminMembership", "adminWriteOutcome", "common", "profileTextModeration",
    ],
    help: ["profileTextModeration"],
  },
  users: { messages: ["common", "membershipUser.states", "registrationStats.platforms", "users"], help: ["users"] },
  "users/[uid]": {
    messages: [
      "adminMembership", "common", "imageEditor", "membershipErrors", "membershipUser", "moderation",
      "outboundMessaging", "productPopup", "userDetail", "userInsight", "userProfileEditor",
    ],
    help: ["userDetail"],
  },
  verification: {
    messages: [
      "adminMembership", "adminWriteOutcome", "common", "verificationAdmin",
    ],
    help: ["verification"],
  },
} as const satisfies Record<string, ClientMessageScope>;

export type ClientMessageScopeName = keyof typeof CLIENT_MESSAGE_SCOPES;

/** Every message path the scope ships. */
export function clientMessagePaths(scope: ClientMessageScopeName): string[] {
  const { messages, help = [] }: ClientMessageScope = CLIENT_MESSAGE_SCOPES[scope];
  if (help.length === 0) return [...messages];
  return [...messages, ...ADMIN_HELP_CHROME, ...help.map((key) => `adminHelp.pages.${key}`)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The part of `messages` the paths name, as a fresh tree. Shared subtrees are passed
 * by reference and never modified. A path the catalogue lacks is skipped: the census
 * test proves each listed path exists in both locales.
 */
export function pickClientMessages(messages: AbstractIntlMessages, paths: readonly string[]): AbstractIntlMessages {
  const picked: Record<string, unknown> = {};
  // Ancestors first, so a path below one already taken is skipped rather than
  // written into a subtree shared with the catalogue.
  const ordered = [...new Set(paths)].sort((left, right) => left.split(".").length - right.split(".").length);
  const taken: string[] = [];
  for (const path of ordered) {
    if (taken.some((entry) => path === entry || path.startsWith(`${entry}.`))) continue;
    const keys = path.split(".");
    let source: unknown = messages;
    for (const key of keys) source = isRecord(source) && Object.hasOwn(source, key) ? source[key] : undefined;
    if (source === undefined) continue;
    let target = picked;
    for (const key of keys.slice(0, -1)) {
      const next = Object.hasOwn(target, key) ? target[key] : undefined;
      if (isRecord(next)) target = next;
      else target = target[key] = {};
    }
    target[keys[keys.length - 1]] = source;
    taken.push(path);
  }
  return picked as AbstractIntlMessages;
}
