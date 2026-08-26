import type { UserCastGroup } from "@/lib/userCastGroups";

export type MigratedMemberAudience = {
  groupIds: string[];
  legacySegments: string[];
};

/**
 * Move an old cast segment onto its canonical dynamic group when that mapping
 * is provably equivalent. Custom groups may reuse a legacy projection for
 * other purposes, and an inactive system group no longer matches members, so
 * neither is safe as an automatic replacement.
 */
export function migrateLegacyAudience(
  groupIds: string[],
  legacySegments: string[],
  groups: UserCastGroup[],
): MigratedMemberAudience {
  const migratedGroupIds = [...new Set(groupIds)];
  const retainedLegacySegments: string[] = [];
  for (const segment of legacySegments) {
    const canonical = groups.find((group) => (
      group.system
      && group.active
      && group.legacy_segment === segment
    ));
    if (!canonical) {
      if (!retainedLegacySegments.includes(segment)) retainedLegacySegments.push(segment);
      continue;
    }
    if (!migratedGroupIds.includes(canonical.id)) migratedGroupIds.push(canonical.id);
  }
  return { groupIds: migratedGroupIds, legacySegments: retainedLegacySegments };
}

/** Only canonical system groups suppress an unselected compatibility option. */
export function representedLegacySegments(groups: UserCastGroup[]): Set<string> {
  return new Set(groups
    .filter((group) => group.system && group.legacy_segment !== "")
    .map((group) => group.legacy_segment));
}
