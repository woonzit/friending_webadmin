/**
 * T-802. The landing preview shows a phone, and everything on that phone must
 * read in the PREVIEW's language, not in the console operator's. The authored
 * copy already does — the phone and e-mail button labels come out of the rule
 * resolved for the selected language — but the three chrome labels the preview
 * cannot author (the Apple button, the "or" divider, the QR reader title) were
 * passed in from `t()`, which resolves the CONSOLE locale. On a Hungarian
 * console an EN preview therefore mixed "Continue with phone" with "Folytatás
 * Apple-lel" and "vagy".
 *
 * The obvious fix — read the other locale's bundle — would ship both
 * `messages/*.json` (~1.1 MB) into the client chunk for three strings, on top
 * of the tree `NextIntlClientProvider` already serialises. So the copy lives
 * here, beside the preview contract, exactly like `SECTION_TEASERS_COMPILED_COPY`
 * lives beside Core's: `tests/appearancePreviewLabels.test.mts` asserts every
 * value byte-for-byte against BOTH console namespaces in BOTH bundles
 * (`appearance.landingComposer.preview.{apple,divider,qr}` and
 * `appearance.testPreview.{appleButton,divider,qrButton}`), so it cannot drift
 * from the console copy an operator edits.
 */

export type AppearancePreviewLanguage = "en" | "hu";

export type AppearancePreviewLabels = {
  apple: string;
  divider: string;
  qr: string;
};

export const APPEARANCE_PREVIEW_LABELS:
  Readonly<Record<AppearancePreviewLanguage, AppearancePreviewLabels>> = {
    en: {
      apple: "Continue with Apple",
      divider: "or",
      qr: "QR reader",
    },
    hu: {
      apple: "Folytatás Apple-lel",
      divider: "vagy",
      qr: "QR-olvasó",
    },
  };

/** The preview chrome as the PREVIEW's language renders it. */
export function appearancePreviewLabels(
  language: AppearancePreviewLanguage,
): AppearancePreviewLabels {
  return APPEARANCE_PREVIEW_LABELS[language];
}
