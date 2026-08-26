import { notFound } from "next/navigation";
import PersonaAdminConsole from "@/components/PersonaAdminConsole";
import { PERSONA_ADMIN_PROXY_RELEASED } from "@/lib/contractReadiness";
import { adminMe } from "@/lib/session";

export default async function PersonaAdminPage() {
  if (!PERSONA_ADMIN_PROXY_RELEASED) notFound();
  const me = await adminMe();
  if (!me?.personaConsoleReady) notFound();
  return <PersonaAdminConsole />;
}
