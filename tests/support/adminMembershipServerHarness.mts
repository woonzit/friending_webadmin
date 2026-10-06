import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createSessionToken, SESSION_MAX_AGE_SECONDS } from "../../lib/sessionCodec.ts";
import { MEMBERSHIP_EMAIL, type MembershipCase } from "./adminMembershipCases.mts";

// Production server functions, DERIVED Next/cookie/socket adapters. All other
// imports are real production helpers. No provider, server, or user cookie.
type NextResolve = (specifier: string, context: unknown) => unknown;
(nodeModule as unknown as { registerHooks: (hooks: { resolve: (specifier: string, context: unknown, next: NextResolve) => unknown }) => void }).registerHooks({
  resolve(specifier, context, next) { return specifier === "server-only" ? { url: "data:text/javascript,", shortCircuit: true, format: "module" } : next(specifier, context); },
});
const secret = "test-membership-session-secret-0000000000";
export async function serverModule(path: string, overrides: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const context: Record<string, any> = { exports: {}, Buffer, JSON, Object, File, FormData, URLSearchParams, AbortSignal, NextRequest: class {},
    process: { env: { WEBADMIN_SESSION_SECRET: secret } }, ...overrides };
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    const module = (node.moduleSpecifier as ts.StringLiteral).text;
    const missing = node.importClause.namedBindings.elements.filter((item) => !item.isTypeOnly && context[item.name.text] === undefined);
    if (!missing.length) continue;
    assert.ok(module.startsWith("@/lib/"), `unreviewed runtime dependency ${module}`);
    const actual = await import(new URL(`../../${module.slice(2)}.ts`, import.meta.url).href);
    for (const item of missing) context[item.name.text] = actual[item.propertyName?.text ?? item.name.text];
  }
  const body = tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join("\n");
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
export async function sessionHarness(answer: MembershipCase) {
  const controller = new AbortController(), calls: Record<string, unknown>[] = [];
  const state = { token: createSessionToken(MEMBERSHIP_EMAIL, secret), answer, coreThrows: false, cookiesThrow: false };
  const api = await serverModule("lib/session.ts", {
    cookies: async () => { if (state.cookiesThrow) throw new Error("DERIVED cookies unavailable"); return { get: () => ({ value: state.token }) }; },
    coreCall: async (action: string, payload: Record<string, unknown>, _timeout: unknown, options: { signal?: AbortSignal; membershipCheck?: boolean }) => {
      assert.equal(action, "admin_me"); assert.equal(payload.admin_email, MEMBERSHIP_EMAIL); assert.equal(options.membershipCheck, true);
      calls.push({ action, payload, options });
      if (state.coreThrows) throw new Error("DERIVED service unavailable");
      if (state.answer.abandoned) controller.abort();
      return { status: state.answer.status, data: state.answer.data };
    },
  }) as typeof import("../../lib/session.ts");
  return { api, state, calls, controller, expiredToken: createSessionToken(MEMBERSHIP_EMAIL, secret, Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 1) };
}
export const WRITER_ROUTES = ["upload-image", "upload-video", "upload-profile-icon", "upload-pinger-icon", "support-media", "persona-member", "profile-verification-evidence"] as const;
export class DerivedNextResponse extends Response {
  static json(value: unknown, options: ResponseInit) { return new Response(JSON.stringify(value), { ...options, headers: { ...options.headers, "Content-Type": "application/json" } }); }
}
export function writerRequest(signal: AbortSignal) {
  let bodyReads = 0;
  return { get bodyReads() { return bodyReads; }, request: {
    signal, headers: new Headers({ origin: "https://admin.example.test", host: "admin.example.test", referer: "https://admin.example.test/users",
      "sec-fetch-site": "same-origin", "sec-fetch-dest": "image", "x-friending-admin-request": "1", "content-length": "100" }),
    formData: async () => { bodyReads++; return new FormData(); }, text: async () => { bodyReads++; return "{}"; },
    nextUrl: { searchParams: new URLSearchParams() },
  } };
}
