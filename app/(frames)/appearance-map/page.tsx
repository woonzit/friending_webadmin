import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import AppearanceMapFrame from "@/components/AppearanceMapFrame";
import { APPEARANCE_RULES_CONTRACT_READY } from "@/lib/contractReadiness";
import { adminMe } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The only document that loads the Google Maps JavaScript API. It is embedded
 * by the Appearance & placements editor and served with its own route-scoped
 * headers (see `next.config.mjs`). It is never a navigation target: an
 * unauthenticated or revoked operator gets a short refusal, not the login
 * page rendered inside a frame.
 */
export default async function AppearanceMapPage() {
  if (!APPEARANCE_RULES_CONTRACT_READY) notFound();
  const t = await getTranslations("appearance.map");
  const locale = await getLocale();
  const me = await adminMe();
  if (!me) {
    return (
      <main className="appearance-map-frame" data-status="refused">
        <p className="appearance-map-status" role="alert">{t("authRequired")}</p>
      </main>
    );
  }
  return (
    <main className="appearance-map-document">
      <AppearanceMapFrame language={locale === "hu" ? "hu" : "en"} />
    </main>
  );
}
