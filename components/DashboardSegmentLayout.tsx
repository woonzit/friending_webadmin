import "server-only";
import { NextIntlClientProvider } from "next-intl";
import { AdminHelpMount } from "@/components/AdminHelp";
import { clientMessages } from "@/lib/clientMessages";
import type { ClientMessageScopeName } from "@/lib/clientMessageScopes";

/**
 * The layout of a dashboard segment: its client components get the messages of
 * `scope` and nothing else, and its help mount shows the guides that scope ships
 * (`lib/clientMessageScopes.ts`). Use it as `export default dashboardSegmentLayout("<scope>")`.
 */
export function dashboardSegmentLayout(scope: ClientMessageScopeName) {
  return async function DashboardSegmentLayout({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider messages={await clientMessages(scope)}>
        {children}
        <AdminHelpMount />
      </NextIntlClientProvider>
    );
  };
}
