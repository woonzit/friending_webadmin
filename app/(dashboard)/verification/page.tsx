import { notFound } from "next/navigation";
import VerificationAdminConsole from "@/components/VerificationAdminConsole";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";
import { verificationTabKey } from "@/lib/verificationAdmin";

export default async function VerificationAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me?.verificationConsoleReady) notFound();
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = verificationTabKey(requestedTab);
  return <VerificationAdminConsole initialTab={tab} methodAccess={me.verificationMethod} />;
}
