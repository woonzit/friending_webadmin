import { notFound } from "next/navigation";
import AudienceVisibilityAdminConsole from "@/components/AudienceVisibilityAdminConsole";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";
import { audienceVisibilityTab } from "@/lib/audienceVisibilityAdmin";

export default async function AudienceVisibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me?.audienceVisibilityConsoleReady) notFound();
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  return <AudienceVisibilityAdminConsole initialTab={audienceVisibilityTab(requestedTab)} />;
}
