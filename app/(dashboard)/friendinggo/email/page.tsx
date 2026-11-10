import { notFound } from "next/navigation";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import FriendingGoEmailConsole from "@/components/FriendingGoEmailConsole";
import { isFriendingGoObjectId } from "@/lib/friendinggo";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

/**
 * D-153: the FriendingGO email composer. Whether the operator may test, save or send comes from Core's
 * own answer (`can_write`), read by the console, never from the role alone; `?draft=<id>` opens a draft.
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
  return <FriendingGoEmailConsole initialDraftId={isFriendingGoObjectId(draft) ? draft : null} operator={me.email} />;
}
