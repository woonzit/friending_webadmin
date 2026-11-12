import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import Shell from "@/components/Shell";
import AdminMembershipUnavailable from "@/components/AdminMembershipUnavailable";
import { clientMessages } from "@/lib/clientMessages";
import { adminMe, AdminMembershipUnconfirmedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me) redirect("/login");
  // The neutral page above is served by the root scope; the shell, the overview and
  // the two redirects by this one; every segment by its own (lib/clientMessageScopes.ts).
  return (
    <NextIntlClientProvider messages={await clientMessages("dashboard")}>
      <Shell
        adminEmail={me.email}
        personaConsoleReady={me.personaConsoleReady}
        verificationConsoleReady={me.verificationConsoleReady}
        audienceVisibilityConsoleReady={me.audienceVisibilityConsoleReady}
        profileTextModerationConsoleReady={me.profileTextModerationConsoleReady}
        friendingGoConsoleReady={me.friendingGoConsoleReady}
      >
        {children}
      </Shell>
    </NextIntlClientProvider>
  );
}
