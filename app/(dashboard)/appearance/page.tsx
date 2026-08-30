import { notFound } from "next/navigation";
import AppearanceConsole from "@/components/AppearanceConsole";

export const dynamic = "force-dynamic";

/** D-052 Appearance & placements: unreachable until the Core provider is released. */
export default function AppearancePage() {
  return <AppearanceConsole />;
}
