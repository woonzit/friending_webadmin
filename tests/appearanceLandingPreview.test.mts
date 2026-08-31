import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AppearanceLandingPreview from "../components/AppearanceLandingPreview.tsx";
import {
  APPEARANCE_DEFAULT_LANDING,
  APPEARANCE_DEFAULT_PALETTE,
  resolveAppearanceLanding,
  type AppearanceLanding,
} from "../lib/appearanceRules.ts";

function render(chain: AppearanceLanding[]): string {
  return renderToStaticMarkup(createElement(AppearanceLandingPreview, {
    content: resolveAppearanceLanding(chain, APPEARANCE_DEFAULT_LANDING, "en"),
    fallbackLabel: "Fallback",
    palette: APPEARANCE_DEFAULT_PALETTE.light,
    paletteMode: "light",
    authMethods: "both",
    labels: { apple: "Apple", divider: "or", qr: "QR reader" },
  }));
}

test("the QR preview renders configured circle and icon geometry, including the inherited clamp", () => {
  const defaults = render([]);
  assert.match(defaults, /class="appearance-landing-qr"[^>]*width:44px;height:44px;border-radius:22px/);
  assert.match(defaults, /class="appearance-landing-qr-icon is-built-in" style="width:20px;height:20px"/);

  const clamped = render([{ qr_size: "28" }, { qr_icon_padding: "32" }]);
  assert.match(clamped, /class="appearance-landing-qr"[^>]*width:28px;height:28px;border-radius:14px/);
  assert.match(clamped, /class="appearance-landing-qr-icon is-built-in" style="width:8px;height:8px"/);
});

test("uploaded QR icons keep distinct template and original render paths while the built-in glyph stays template", () => {
  const iconUrl = "https://cdn.friending.co/qr-icon.png";
  const template = render([{
    qr_icon_url: iconUrl,
    qr_icon_render: "template",
    qr_icon_color: "#FF00AA",
  }]);
  assert.match(template, /class="appearance-landing-qr-icon is-template"/);
  assert.match(template, /(?:-webkit-mask-image|mask-image):url\(&quot;https:\/\/cdn\.friending\.co\/qr-icon\.png&quot;\)/);
  assert.doesNotMatch(template, /is-original/);

  const original = render([{ qr_icon_url: iconUrl, qr_icon_render: "original" }]);
  assert.match(original, /<img class="appearance-landing-qr-icon is-original" src="https:\/\/cdn\.friending\.co\/qr-icon\.png"/);
  assert.doesNotMatch(original, /is-template/);

  const builtInOriginal = render([{ qr_icon_render: "original" }]);
  assert.match(builtInOriginal, /is-built-in/);
  assert.doesNotMatch(builtInOriginal, /is-original/);
});

test("disabling the QR control removes the button from the phone preview", () => {
  const hidden = render([{ qr_enabled: "false", qr_size: "96", qr_icon_padding: "0" }]);
  assert.doesNotMatch(hidden, /appearance-landing-qr/);
});
