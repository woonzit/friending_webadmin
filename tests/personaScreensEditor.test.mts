import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PersonaScreensEditor } from "../components/PersonaScreensCard.tsx";
import {
  personaScreensDraft,
  personaScreensDraftWithExternalLinkValue,
  personaScreensDraftWithValue,
  type PersonaScreenLanguage,
  type PersonaScreensConsole,
  type PersonaScreensCopyDefault,
  type PersonaScreensDraft,
} from "../lib/personaScreens.ts";

/**
 * The card's own rendered output, in both locales, from the real component and
 * the real locale files.
 *
 * The values typed into the editors below are deliberately unmistakable, for
 * the T-588 reason: the published Core corpus stores the app's own compiled
 * Hungarian in the slots it calls "served", so an assertion that a served value
 * appears would pass on a console that served nothing at all. Nothing here
 * could be confused with a string the app already contains.
 */
const OPERATOR_HU_HEADLINE = "OPERÁTOR HU főcím, ember gépelte";
const OPERATOR_EN_HEADLINE = "OPERATOR EN headline, typed by a human";
const OPERATOR_HU_LINK_LABEL = "OPERÁTOR HU tájékoztató link — kézzel beírva";
const OPERATOR_HU_LINK_URL = "https://example.com/hu/persona?forras=operator#reszletek";
const OPERATOR_EN_LINK_LABEL = "OPERATOR EN policy link — typed in this console";
const OPERATOR_EN_LINK_URL = "https://example.com/en/persona?source=operator#details";

/** Stand-ins for the app's compiled strings, distinct from every operator value. */
function reference(): PersonaScreensConsole["compiled_reference"] {
  const screens = (language: string) => ({
    pre: { headline: `APP ${language} pre headline`, subtitle: `APP ${language} pre subtitle`, cta: `APP ${language} pre cta` },
    success: { headline: `APP ${language} success headline`, subtitle: `APP ${language} success subtitle`, cta: `APP ${language} success cta` },
    failed: { headline: `APP ${language} failed headline`, subtitle: `APP ${language} failed subtitle`, cta: `APP ${language} failed cta` },
  });
  return { en: screens("EN"), hu: screens("HU") };
}

function consoleState(copyDefault: PersonaScreensCopyDefault): PersonaScreensConsole {
  return {
    revision: 4,
    copy_default: copyDefault,
    compiled_reference: reference(),
    reference_authority: "ios:Localizable.strings:verification.screen.*",
    screens: ["pre", "success", "failed"],
    slots: ["headline", "subtitle", "cta"],
    languages: ["en", "hu"],
    slot_byte_limits: { headline: 120, subtitle: 320, cta: 40 },
  };
}

async function render(options: {
  locale: "en" | "hu";
  copyDefault: PersonaScreensCopyDefault;
  draft?: (draft: PersonaScreensDraft) => PersonaScreensDraft;
  language?: PersonaScreenLanguage;
  editable?: boolean;
  refusedField?: string | null;
}): Promise<string> {
  const messages = JSON.parse(
    await readFile(new URL(`../messages/${options.locale}.json`, import.meta.url), "utf8"),
  );
  const base = personaScreensDraft(options.copyDefault);
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: options.locale, messages },
    createElement(PersonaScreensEditor, {
      access: { visible: true, editable: options.editable ?? true },
      console_: consoleState(options.copyDefault),
      draft: options.draft ? options.draft(base) : base,
      language: options.language ?? "en",
      busy: false,
      locked: false,
      notice: null,
      refusedField: options.refusedField ?? null,
      onLanguage: () => {},
      onPatch: () => {},
      onExternalLinkPatch: () => {},
      onReload: () => {},
      onSave: () => {},
    }),
  ));
}

/** React escapes these five characters in text and in attributes; the locale copy is full of apostrophes. */
function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

/** The `value=""` attribute React emits for an empty controlled input. */
function valueAttributes(markup: string): string[] {
  return [...markup.matchAll(/value="([^"]*)"/g)].map((match) => match[1]);
}

test("an untouched console states both opposite empty meanings at all eleven controls", async () => {
  for (const locale of ["en", "hu"] as const) {
    const markup = await render({ locale, copyDefault: {} });
    const messages = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    const screens = messages.personaAdmin.screens;

    // Every editor is empty, and the app's own copy is ghost text beside it.
    assert.equal(
      [...markup.matchAll(/<(?:input|textarea)[^>]+id="persona-screens-/gu)].length,
      11,
      `${locale} has nine copy and two link controls`,
    );
    assert.equal(valueAttributes(markup).filter((value) => value !== "").length, 0, locale);
    for (const slot of ["headline", "subtitle", "cta"]) {
      assert.ok(markup.includes(`placeholder="APP EN pre ${slot}"`), `${locale} ${slot} placeholder`);
    }
    // Emptiness is stated in words rather than left to be interpreted.
    const emptyHint = escaped(screens.emptyMeans.replace("{language}", screens.languages.en));
    assert.equal(markup.split(emptyHint).length - 1, 9, `${locale} says so on all nine controls`);
    for (const field of ["label", "url"] as const) {
      const linkHint = escaped(screens.externalLink.controls[field].empty
        .replace("{language}", screens.languages.en));
      assert.equal(markup.split(linkHint).length - 1, 1,
        `${locale} ${field} says empty means no button and no app copy`);
    }
    assert.ok(markup.includes(escaped(screens.rule.emptyIsCorrect)), `${locale} rule copy`);
    assert.ok(markup.includes(escaped(screens.rule.perLanguage)), `${locale} per-language copy`);
    assert.ok(markup.includes(escaped(screens.externalLink.status.off.title)), `${locale} button-off status`);
  }
});

test("the compiled reference is a placeholder and never a value", async () => {
  const markup = await render({ locale: "en", copyDefault: {} });
  for (const value of valueAttributes(markup)) {
    assert.equal(value.startsWith("APP "), false, `the app's own copy appeared as a value: ${value}`);
  }
  assert.ok(markup.includes('placeholder="APP EN pre headline"'));
  for (const field of ["label", "url"] as const) {
    const control = markup.match(new RegExp(
      `<input[^>]*id="persona-screens-en-pre-external-link-${field}"[^>]*>`,
      "u",
    ))?.[0] ?? "";
    assert.notEqual(control, "", `${field} link control exists`);
    assert.equal(control.includes("placeholder="), false,
      `${field} has no compiled default to show as a placeholder`);
  }
  // The preview still shows what the member would get, so the operator can see
  // the screen they are about to change.
  assert.ok(markup.includes("APP EN pre headline"), "the preview renders the app's own copy");
});

test("a Hungarian tab shows no English at all when only English is stored", async () => {
  const englishOnly: PersonaScreensCopyDefault = {
    en: {
      pre: {
        headline: OPERATOR_EN_HEADLINE,
        external_link: { label: OPERATOR_EN_LINK_LABEL, url: OPERATOR_EN_LINK_URL },
      },
      success: { headline: OPERATOR_EN_HEADLINE },
      failed: { headline: OPERATOR_EN_HEADLINE },
    },
  };
  const hungarian = await render({ locale: "hu", copyDefault: englishOnly, language: "hu" });
  assert.equal(hungarian.includes(OPERATOR_EN_HEADLINE), false,
    "an operator's English reached the Hungarian tab");
  assert.equal(hungarian.includes(OPERATOR_EN_LINK_LABEL), false,
    "an operator's English link label reached the Hungarian tab");
  assert.equal(hungarian.includes(OPERATOR_EN_LINK_URL), false,
    "an operator's English link URL reached the Hungarian tab");
  assert.equal(valueAttributes(hungarian).filter((value) => value !== "").length, 0,
    "every Hungarian box is empty, which is the correct state");
  // Its preview is the app's complete Hungarian, which is what a member gets.
  assert.ok(hungarian.includes("APP HU pre headline"));

  const english = await render({ locale: "hu", copyDefault: englishOnly, language: "en" });
  assert.ok(english.includes(`value="${OPERATOR_EN_HEADLINE}"`), "the English tab shows the stored English");
  assert.ok(english.includes(`value="${OPERATOR_EN_LINK_LABEL}"`), "the English tab shows its own link label");
  assert.ok(english.includes(`value="${OPERATOR_EN_LINK_URL}"`), "the English tab shows its own link URL");
});

test("an operator's Hungarian renders in the editor and in both appearances of the preview", async () => {
  const markup = await render({
    locale: "hu",
    copyDefault: {},
    language: "hu",
    draft: (draft) => personaScreensDraftWithValue(draft, "hu", "pre", "headline", OPERATOR_HU_HEADLINE),
  });
  assert.ok(markup.includes(`value="${OPERATOR_HU_HEADLINE}"`), "the editor holds the typed value");
  // Once in the light frame and once in the dark one, plus the editor value.
  assert.equal(markup.split(OPERATOR_HU_HEADLINE).length - 1, 3, "editor + light preview + dark preview");
  assert.ok(markup.includes('class="persona-screens-phone persona-screens-phone-light"'));
  assert.ok(markup.includes('class="persona-screens-phone persona-screens-phone-dark"'));
  // The slot the operator did not touch still previews the app's own Hungarian.
  assert.ok(markup.includes("APP HU pre subtitle"));
  // The app's own headline survives only as the ghost text behind the typed
  // value; it is never rendered as the screen's headline.
  assert.ok(markup.includes('placeholder="APP HU pre headline"'));
  assert.equal(markup.includes("<h4 class=\"persona-screens-phone-headline\">APP HU pre headline</h4>"), false,
    "the operator's headline replaced the app's own in the preview");
  assert.equal(
    markup.split('<h4 class="persona-screens-phone-headline">' + OPERATOR_HU_HEADLINE + "</h4>").length - 1,
    2,
    "the typed headline is the headline in both appearances",
  );
});

test("a complete operator-authored link previews between subtitle and CTA in both appearances", async () => {
  const markup = await render({
    locale: "hu",
    copyDefault: {},
    language: "hu",
    draft: (draft) => personaScreensDraftWithExternalLinkValue(
      personaScreensDraftWithExternalLinkValue(draft, "hu", "label", OPERATOR_HU_LINK_LABEL),
      "hu",
      "url",
      OPERATOR_HU_LINK_URL,
    ),
  });
  const messages = JSON.parse(
    await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"),
  );
  assert.equal(markup.split(OPERATOR_HU_LINK_LABEL).length - 1, 3,
    "label control plus light and dark previews");
  assert.equal(markup.split(OPERATOR_HU_LINK_URL).length - 1, 3,
    "URL control plus the title on both preview link rows");
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.externalLink.status.visible.title)));

  const subtitleControl = markup.indexOf('id="persona-screens-hu-pre-subtitle"');
  const labelControl = markup.indexOf('id="persona-screens-hu-pre-external-link-label"');
  const urlControl = markup.indexOf('id="persona-screens-hu-pre-external-link-url"');
  const ctaControl = markup.indexOf('id="persona-screens-hu-pre-cta"');
  assert.ok(subtitleControl < labelControl && labelControl < urlControl && urlControl < ctaControl,
    "the editor follows headline → subtitle → external_link → cta");

  for (const frame of markup.split('<figure class="persona-screens-phone').slice(1, 3)) {
    const subtitle = frame.indexOf("persona-screens-phone-subtitle");
    const link = frame.indexOf("persona-screens-phone-external-link");
    const cta = frame.indexOf("persona-screens-phone-cta");
    assert.ok(subtitle < link && link < cta, "the member preview follows the same presentation order");
  }
});

test("each half-pair is saveable but visibly hidden from both previews", async () => {
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  for (const [field, value, status] of [
    ["label", OPERATOR_EN_LINK_LABEL, "missingUrl"],
    ["url", OPERATOR_EN_LINK_URL, "missingLabel"],
  ] as const) {
    const markup = await render({
      locale: "en",
      copyDefault: {},
      language: "en",
      draft: (draft) => personaScreensDraftWithExternalLinkValue(draft, "en", field, value),
    });
    assert.ok(markup.includes(escaped(messages.personaAdmin.screens.externalLink.status[status].title)));
    assert.ok(markup.includes(escaped(messages.personaAdmin.screens.externalLink.status[status].detail)));
    assert.equal(markup.includes("persona-screens-phone-external-link"), false,
      `${field}-only must reserve no preview row`);
    assert.doesNotMatch(markup, /<button[^>]*class="button button-primary"[^>]*disabled=""/,
      `${field}-only is a valid draft that can be saved`);
  }
});

test("the card counts, per language, how much of the screen the operator actually owns", async () => {
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const row = (language: string, published: number) => messages.personaAdmin.screens.published.row
    .replace("{language}", language)
    .replace("{published}", String(published))
    .replace("{compiled}", String(9 - published))
    .replace("{total}", "9");

  const markup = await render({
    locale: "en",
    copyDefault: {
      en: {
        pre: {
          headline: OPERATOR_EN_HEADLINE,
          external_link: { label: OPERATOR_EN_LINK_LABEL, url: OPERATOR_EN_LINK_URL },
          cta: "Start",
        },
      },
    },
  });
  assert.ok(markup.includes(escaped(row("English", 2))), "two English slots come from the operator");
  assert.ok(markup.includes(escaped(row("Hungarian", 0))), "and none in Hungarian, which is a fact worth showing");
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.externalLink.published
    .replace("{language}", "English")
    .replace("{status}", messages.personaAdmin.screens.externalLink.status.visible.title))),
    "the optional link is reported separately rather than becoming a tenth compiled slot");
});

test("a refused value marks the exact control Core named, not the form", async () => {
  const markup = await render({
    locale: "en",
    copyDefault: {},
    language: "hu",
    refusedField: "copy_default.hu.pre.headline",
  });
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  assert.equal(markup.split(escaped(messages.personaAdmin.screens.refusedControl)).length - 1, 1,
    "exactly one control is marked");
  const marked = markup.indexOf(escaped(messages.personaAdmin.screens.refusedControl));
  const control = markup.lastIndexOf('id="persona-screens-hu-pre-headline"', marked);
  assert.ok(control >= 0 && control < marked, "the marker sits with the headline Core refused");
});

test("a locally refusable value blocks the save and names its own field path", async () => {
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const markup = await render({
    locale: "en",
    copyDefault: {},
    language: "en",
    draft: (draft) => personaScreensDraftWithValue(draft, "en", "success", "cta", "x".repeat(41)),
  });
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.issues.overCap)));
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.issueSummary
    .replace("{count}", "1")
    .replace("{field}", "copy_default.en.success.cta"))));
  assert.match(markup, /<button[^>]*class="button button-primary"[^>]*disabled=""/);
});

test("an unsafe URL blocks save, names the URL field, and previews no link", async () => {
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const markup = await render({
    locale: "en",
    copyDefault: {},
    language: "en",
    draft: (draft) => personaScreensDraftWithExternalLinkValue(
      personaScreensDraftWithExternalLinkValue(draft, "en", "label", OPERATOR_EN_LINK_LABEL),
      "en",
      "url",
      "http://operator.invalid/persona",
    ),
  });
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.issues.invalidHttpsUrl)));
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.issueSummary
    .replace("{count}", "1")
    .replace("{field}", "copy_default.en.pre.external_link.url"))));
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.externalLink.status.invalid.title)));
  assert.equal(markup.includes("persona-screens-phone-external-link"), false);
  assert.match(markup, /<button[^>]*class="button button-primary"[^>]*disabled=""/);
});

test("a Core URL refusal marks that exact dedicated control", async () => {
  const markup = await render({
    locale: "en",
    copyDefault: {},
    language: "hu",
    refusedField: "copy_default.hu.pre.external_link.url",
  });
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  const marker = markup.indexOf(escaped(messages.personaAdmin.screens.refusedControl));
  const control = markup.lastIndexOf('id="persona-screens-hu-pre-external-link-url"', marker);
  assert.ok(control >= 0 && control < marker);
});

test("a reader sees the copy and no way to change it", async () => {
  const markup = await render({ locale: "en", copyDefault: {}, editable: false });
  const messages = JSON.parse(
    await readFile(new URL("../messages/en.json", import.meta.url), "utf8"),
  );
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.readOnly)));
  assert.ok(markup.includes(escaped(messages.personaAdmin.screens.viewer)));
  // Eleven editors plus the save button; the language tabs and the reload button
  // stay live because reading in the other language is not a write.
  assert.equal(markup.split('disabled=""').length - 1, 12, "every editor and the save button are disabled");
});

/**
 * The console has no control that fills one editor from another language or
 * from the app's own copy, and that absence is what keeps D-077 closed. It is
 * asserted from the source because an absence cannot be rendered.
 */
test("no control exists that fills an editor from the reference or the other language", async () => {
  const source = await readFile(new URL("../components/PersonaScreensCard.tsx", import.meta.url), "utf8");

  assert.match(source, /placeholder: reference\[language\]\[screen\]\[slot\]/,
    "the compiled reference is ghost text on the control it belongs to");
  assert.match(source, /personaScreenPreview\(draft, reference, language, screen\)/,
    "the preview is the only other place the reference is read");
  assert.match(source, /aria-pressed=\{language === entry\}/,
    "the languages are tabs, so English is never sitting beside an empty Hungarian box");
  assert.doesNotMatch(source, /resetCompiled|fillFrom|copyFrom|prefill|preFill/i,
    "no control may fill an editor from the app's copy or from the other language");

  for (const line of source.split("\n")) {
    if (/\breference\b|compiled_reference/.test(line)) {
      assert.doesNotMatch(
        line,
        /setDraft|personaScreensDraftWith(?:ExternalLink)?Value|onPatch\(|onExternalLinkPatch/,
        `the reference must never reach a draft mutation: ${line.trim()}`);
    }
    if (/personaScreensDraftWith(?:ExternalLink)?Value|setDraft\(/.test(line)) {
      assert.doesNotMatch(line, /"en"|"hu"/,
        `a draft mutation must never name a language literally: ${line.trim()}`);
    }
  }
});
