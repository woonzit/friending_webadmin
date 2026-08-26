import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type JsonObject = Record<string, unknown>;

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as JsonObject).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

test("English and Hungarian message trees stay identical", async () => {
  const en = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"));
  assert.deepEqual(keys(en).sort(), keys(hu).sort());
});

test("all localized leaves are non-empty strings", async () => {
  for (const locale of ["en", "hu"]) {
    const data = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    const visit = (value: unknown): void => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.values(value).forEach(visit);
        return;
      }
      assert.equal(typeof value, "string");
      assert.notEqual(String(value).trim(), "");
    };
    visit(data);
  }
});
