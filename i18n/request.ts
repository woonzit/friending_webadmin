import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = ["en", "hu"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export default getRequestConfig(async () => {
  const cookie = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale: Locale = cookie === "hu" ? "hu" : "en";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
