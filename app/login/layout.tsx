import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/lib/clientMessages";

/** The sign-in page ships its own copy only (lib/clientMessageScopes.ts). */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages("login")}>{children}</NextIntlClientProvider>;
}
