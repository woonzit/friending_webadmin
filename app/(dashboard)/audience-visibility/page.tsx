import { notFound } from "next/navigation";
import AudienceVisibilityAdminConsole from "@/components/AudienceVisibilityAdminConsole";
import { adminMe } from "@/lib/session";
import { audienceVisibilityTab } from "@/lib/audienceVisibilityAdmin";

export default async function AudienceVisibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const me = await adminMe();
  if (!me?.audienceVisibilityConsoleReady) notFound();
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  return <AudienceVisibilityAdminConsole initialTab={audienceVisibilityTab(requestedTab)} />;
}
