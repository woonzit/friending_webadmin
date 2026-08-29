import { notFound } from "next/navigation";
import AppearanceConsole from "@/components/AppearanceConsole";
import { APPEARANCE_RULES_CONTRACT_READY } from "@/lib/contractReadiness";

export const dynamic = "force-dynamic";

/** D-052 Appearance & placements: unreachable until the Core provider is released. */
export default function AppearancePage() {
  if (!APPEARANCE_RULES_CONTRACT_READY) notFound();
  return <AppearanceConsole />;
}
