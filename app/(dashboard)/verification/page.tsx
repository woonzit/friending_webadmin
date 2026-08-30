import { notFound } from "next/navigation";
import VerificationAdminConsole from "@/components/VerificationAdminConsole";
import { adminMe } from "@/lib/session";
import { verificationTabKey } from "@/lib/verificationAdmin";

export default async function VerificationAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const me = await adminMe();
  if (!me?.verificationConsoleReady) notFound();
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = verificationTabKey(requestedTab);
  return (
    <VerificationAdminConsole
      initialTab={tab === "forced" && !me.forcedVerification.visible ? "scopes" : tab}
      forced={me.forcedVerification}
    />
  );
}
