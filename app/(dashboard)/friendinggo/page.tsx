import { notFound } from "next/navigation";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import FriendingGoPreordersConsole from "@/components/FriendingGoPreordersConsole";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

/** D-153: FriendingGO preorder sign-ups. Only while Core serves `admin_me.friendinggo`. */
export default async function FriendingGoPreordersPage() {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me?.friendingGoConsoleReady) notFound();
  return <FriendingGoPreordersConsole />;
}
