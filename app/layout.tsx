import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { clientMessages } from "@/lib/clientMessages";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Friending Admin",
    template: "%s · Friending Admin",
  },
  description: "Secure Friending operations console",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Each layout below ships only its own client messages (lib/clientMessageScopes.ts).
  return (
    <html lang={locale} data-theme="dark">
      <body>
        <NextIntlClientProvider messages={await clientMessages("root")}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
