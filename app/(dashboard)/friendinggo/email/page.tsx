import { notFound } from "next/navigation";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import FriendingGoEmailConsole from "@/components/FriendingGoEmailConsole";
import { isAdminWriteRole } from "@/lib/authPolicy";
import { isFriendingGoObjectId } from "@/lib/friendinggo";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

/**
 * D-153: the FriendingGO email composer. Whether the operator may test, save or send comes from Core's
 * `admin_me` role (Core rechecks it on every write); `?draft=<id>` opens a draft from the Sent tab.
 */
export default async function FriendingGoEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me?.friendingGoConsoleReady) notFound();
  const query = await searchParams;
  const draft = Array.isArray(query.draft) ? query.draft[0] : query.draft;
  return <FriendingGoEmailConsole canWrite={isAdminWriteRole(me.role)} initialDraftId={isFriendingGoObjectId(draft) ? draft : null} />;
}
