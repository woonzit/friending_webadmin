import { notFound } from "next/navigation";
import PersonaAdminConsole from "@/components/PersonaAdminConsole";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

export default async function PersonaAdminPage() {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me?.personaConsoleReady) notFound();
  return <PersonaAdminConsole />;
}
