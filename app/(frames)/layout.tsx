import { NextIntlClientProvider } from "next-intl";
import { clientMessages } from "@/lib/clientMessages";

/** Framed documents (the Appearance map) ship their own copy only (lib/clientMessageScopes.ts). */
export default async function FramesLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages("frames")}>{children}</NextIntlClientProvider>;
}
