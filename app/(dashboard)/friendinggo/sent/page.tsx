import { notFound } from "next/navigation";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import FriendingGoSentConsole from "@/components/FriendingGoSentConsole";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

/** D-153: the FriendingGO campaigns sent (and drafts), with their recipients. */
export default async function FriendingGoSentPage() {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me?.friendingGoConsoleReady) notFound();
  return <FriendingGoSentConsole />;
}
