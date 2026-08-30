import { notFound } from "next/navigation";
import PersonaAdminConsole from "@/components/PersonaAdminConsole";

import { adminMe } from "@/lib/session";

export default async function PersonaAdminPage() {
  const me = await adminMe();
  if (!me?.personaConsoleReady) notFound();
  return <PersonaAdminConsole />;
}
