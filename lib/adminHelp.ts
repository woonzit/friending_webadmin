/**
 * Closed route and section catalogue for the operator-facing admin help.
 *
 * The catalogue deliberately contains no prose. User-visible copy stays in the
 * two locale files, while this module makes page coverage and section coverage
 * executable: adding a screen without adding a help entry fails the focused
 * regression test instead of silently rendering a generic guide.
 *
 * Coverage is not the same as reachability, and until T-566 this module only
 * knew about the first. `ADMIN_HELP_PAGES` is a census of route FILES, so a
 * screen that exists on disk but refuses to render — `notFound()` behind a
 * dormant contract switch — kept a complete guide, and a panel behind such a
 * switch kept a complete section. The catalogue stays complete, because the
 * census is what stops a new screen shipping undocumented; what changes is that
 * an entry now declares the SAME readiness its target checks, and the dialog
 * withholds a guide, or a section, whose surface is not there.
 *
 * The readiness comes from the two sources the routes themselves use and from
 * nowhere else: the build constants in `lib/contractReadiness`, and the
 * Core-projected `admin_me` booleans the dashboard layout already computes for
 * the navigation. This module invents no third opinion about what is live.
 */

import {
  ADMIN_GRANTED_VERIFICATION_CONTRACT_READY,
  AUDIENCE_VISIBILITY_CONTRACT_READY,
  FEATURE_SWITCHES_CONTRACT_READY,
  PROFILE_TEXT_MODERATION_CONTRACT_READY,
} from "@/lib/contractReadiness";

/**
 * The per-operator console readiness Core projects through `admin_me`. The
 * dashboard layout already computes exactly these four for the sidebar; Help
 * receives the same values rather than re-deriving them, so a guide and its
 * navigation entry can never disagree about whether a screen exists.
 */
export type AdminHelpConsoleReadiness = {
  personaConsoleReady: boolean;
  verificationConsoleReady: boolean;
  audienceVisibilityConsoleReady: boolean;
  profileTextModerationConsoleReady: boolean;
};

export type AdminHelpConsoleReadyKey = keyof AdminHelpConsoleReadiness;

export type AdminHelpPage = {
  key: string;
  route: string;
  sections: readonly string[];
  /**
   * Build-constant gate of the target route, mirroring the constant that route
   * passes to its own `notFound()`. Absent means the route is ungated.
   */
  ready?: boolean;
  /**
   * Core-projected gate of the target route, naming the same `admin_me` boolean
   * that route passes to its own `notFound()`.
   */
  consoleReady?: AdminHelpConsoleReadyKey;
  /**
   * Build-constant gates of individual PANELS on an otherwise reachable page,
   * mirroring the condition the page renders that panel behind. A section whose
   * gate is false is withheld; its copy stays in both locale files so flipping
   * the constant restores the guide with the panel.
   */
  sectionReady?: Readonly<Record<string, boolean>>;
  matches: (pathname: string) => boolean;
};

function exact(path: string): (pathname: string) => boolean {
  return (pathname) => pathname === path;
}

function dynamic(parent: string): (pathname: string) => boolean {
  const escaped = parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}/[^/]+$`);
  return (pathname) => pattern.test(pathname);
}

export const ADMIN_HELP_PAGES = [
  {
    key: "overview",
    route: "/",
    sections: ["metrics", "quickActions", "recentAudit"],
    matches: exact("/"),
  },
  {
    key: "users",
    route: "/users",
    sections: ["filters", "membershipSummary", "results"],
    matches: exact("/users"),
  },
  {
    key: "userDetail",
    route: "/users/[uid]",
    sections: [
      "identity",
      "albums",
      "membership",
      "verificationGrant",
      "adminGrantedVerification",
      "moderation",
      "productPopup",
      "outboundAvailability",
      "outboundPreview",
      "outboundContent",
      "outboundConfirmation",
      "outboundResults",
      "outboundHistory",
      "outboundPrivacy",
      "pushChannels",
      "profileCopy",
      "profileAnswers",
      "accountFacts",
      "locationFacts",
      "profileFacts",
      "gallery",
      "interests",
    ],
    // `app/(dashboard)/users/[uid]/page.tsx:154` renders the panel only while
    // the T-125/T-219 switch is on; the guide follows it.
    sectionReady: { adminGrantedVerification: ADMIN_GRANTED_VERIFICATION_CONTRACT_READY },
    matches: dynamic("/users"),
  },
  {
    key: "membership",
    route: "/membership",
    sections: ["rollout", "benefits", "limits", "preview", "products", "readiness"],
    matches: exact("/membership"),
  },
  {
    key: "photoModeration",
    route: "/photo-moderation",
    sections: ["queueScopes", "reviewCards", "approve", "reject"],
    matches: exact("/photo-moderation"),
  },
  {
    key: "reportedContentQueue",
    route: "/reported-content",
    sections: ["filters", "queue", "safeProjection", "capabilities", "pagination"],
    matches: exact("/reported-content"),
  },
  {
    key: "reportedContentDetail",
    route: "/reported-content/[reportId]",
    sections: ["identities", "reportedMaterial", "decision", "conflictRetry", "resolution", "boundaries"],
    matches: dynamic("/reported-content"),
  },
  {
    key: "profileTextModeration",
    route: "/text-moderation",
    sections: [
      "readiness",
      "queue",
      "safeProjection",
      "decisions",
      "concurrency",
      "conflicts",
      "privacy",
      "noBulk",
    ],
    ready: PROFILE_TEXT_MODERATION_CONTRACT_READY,
    consoleReady: "profileTextModerationConsoleReady",
    matches: exact("/text-moderation"),
  },
  {
    key: "profileVerificationQueue",
    route: "/profile-verification",
    sections: ["statusFilter", "caseQueue", "caseMetadata", "configurationLink"],
    matches: exact("/profile-verification"),
  },
  {
    key: "profileVerificationDetail",
    route: "/profile-verification/[caseId]",
    sections: ["member", "case", "lease", "evidence", "challenge", "decisions", "history"],
    matches: dynamic("/profile-verification"),
  },
  {
    key: "verification",
    route: "/verification",
    sections: [
      "overview",
      "methodsAndLevels",
      "scopePrecedence",
      "scopeEditing",
      "featureMatrix",
      "gateMessages",
      "badges",
      "simulator",
      "teamGrant",
      "forcedWaitingRoom",
      "conflictsAndRetry",
      "privacyAndAudit",
    ],
    consoleReady: "verificationConsoleReady",
    matches: exact("/verification"),
  },
  {
    key: "persona",
    route: "/persona",
    sections: [
      "readiness",
      "memberLookup",
      "syntheticMarker",
      "forceVerify",
      "startConfig",
      "preview",
      "uncertainResponses",
    ],
    consoleReady: "personaConsoleReady",
    matches: exact("/persona"),
  },
  {
    key: "cannedTemplates",
    route: "/canned-templates",
    sections: [
      "channels",
      "listSearch",
      "editor",
      "canonicalPreview",
      "revisionReceipts",
      "deleteBoundary",
    ],
    matches: exact("/canned-templates"),
  },
  {
    key: "profileLocation",
    route: "/profile-location",
    sections: ["globalPolicy", "countryOverride", "currentOverrides"],
    matches: exact("/profile-location"),
  },
  {
    key: "datesActivities",
    route: "/dates",
    sections: ["navigation", "filters", "advancedFilters", "results"],
    matches: exact("/dates"),
  },
  {
    key: "datesConfiguration",
    route: "/dates/configuration",
    sections: ["runtimeSettings", "activityTypes", "reportReasons"],
    matches: exact("/dates/configuration"),
  },
  {
    key: "datesModeration",
    route: "/dates/moderation",
    sections: ["navigation", "filters", "caseQueue"],
    matches: exact("/dates/moderation"),
  },
  {
    key: "datesModerationDetail",
    route: "/dates/moderation/[caseId]",
    sections: [
      "overview",
      "claim",
      "reports",
      "evidence",
      "trailEvidence",
      "notesEscalation",
      "resolution",
      "legalHold",
      "history",
    ],
    matches: dynamic("/dates/moderation"),
  },
  {
    key: "datesActivityDetail",
    route: "/dates/[activityId]",
    sections: [
      "overview",
      "operationalHistory",
      "publicFields",
      "exactLocation",
      "commands",
      "hostTransfer",
      "moderationCases",
      "membershipsChats",
      "boundedHistory",
    ],
    matches: dynamic("/dates"),
  },
  {
    key: "appearance",
    route: "/appearance",
    sections: ["rules", "targeting", "window", "landing", "hero", "palette", "mapSearch", "testPreview", "saving"],
    matches: exact("/appearance"),
  },
  {
    key: "heroes",
    route: "/heroes",
    sections: ["campaignList", "mediaCopy", "targetOrder", "typography", "lifecycle"],
    matches: exact("/heroes"),
  },
  {
    key: "landing",
    route: "/landing",
    sections: [
      "fallback",
      "targeting",
      "responsiveMedia",
      "videoPosters",
      "gradient",
      "loginCard",
      "priorityLifecycle",
    ],
    matches: exact("/landing"),
  },
  {
    key: "appLanding",
    route: "/app-landing",
    sections: ["rules", "targeting", "background", "title", "description", "previewInheritance"],
    matches: exact("/app-landing"),
  },
  {
    key: "signupOptions",
    route: "/signup-options",
    sections: ["workspace", "questions", "answers", "audiences", "archiveBehavior"],
    matches: exact("/signup-options"),
  },
  {
    key: "signupPhotos",
    route: "/signup-photos",
    sections: ["photoGrid", "moderationNotice", "avatarScreen", "tipCards"],
    matches: exact("/signup-photos"),
  },
  {
    key: "audienceVisibility",
    route: "/audience-visibility",
    sections: [
      "readiness",
      "groups",
      "protectedGroups",
      "customRules",
      "retirement",
      "intents",
      "memberProjection",
      "conflicts",
    ],
    ready: AUDIENCE_VISIBILITY_CONTRACT_READY,
    consoleReady: "audienceVisibilityConsoleReady",
    matches: exact("/audience-visibility"),
  },
  {
    key: "profileFields",
    route: "/profile-fields",
    sections: ["sectionLayout", "catalogSearch", "fieldEditor", "answerOptions", "audience", "archiveBehavior"],
    matches: exact("/profile-fields"),
  },
  {
    key: "profilePresentation",
    route: "/profile-presentation",
    sections: ["draftToolbar", "highlights", "moreAbout", "unusedSources", "preview"],
    matches: exact("/profile-presentation"),
  },
  {
    key: "profileTags",
    route: "/profile-tags",
    sections: ["catalogTabs", "catalogRules", "groupsItems", "audience", "preview"],
    matches: exact("/profile-tags"),
  },
  {
    key: "icebreakers",
    route: "/icebreakers",
    sections: ["search", "promptEditor", "placementAudience", "archiveBehavior"],
    matches: exact("/icebreakers"),
  },
  {
    key: "footprints",
    route: "/footprints",
    sections: ["limits", "featureSwitchesPointer", "badges", "twoSidedAudience", "memberOverride", "reports", "archiveBehavior"],
    // `app/(dashboard)/footprints/page.tsx:282` renders the Configuration
    // pointer only while the T-126/T-218b switch is on.
    sectionReady: { featureSwitchesPointer: FEATURE_SWITCHES_CONTRACT_READY },
    matches: exact("/footprints"),
  },
  {
    key: "pinger",
    route: "/pinger",
    sections: ["runtime", "icons", "copy", "audit"],
    matches: exact("/pinger"),
  },
  {
    key: "inviteConfiguration",
    route: "/invite-configuration",
    sections: ["globalFallback", "deliveryModes", "templates", "storefrontOverrides"],
    matches: exact("/invite-configuration"),
  },
  {
    key: "support",
    route: "/support",
    sections: ["threadList", "conversation", "clientContext", "attachments", "reply"],
    matches: exact("/support"),
  },
  {
    key: "helpCms",
    route: "/help-cms",
    sections: ["articleEditor", "metadata", "languages", "contentBlocks", "categories", "articleList", "publishing"],
    matches: exact("/help-cms"),
  },
  {
    key: "configuration",
    route: "/configuration",
    sections: [
      "productControls",
      "featureSwitches",
      "session",
      "appearance",
      "pushDelivery",
      "publicLinks",
      "presence",
      "verificationFlow",
      "safetyBoundary",
    ],
    // `app/(dashboard)/configuration/page.tsx:348` renders the panel only while
    // the T-126/T-218b switch is on.
    sectionReady: { featureSwitches: FEATURE_SWITCHES_CONTRACT_READY },
    matches: exact("/configuration"),
  },
  {
    key: "appReview",
    route: "/app-review",
    sections: ["identity", "control", "counts", "checks", "reset", "interpretation"],
    matches: exact("/app-review"),
  },
  {
    key: "admins",
    route: "/admins",
    sections: ["addAdmin", "roles", "activeAccess", "ownerBoundary"],
    matches: exact("/admins"),
  },
  {
    key: "audit",
    route: "/audit",
    sections: ["navigation", "eventRows", "safeDetails"],
    matches: exact("/audit"),
  },
] as const satisfies readonly AdminHelpPage[];

export type AdminHelpPageKey = (typeof ADMIN_HELP_PAGES)[number]["key"];

/**
 * The catalogue lookup: which entry DOCUMENTS this route, regardless of whether
 * the route currently renders. This is the coverage question, and it is what
 * the route census asserts against the filesystem.
 */
export function adminHelpPageForPath(pathname: string): AdminHelpPage | null {
  return ADMIN_HELP_PAGES.find((page) => page.matches(pathname)) ?? null;
}

/** Fail-closed: an undeclared gate is open, a declared one must be satisfied. */
export function adminHelpPageReachable(
  page: AdminHelpPage,
  readiness: AdminHelpConsoleReadiness,
): boolean {
  return page.ready !== false
    && (page.consoleReady === undefined || readiness[page.consoleReady]);
}

/**
 * What the dialog may show: the entry for this route, or `null` when its target
 * refuses to render. `null` is the same state an unknown path produces, so the
 * dialog falls back to its existing "no guide for this screen" copy rather than
 * describing a screen the operator cannot be looking at.
 */
export function adminHelpGuideForPath(
  pathname: string,
  readiness: AdminHelpConsoleReadiness,
): AdminHelpPage | null {
  const page = adminHelpPageForPath(pathname);
  return page && adminHelpPageReachable(page, readiness) ? page : null;
}

/** The sections whose panel is actually on the page. */
export function adminHelpSections(page: AdminHelpPage): readonly string[] {
  const gates = page.sectionReady;
  return gates ? page.sections.filter((section) => gates[section] !== false) : page.sections;
}
