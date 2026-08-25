import { notFound } from "next/navigation";
import PersonaAdminConsole from "@/components/PersonaAdminConsole";
import { PERSONA_ADMIN_PROXY_RELEASED } from "@/lib/contractReadiness";

export default function PersonaAdminPage() {
  if (!PERSONA_ADMIN_PROXY_RELEASED) notFound();
  return <PersonaAdminConsole />;
}
