import { notFound } from "next/navigation";
import ProfileTextModerationConsole from "@/components/ProfileTextModerationConsole";
import { PROFILE_TEXT_MODERATION_CONTRACT_READY } from "@/lib/contractReadiness";
import { profileTextModerationFilterField } from "@/lib/profileTextModeration";
import { adminMe } from "@/lib/session";

export default async function ProfileTextModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string | string[]; uid?: string | string[] }>;
}) {
  if (!PROFILE_TEXT_MODERATION_CONTRACT_READY) notFound();
  const me = await adminMe();
  if (!me?.profileTextModerationConsoleReady) notFound();
  const query = await searchParams;
  const requestedField = Array.isArray(query.field) ? query.field[0] : query.field;
  const requestedUid = Array.isArray(query.uid) ? query.uid[0] : query.uid;
  const uid = typeof requestedUid === "string" && /^[1-9][0-9]{0,9}$/u.test(requestedUid)
    && Number(requestedUid) <= 2_147_483_647
    ? Number(requestedUid)
    : null;
  return (
    <ProfileTextModerationConsole
      initialField={profileTextModerationFilterField(requestedField)}
      initialUid={uid}
    />
  );
}
