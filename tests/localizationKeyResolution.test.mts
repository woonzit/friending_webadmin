import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

// A static check that the literal keys the console asks next-intl for exist in both locale files. next-intl
// renders a missing key as its raw path ("datesAdmin.activityDetail.recordWithheld"), so a key that resolves
// under the wrong namespace ships silently: the parity test only compares the two trees with each other.
//
// What it reads: every `const X = useTranslations("<literal>")` (and `await getTranslations("<literal>")`) in
// app/, components/ and lib/, and every call `X("<key>")`, `X.rich/markup("<key>")` and `X.raw("<key>")` whose
// X is bound, by ordinary lexical scope, to such a declaration. A key is a string literal, a template literal
// without substitutions, or a ternary whose branches are such literals. Anything else - a computed key, a
// translator received as a parameter or from a hook of another shape, `X.has(...)` - is dynamic and skipped.
// A call resolves when namespace + key names a string leaf (any value for `raw`) in en.json and hu.json.

const ROOTS = ["app", "components", "lib"];
const LOCALES = ["en", "hu"] as const;
const TRANSLATOR_FACTORIES = new Set(["useTranslations", "getTranslations"]);
const STRING_METHODS = new Set(["rich", "markup"]);

/**
 * Known false positives: `file|namespace.key` -> why the static reading is wrong there. Keep it small; a real
 * broken key is fixed, never listed here.
 */
const ALLOWLIST: Record<string, string> = {};

type Use = { file: string; line: number; path: string; raw: boolean };

const messages = Object.fromEntries(LOCALES.map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")) as unknown])) as Record<typeof LOCALES[number], unknown>;

function lookup(tree: unknown, path: string): unknown {
  let node = tree;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node) || !Object.hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The literal values an expression can take, or null when it is dynamic. */
function literals(node: ts.Expression): string[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node)) {
    const whenTrue = literals(node.whenTrue), whenFalse = literals(node.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

/** The namespace of `useTranslations("<literal>")` / `await getTranslations("<literal>")`, "" for the root, or null. */
function translatorNamespace(initializer: ts.Expression | undefined): string | null {
  let node = initializer;
  if (node && ts.isAwaitExpression(node)) node = node.expression;
  if (!node || !ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !TRANSLATOR_FACTORIES.has(node.expression.text)) return null;
  if (node.arguments.length === 0) return "";
  const namespace = literals(node.arguments[0]);
  return namespace && namespace.length === 1 ? namespace[0] : null;
}

function bindsName(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  return name.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, text));
}

/**
 * The declaration an identifier refers to, by lexical scope: the nearest enclosing block, file or function whose
 * own statements or parameters bind the name. Returns the variable declaration, "other" for any other binding
 * (a parameter, a function, a destructured or loop variable), or null when nothing in the file binds it.
 */
function binding(identifier: ts.Identifier): ts.VariableDeclaration | "other" | null {
  const name = identifier.text;
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => bindsName(parameter.name, name))) return "other";
    const statements = ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) ? scope.statements
      : ts.isCaseClause(scope) || ts.isDefaultClause(scope) ? scope.statements : null;
    if (!statements) {
      if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer
        && ts.isVariableDeclarationList(scope.initializer) && scope.initializer.declarations.some((item) => bindsName(item.name, name))) return "other";
      if (ts.isCatchClause(scope) && scope.variableDeclaration && bindsName(scope.variableDeclaration.name, name)) return "other";
      continue;
    }
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
          if (bindsName(declaration.name, name)) return "other";
        }
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
        return "other";
      }
    }
  }
  return null;
}

function usesIn(file: string, source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")): Use[] {
  if (!/\b(useTranslations|getTranslations)\(/.test(source)) return [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const uses: Use[] = [];
  const line = (node: ts.Node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const namespace = translatorNamespace(node.initializer);
      // A translator for a namespace that does not exist cannot resolve any key.
      if (namespace) uses.push({ file, line: line(node), path: namespace, raw: true });
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      let callee: ts.Identifier | null = null, raw = false;
      if (ts.isIdentifier(node.expression)) callee = node.expression;
      else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        && (STRING_METHODS.has(node.expression.name.text) || node.expression.name.text === "raw")) {
        callee = node.expression.expression; raw = node.expression.name.text === "raw";
      }
      const declaration = callee ? binding(callee) : null;
      const namespace = declaration && declaration !== "other" ? translatorNamespace(declaration.initializer) : null;
      const keys = namespace === null ? null : literals(node.arguments[0]);
      if (keys) for (const key of keys) uses.push({ file, line: line(node), path: namespace ? `${namespace}.${key}` : key, raw });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return uses;
}

const files = ROOTS.flatMap(sourceFiles).sort();
const uses = files.flatMap((file) => usesIn(file));

test("the key resolution check reads the console's translators (guards the scanner itself)", () => {
  // The check is only as good as its reach: it must find the translators and keys the console really uses.
  assert.ok(files.length > 200, `source files read: ${files.length}`);
  assert.ok(uses.length > 3000, `literal translator keys read: ${uses.length}`);
  const at = (file: string, path: string) => uses.some((use) => use.file === file && use.path === path);
  assert.ok(at("app/(dashboard)/photo-moderation/page.tsx", "photoModeration.loadError"));
  assert.ok(at("app/(dashboard)/photo-moderation/page.tsx", "photoModeration.accessError"), "both literal branches of a ternary key");
  assert.ok(at("app/(dashboard)/dates/[activityId]/page.tsx", "datesAdmin.activityDetail.recordWithheld"), "the key once looked up under the wrong namespace");
  assert.ok(at("app/(frames)/appearance-map/page.tsx", "appearance.map"), "an awaited server translator");
});

test("the scanner follows lexical scope and skips what it cannot read statically", () => {
  // A synthetic file: two components bind `t` to different namespaces, a helper receives a translator as a
  // parameter, and the keys are literal, ternary, computed and concatenated.
  const source = `
    import { useTranslations } from "next-intl";
    function label(t: (key: string) => string) { return t("fromParameter"); }
    export function First() {
      const t = useTranslations("first");
      const inner = () => { const t = useTranslations("inner"); return t("innerKey"); };
      return [t("plain"), t(\`template\`), t(flag ? "yes" : "no"), t(\`dynamic.\${flag}\`), t("prefix." + flag), t.has("probe"), t.rich("rich"), t.raw("raw"), inner, label(t)];
    }
    export function Second() {
      const t = useTranslations("second");
      return t("own");
    }
    const outside = t("unbound");
  `;
  assert.deepEqual(usesIn("synthetic.tsx", source).map(({ path, raw }) => raw ? `raw:${path}` : path), [
    "raw:first", "raw:inner", "inner.innerKey", "first.plain", "first.template", "first.yes", "first.no", "first.rich", "raw:first.raw",
    "raw:second", "second.own",
  ]);
});

test("every literal translator key resolves to a message in English and Hungarian", () => {
  const broken = new Map<string, string[]>();
  for (const use of uses) {
    if (Object.hasOwn(ALLOWLIST, `${use.file}|${use.path}`)) continue;
    for (const locale of LOCALES) {
      const value = lookup(messages[locale], use.path);
      if (use.raw ? value !== undefined : typeof value === "string") continue;
      const where = `${use.file}:${use.line} ${use.path}`;
      broken.set(where, [...(broken.get(where) ?? []), locale]);
    }
  }
  assert.deepEqual([...broken].map(([where, locales]) => `${where} (${locales.join(", ")})`), []);
});

test("every allowlisted false positive is still read and still unresolved", () => {
  for (const entry of Object.keys(ALLOWLIST)) {
    const [file, path] = entry.split("|");
    assert.ok(uses.some((use) => use.file === file && use.path === path), `${entry} is no longer read; drop it from the allowlist`);
    assert.ok(LOCALES.some((locale) => typeof lookup(messages[locale], path) !== "string"), `${entry} resolves now; drop it from the allowlist`);
  }
});
