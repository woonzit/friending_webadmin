/**
 * Closed route and section catalogue for the operator-facing admin help.
 *
 * The catalogue deliberately contains no prose. User-visible copy stays in the
 * two locale files, while this module makes page coverage and section coverage
 * executable: adding a screen without adding a help entry fails the focused
 * regression test instead of silently rendering a generic guide.
 */

export type AdminHelpPage = {
  key: string;
  route: string;
  sections: readonly string[];
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
    matches: exact("/audience-visibility"),
  },
  {
    key: "userGroups",
    route: "/user-groups",
    sections: ["groupList", "membershipRules", "legacyProjection", "archiveBehavior"],
    matches: exact("/user-groups"),
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
    key: "layer2Intents",
    route: "/layer2-intents",
    sections: ["readiness", "selectionLimit", "catalog", "reciprocalSets", "archiveRestore", "conflicts"],
    matches: exact("/layer2-intents"),
  },
  {
    key: "footprints",
    route: "/footprints",
    sections: ["limits", "featureSwitchesPointer", "badges", "twoSidedAudience", "memberOverride", "reports", "archiveBehavior"],
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

export function adminHelpPageForPath(pathname: string): AdminHelpPage | null {
  return ADMIN_HELP_PAGES.find((page) => page.matches(pathname)) ?? null;
}
