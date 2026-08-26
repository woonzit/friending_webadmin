import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { adminMe } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await adminMe();
  if (!me) redirect("/login");
  return (
    <Shell
      adminEmail={me.email}
      personaConsoleReady={me.personaConsoleReady}
      verificationConsoleReady={me.verificationConsoleReady}
      audienceVisibilityConsoleReady={me.audienceVisibilityConsoleReady}
    >
      {children}
    </Shell>
  );
}
