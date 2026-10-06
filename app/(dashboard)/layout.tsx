import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me) redirect("/login");
  return (
    <Shell
      adminEmail={me.email}
      personaConsoleReady={me.personaConsoleReady}
      verificationConsoleReady={me.verificationConsoleReady}
      audienceVisibilityConsoleReady={me.audienceVisibilityConsoleReady}
      profileTextModerationConsoleReady={me.profileTextModerationConsoleReady}
    >
      {children}
    </Shell>
  );
}
