/**
 * Client message census: which message paths can each route's CLIENT components
 * read, and which scoped provider serves them?
 *
 * `NextIntlClientProvider` serialises its `messages` into every document, so the
 * console scopes them (`lib/clientMessageScopes.ts`): a provider carries only what
 * the client components rendered under it read. Nested providers REPLACE their
 * parent's messages (use-intl `IntlProvider`: `messages ?? prev.messages`), so a
 * component is served by the innermost provider above it and by nothing else.
 *
 * Everything here is derived from source:
 * - routes are the `page.tsx` files under `app/` (and any `not-found`, `error`,
 *   `loading`, `template`, `default` or `global-error` file), each with its chain of
 *   `layout.tsx` files;
 * - a file is a client file once a `"use client"` file is on its import path;
 * - a layout declares a provider either inline,
 *   `<NextIntlClientProvider messages={await clientMessages("<scope>")}>`, where what
 *   it renders inside that element (and `children`, when inside) is served by the
 *   scope and the rest by the parent's, or as `export default
 *   dashboardSegmentLayout("<scope>")`, which wraps `children` and the help mount;
 * - every `useTranslations("<ns>")` in a client file is followed to its uses: a static
 *   key (`t("a")`, `t.raw("a")`, `t.rich`, `t.markup`, `t.has`, a conditional of static
 *   keys) requires that key; a key built at run time under a static prefix
 *   (`t(\`origin.${value}\`)`) requires that subtree; any other key built at run time
 *   requires the whole namespace unless a resolver below derives it; a translator
 *   that escapes (passed on, stored, spread) requires the whole namespace;
 * - a namespace built at run time, `useTranslations()` without one, `useMessages()`,
 *   `useExtracted`, `createTranslator` and any other message provider are problems: they
 *   would need the whole catalogue, and the census refuses to guess.
 *
 * `npx tsx scripts/clientMessageCensus.mts` prints what each scope needs, at namespace
 * granularity, in the shape of `lib/clientMessageScopes.ts`.
 */
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_HELP_REDIRECTS, adminHelpPageForPath } from "../lib/adminHelp.ts";

/** The module whose factory declares a dashboard segment's provider and help mount. */
export const SEGMENT_LAYOUT_MODULE = "components/DashboardSegmentLayout.tsx";
const SEGMENT_LAYOUT_FACTORY = "dashboardSegmentLayout";
const SCOPED_MESSAGES_FUNCTION = "clientMessages";
/** A route file of this name renders where its directory's `page.tsx` would. */
const ROUTE_FILES = ["page.tsx", "not-found.tsx", "error.tsx", "loading.tsx", "template.tsx", "default.tsx"];
/** Rendered INSTEAD of the root layout, so no provider exists above it. */
const ROOTLESS_FILES = ["global-error.tsx"];
const TRANSLATOR_METHODS = new Set(["raw", "rich", "markup", "has"]);

export type Requirement = {
  /** Dotted message path; a namespace or subtree when single keys cannot be derived. */
  path: string;
  /** The `useTranslations` namespace the path is read through. */
  ns: string;
  /** Repository-relative file that reads it. */
  file: string;
  /** Why the path is needed. */
  why: string;
  /**
   * Read only after `t.has(...)` found it in the provider. Coverage does not demand
   * it; `tests/clientMessageScopes.test.mts` checks which provider ships it instead.
   */
  optional: boolean;
};

type KeyPath = { kind: "key"; key: string } | { kind: "subtree"; key: string } | { kind: "resolver"; pattern: string };

type Translator = {
  ns: string;
  /** null: the whole namespace. */
  keys: Array<{ key: string; why: string }> | null;
  dynamic: Array<{ pattern: string; line: number }>;
  why: string;
};

export type FileAnalysis = { imports: string[]; client: boolean; translators: Translator[]; problems: string[] };

export type ProviderDeclaration = {
  scope: string | null;
  /** Files the layout renders inside its provider (or charges to it). */
  inside: Set<string>;
  /** Files the layout renders outside its provider: the parent's scope serves them. */
  outside: Set<string>;
  childrenOutside: boolean;
  problems: string[];
};

/**
 * Keys built at run time that the census can still derive. The key is
 * `<file>#<namespace>#<pattern>`, the pattern being the template with every
 * substitution written `${}`. The resolver receives the route being rendered
 * (`/users/[uid]`) and returns the keys, relative to the namespace, the template can
 * produce there.
 */
export const DYNAMIC_KEY_RESOLVERS: Record<string, (route: string) => { keys: string[]; optional: boolean; why: string }> = {
  // The help reads the guide of the screen it documents, and only after `t.has`
  // found that guide in its own provider: each scope ships the guides of the screens
  // it serves, and exactly one help mount on a route finds its guide.
  "components/AdminHelp.tsx#adminHelp#pages.${}": (route) => {
    const page = adminHelpPageForPath(examplePath(route));
    return { keys: page ? [`pages.${page.key}`] : [], optional: true, why: "the guide of this screen, read once t.has() finds it" };
  },
};

export function examplePath(route: string): string {
  return route.replace(/\[[^\]]+\]/g, "example-id");
}

export type CensusRoute = { route: string; file: string; layouts: string[] };
export type CensusRow = { route: string; scope: string | null; file: string; requirement: Requirement };

export class ClientMessageCensus {
  readonly root: string;
  private readonly cache = new Map<string, FileAnalysis>();
  private readonly sourceOverrides: Map<string, string>;

  /** `sourceOverrides` maps repository-relative paths to replacement source (negative controls). */
  constructor(root: string, sourceOverrides: Record<string, string> = {}) {
    this.root = root;
    this.sourceOverrides = new Map(Object.entries(sourceOverrides).map(([file, source]) => [path.join(root, file), source]));
  }

  relative(file: string): string {
    return path.relative(this.root, file).split(path.sep).join("/");
  }

  private read(file: string): string {
    return this.sourceOverrides.get(file) ?? readFileSync(file, "utf8");
  }

  private exists(file: string): boolean {
    return this.sourceOverrides.has(file) || (existsSync(file) && statSync(file).isFile());
  }

  resolve(from: string, specifier: string): string | null {
    let base: string;
    if (specifier.startsWith("@/")) base = path.join(this.root, specifier.slice(2));
    else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (/\.tsx?$/.test(candidate) && this.exists(candidate)) return candidate;
    }
    return null;
  }

  private parse(file: string): ts.SourceFile {
    return ts.createSourceFile(file, this.read(file), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  }

  analyse(file: string): FileAnalysis {
    const cached = this.cache.get(file);
    if (cached) return cached;
    const tree = this.parse(file);
    const relative = this.relative(file);
    const result: FileAnalysis = { imports: [], client: false, translators: [], problems: [] };
    const line = (node: ts.Node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;

    for (const statement of tree.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      if (statement.expression.text === "use client") result.client = true;
    }

    const intlNames = new Map<string, string>();
    const addImport = (specifier: string) => {
      const resolved = this.resolve(file, specifier);
      if (resolved && !result.imports.includes(resolved)) result.imports.push(resolved);
    };
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        const specifier = statement.moduleSpecifier.text;
        if (specifier === "next-intl" && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) intlNames.set(element.name.text, (element.propertyName ?? element.name).text);
        }
        if (clause?.isTypeOnly) continue;
        const named = clause?.namedBindings;
        const onlyTypes = clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0
          && named.elements.every((element) => element.isTypeOnly);
        if (!onlyTypes) addImport(specifier);
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly) {
        addImport(statement.moduleSpecifier.text);
      }
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
          const [argument] = node.arguments;
          if (argument && ts.isStringLiteralLike(argument)) addImport(argument.text);
          else result.problems.push(`${relative}:${line(node)} imports a module whose name is built at run time`);
        }
        if (ts.isIdentifier(callee) && intlNames.has(callee.text)) {
          const imported = intlNames.get(callee.text);
          if (imported === "useTranslations") {
            const translator = this.translator(node, tree, relative, line, result.problems);
            if (translator) result.translators.push(translator);
          } else if (imported === "useMessages" || imported === "createTranslator" || imported === "useExtracted") {
            result.problems.push(`${relative}:${line(node)} calls ${imported}, which reads the whole catalogue; use useTranslations("<namespace>")`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    this.cache.set(file, result);
    return result;
  }

  private translator(call: ts.CallExpression, tree: ts.SourceFile, relative: string, line: (node: ts.Node) => number, problems: string[]): Translator | null {
    const [namespaceArgument] = call.arguments;
    if (!namespaceArgument) {
      problems.push(`${relative}:${line(call)} calls useTranslations() without a namespace, which reads the whole catalogue`);
      return null;
    }
    if (!ts.isStringLiteralLike(namespaceArgument)) {
      problems.push(`${relative}:${line(call)} builds the useTranslations namespace at run time; use a literal namespace`);
      return null;
    }
    const ns = namespaceArgument.text;
    const declaration = call.parent;
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== call || !ts.isIdentifier(declaration.name)) {
      return { ns, keys: null, dynamic: [], why: `the translator of line ${line(call)} is not bound to a name` };
    }
    const name = declaration.name.text;
    const scope = enclosingScope(declaration);
    const keys = new Map<string, string>();
    const dynamic: Array<{ pattern: string; line: number }> = [];
    let whole: string | null = null;

    const inspect = (node: ts.Node): void => {
      if (node !== scope && shadows(node, name, declaration)) return;
      if (ts.isIdentifier(node) && node.text === name && node !== declaration.name && isReference(node)) {
        let use: ts.Expression = node;
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
          if (!TRANSLATOR_METHODS.has(node.parent.name.text)) {
            whole ??= `line ${line(node)} uses ${name}.${node.parent.name.text}`;
            return;
          }
          use = node.parent;
        }
        const usage = use.parent;
        if (!ts.isCallExpression(usage) || usage.expression !== use) {
          whole ??= `line ${line(node)} passes the translator on`;
          return;
        }
        const [keyArgument] = usage.arguments;
        if (!keyArgument) {
          whole ??= `line ${line(node)} calls the translator without a key`;
          return;
        }
        const derived = keyPaths(keyArgument, (pattern) => Boolean(DYNAMIC_KEY_RESOLVERS[`${relative}#${ns}#${pattern}`]));
        if (!derived) {
          whole ??= `line ${line(keyArgument)} builds the key at run time (${keyArgument.getText(tree).slice(0, 60)})`;
          return;
        }
        for (const item of derived) {
          if (item.kind === "resolver") dynamic.push({ pattern: item.pattern, line: line(keyArgument) });
          else if (!keys.has(item.key)) keys.set(item.key, item.kind === "key" ? "static key" : `line ${line(keyArgument)} builds a key under \`${item.key}\``);
        }
        return;
      }
      ts.forEachChild(node, inspect);
    };
    inspect(scope);
    if (whole !== null) return { ns, keys: null, dynamic: [], why: whole };
    return { ns, keys: [...keys].sort(([a], [b]) => a.localeCompare(b)).map(([key, why]) => ({ key, why })), dynamic, why: "derived keys" };
  }

  /** What one client file reads when it renders on `route`. */
  requirementsFor(file: string, route: string): Requirement[] {
    const relative = this.relative(file);
    const out: Requirement[] = [];
    for (const translator of this.analyse(file).translators) {
      const { ns } = translator;
      if (translator.keys === null) {
        out.push({ path: ns, ns, file: relative, why: `whole namespace: ${translator.why}`, optional: false });
        continue;
      }
      for (const { key, why } of translator.keys) out.push({ path: `${ns}.${key}`, ns, file: relative, why, optional: false });
      for (const { pattern, line } of translator.dynamic) {
        const resolved = DYNAMIC_KEY_RESOLVERS[`${relative}#${ns}#${pattern}`](route);
        for (const key of resolved.keys) {
          out.push({ path: `${ns}.${key}`, ns, file: relative, why: `line ${line}: ${resolved.why}`, optional: resolved.optional });
        }
      }
    }
    return out;
  }

  /** Files reachable from `entries`, each marked client (true) or server. */
  closure(entries: Iterable<string>): Map<string, boolean> {
    const seen = new Map<string, boolean>();
    const stack: Array<[string, boolean]> = [...entries].map((file) => [file, false]);
    while (stack.length) {
      const [file, parentClient] = stack.pop()!;
      const analysis = this.analyse(file);
      const client = parentClient || analysis.client;
      if (seen.has(file) && (seen.get(file) || !client)) continue;
      seen.set(file, client);
      for (const next of analysis.imports) stack.push([next, client]);
    }
    return seen;
  }

  /** Every route file under `app/`, with its layouts outermost first. */
  routes(): CensusRoute[] {
    const app = path.join(this.root, "app");
    const found: CensusRoute[] = [];
    const walk = (directory: string, layouts: string[]) => {
      const layout = path.join(directory, "layout.tsx");
      const chain = this.exists(layout) ? [...layouts, layout] : layouts;
      const route = "/" + path.relative(app, directory).split(path.sep).filter((part) => part && !/^\(.*\)$/.test(part)).join("/");
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!(entry.name === "api" && directory === app)) walk(file, chain);
        } else if (ROUTE_FILES.includes(entry.name)) {
          found.push({ route: entry.name === "page.tsx" ? route : `${route} (${entry.name})`, file, layouts: chain });
        } else if (ROOTLESS_FILES.includes(entry.name)) {
          found.push({ route: `${route} (${entry.name})`, file, layouts: [] });
        }
      }
    };
    walk(app, []);
    return found;
  }

  /** The provider a layout declares, and which files it renders inside and outside it. */
  provider(layout: string): ProviderDeclaration {
    const tree = this.parse(layout);
    const relative = this.relative(layout);
    const problems: string[] = [];
    const importedFrom = new Map<string, string>();
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
      const resolved = this.resolve(layout, statement.moduleSpecifier.text);
      const clause = statement.importClause;
      if (!resolved || !clause) continue;
      if (clause.name) importedFrom.set(clause.name.text, resolved);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) importedFrom.set(element.name.text, resolved);
      }
    }

    // `export default dashboardSegmentLayout("<scope>")`: the factory renders the
    // provider around `children` and the help mount, so all of it is inside.
    for (const statement of tree.statements) {
      if (!ts.isExportAssignment(statement) || !ts.isCallExpression(statement.expression)) continue;
      const call = statement.expression;
      if (!ts.isIdentifier(call.expression) || call.expression.text !== SEGMENT_LAYOUT_FACTORY) continue;
      const [argument] = call.arguments;
      const scope = argument && ts.isStringLiteralLike(argument) ? argument.text : null;
      if (!scope) problems.push(`${relative}: ${SEGMENT_LAYOUT_FACTORY}() needs a literal scope`);
      return { scope, inside: new Set(importedFrom.values()), outside: new Set(), childrenOutside: false, problems };
    }

    const providers: Array<{ node: ts.JsxElement; scope: string | null }> = [];
    const findProviders = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "NextIntlClientProvider") {
        problems.push(`${relative}: a NextIntlClientProvider without children serves nothing`);
      }
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "NextIntlClientProvider") {
        const scope = scopedMessagesScope(node.openingElement.attributes, tree);
        if (!scope) problems.push(`${relative}: NextIntlClientProvider must receive messages={await ${SCOPED_MESSAGES_FUNCTION}("<scope>")}`);
        providers.push({ node, scope });
      }
      ts.forEachChild(node, findProviders);
    };
    findProviders(tree);
    if (providers.length > 1) problems.push(`${relative}: declares ${providers.length} providers; a layout declares at most one`);
    const provider = providers[0];
    const within = (node: ts.Node) => {
      for (let current: ts.Node | undefined = node; current; current = current.parent) if (provider && current === provider.node) return true;
      return false;
    };
    const inside = new Set<string>(), outside = new Set<string>(), rendered = new Set<string>();
    let childrenOutside = false;
    const visit = (node: ts.Node) => {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(tree) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(tree) : null;
      const file = tag ? importedFrom.get(tag) : undefined;
      if (file) {
        rendered.add(file);
        (within(node) ? inside : outside).add(file);
      }
      if (ts.isIdentifier(node) && node.text === "children" && ts.isJsxExpression(node.parent) && !within(node)) childrenOutside = true;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    // An import the layout never renders as an element (a function, a constant) is
    // charged to both sides: the census cannot tell where its effect lands.
    for (const file of importedFrom.values()) {
      if (rendered.has(file)) continue;
      inside.add(file);
      outside.add(file);
    }
    if (!provider) return { scope: null, inside: new Set(), outside: new Set([...inside, ...outside]), childrenOutside: false, problems };
    return { scope: provider.scope, inside, outside, childrenOutside, problems };
  }

  /** Files other than layouts and the segment factory that render a message provider. */
  strayProviders(): string[] {
    const problems: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(file);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || entry.name === "layout.tsx" || this.relative(file) === SEGMENT_LAYOUT_MODULE) continue;
        if (/\b(NextIntlClientProvider|IntlProvider)\b/.test(this.read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) {
          problems.push(`${this.relative(file)}: only a layout or ${SEGMENT_LAYOUT_MODULE} may render a message provider`);
        }
      }
    };
    for (const directory of ["app", "components", "lib"]) walk(path.join(this.root, directory));
    return problems;
  }

  /**
   * For every route file: which scope serves each client file it renders, and what
   * that file reads there. A null scope means no provider is above it.
   */
  census(): { rows: CensusRow[]; problems: string[]; routes: CensusRoute[]; chains: Map<string, Array<string | null>> } {
    const problems: string[] = [...this.strayProviders()];
    const rows: CensusRow[] = [];
    const chains = new Map<string, Array<string | null>>();
    const routes = this.routes();
    const charge = (route: string, scope: string | null, entries: Iterable<string>) => {
      for (const [file, client] of this.closure(entries)) {
        if (!client) continue;
        problems.push(...this.analyse(file).problems);
        for (const requirement of this.requirementsFor(file, route)) rows.push({ route, scope, file: this.relative(file), requirement });
      }
    };
    for (const entry of routes) {
      let serving: string | null = null;
      const chain: Array<string | null> = [];
      for (const layout of entry.layouts) {
        const declared = this.provider(layout);
        problems.push(...declared.problems);
        charge(entry.route, serving, declared.outside);
        if (declared.scope) {
          charge(entry.route, declared.scope, declared.inside);
          if (declared.childrenOutside) problems.push(`${this.relative(layout)}: renders children outside its provider`);
          else serving = declared.scope;
        }
        chain.push(declared.scope);
      }
      charge(entry.route, serving, [entry.file]);
      chains.set(entry.route, chain);
    }
    return { rows, problems: [...new Set(problems)].sort(), routes, chains };
  }
}

function scopedMessagesScope(attributes: ts.JsxAttributes, tree: ts.SourceFile): string | null {
  const messages = attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(tree) === "messages");
  if (!messages || !ts.isJsxAttribute(messages) || !messages.initializer || !ts.isJsxExpression(messages.initializer)) return null;
  const awaited = messages.initializer.expression;
  if (!awaited || !ts.isAwaitExpression(awaited)) return null;
  const call = awaited.expression;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== SCOPED_MESSAGES_FUNCTION) return null;
  const [argument] = call.arguments;
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

function enclosingScope(node: ts.Node): ts.Node {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
  }
  return node.getSourceFile();
}

/** A nested function or block that declares its own `name` hides the translator. */
function shadows(node: ts.Node, name: string, own: ts.VariableDeclaration): boolean {
  if (ts.isFunctionLike(node) && node.parameters.some((parameter) => bindsName(parameter.name, name))) return true;
  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    for (const statement of node.statements) {
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => bindsName(declaration.name, name))) {
        // The block that holds the translator's own declaration is its scope, not a shadow.
        if (statement.declarationList.declarations.includes(own)) continue;
        return true;
      }
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return true;
    }
  }
  if ((ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isForStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
    if (node.initializer.declarations.some((declaration) => bindsName(declaration.name, name))) return true;
  }
  if (ts.isCatchClause(node) && node.variableDeclaration && bindsName(node.variableDeclaration.name, name)) return true;
  return false;
}

function bindsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, name));
}

/** True when the identifier reads a variable rather than naming a property or a declaration. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node) return false;
  if ((ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return true;
}

/**
 * The message paths a key expression can name, relative to the namespace, or null
 * when it can name any key of it. A template whose static head ends in a dotted
 * prefix (`origin.${value}`) can only name keys under that prefix.
 */
function keyPaths(node: ts.Expression, hasResolver: (pattern: string) => boolean): KeyPath[] | null {
  if (ts.isStringLiteralLike(node)) return [{ kind: "key", key: node.text }];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    return keyPaths(node.expression, hasResolver);
  }
  if (ts.isConditionalExpression(node)) {
    const left = keyPaths(node.whenTrue, hasResolver), right = keyPaths(node.whenFalse, hasResolver);
    return left && right ? [...left, ...right] : null;
  }
  if (ts.isTemplateExpression(node)) {
    const pattern = node.head.text + node.templateSpans.map((span) => "${}" + span.literal.text).join("");
    if (hasResolver(pattern)) return [{ kind: "resolver", pattern }];
    const prefix = node.head.text.slice(0, Math.max(0, node.head.text.lastIndexOf(".")));
    return prefix ? [{ kind: "subtree", key: prefix }] : null;
  }
  return null;
}

/** True when the list entry `entry` provides the message path `required`. */
export function covers(entry: string, required: string): boolean {
  return entry === required || required.startsWith(`${entry}.`);
}

/** The shortest list of paths that provides every path given. */
export function minimalCover(paths: Iterable<string>): string[] {
  const sorted = [...new Set(paths)].sort((a, b) => a.split(".").length - b.split(".").length || a.localeCompare(b));
  const kept: string[] = [];
  for (const candidate of sorted) if (!kept.some((entry) => covers(entry, candidate))) kept.push(candidate);
  return kept.sort();
}

/**
 * What each scope needs, as lists in the shape of `lib/clientMessageScopes.ts`, and
 * the guides each scope's help mount must show (the innermost mount on each screen).
 * A namespace is listed whole, as the components name it, unless it is over
 * `SPARSE_NAMESPACE_BYTES`, is read only by known keys, and at most
 * `SPARSE_CHILDREN` of its children are read, together under three quarters of its
 * size: then those children are listed. Redirect-only routes show no guide.
 */
export function suggestScopes(census: ReturnType<ClientMessageCensus["census"]>, catalogue: Record<string, unknown>) {
  const SPARSE_NAMESPACE_BYTES = 4096, SPARSE_CHILDREN = 12;
  const redirects = new Set(ADMIN_HELP_REDIRECTS.map((entry) => entry.route));
  const at = (dotted: string) => dotted.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], catalogue);
  const size = (paths: Iterable<string>) => [...paths].reduce((total, dotted) => total + JSON.stringify(at(dotted) ?? null).length, 0);
  const reads = new Map<string, Map<string, Set<string>>>();
  const guides = new Map<string, Set<string>>();
  const helpScopes = new Map<string, Array<string | null>>();
  for (const { route, scope, requirement } of census.rows) {
    if (requirement.optional) {
      if (!helpScopes.has(route)) helpScopes.set(route, []);
      helpScopes.get(route)!.push(scope);
      continue;
    }
    const name = scope ?? "(no provider)";
    if (!reads.has(name)) reads.set(name, new Map());
    const byNamespace = reads.get(name)!;
    if (!byNamespace.has(requirement.ns)) byNamespace.set(requirement.ns, new Set());
    byNamespace.get(requirement.ns)!.add(requirement.path);
  }
  for (const [route, scopes] of helpScopes) {
    const chain = census.chains.get(route) ?? [];
    const innermost = [...chain].reverse().find((scope) => scope !== null && scopes.includes(scope));
    const page = adminHelpPageForPath(examplePath(route));
    if (!innermost || !page || redirects.has(route)) continue;
    if (!guides.has(innermost)) guides.set(innermost, new Set());
    guides.get(innermost)!.add(page.key);
  }
  const out: Record<string, { messages: string[]; help?: string[] }> = {};
  for (const [scope, byNamespace] of [...reads].sort(([a], [b]) => a.localeCompare(b))) {
    const entries: string[] = [];
    for (const [ns, paths] of byNamespace) {
      if (ns === "adminHelp") continue;
      const children = new Set([...paths].map((dotted) => dotted.split(".").slice(0, ns.split(".").length + 1).join(".")));
      const sparse = !paths.has(ns) && size([ns]) > SPARSE_NAMESPACE_BYTES && children.size <= SPARSE_CHILDREN && size(children) <= 0.75 * size([ns]);
      entries.push(...(sparse ? children : [ns]));
    }
    const help = [...(guides.get(scope) ?? [])].sort();
    out[scope] = help.length ? { messages: minimalCover(entries), help } : { messages: minimalCover(entries) };
  }
  return out;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const census = new ClientMessageCensus(root).census();
  for (const problem of census.problems) console.log(`PROBLEM ${problem}`);
  const catalogue = JSON.parse(readFileSync(path.join(root, "messages", "en.json"), "utf8"));
  for (const [scope, lists] of Object.entries(suggestScopes(census, catalogue))) {
    console.log(`  ${JSON.stringify(scope)}: ${JSON.stringify(lists).replace(/"(messages|help)":/g, "$1: ").replace(/,(?=["\]])/g, ", ")},`);
  }
}
