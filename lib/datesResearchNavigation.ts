export type ResearchNavigationNotice = { kind: "confirm" | "history"; message: string };
/** One in-page guard for all retained research commands, including hidden actor-fenced owners. */
export function createResearchNavigationGuard(browser: Window, page: Document) {
  const owners = new Map<symbol, { confirm: string; history: string }>();
  const subscribers = new Set<() => void>();
  let notice: ResearchNavigationNotice | null = null, waiting: ((leave: boolean) => void) | null = null, approvedLink: HTMLAnchorElement | null = null;
  let currentHref = browser.location.href;
  const message = () => owners.values().next().value;
  const publish = (next: ResearchNavigationNotice | null) => { notice = next; for (const listener of subscribers) listener(); };
  function choose(leave: boolean) { const answer = waiting; waiting = null; publish(null); answer?.(leave); }
  function request(): Promise<boolean> {
    if (!owners.size) return Promise.resolve(true);
    choose(false);
    if (!subscribers.size) {
      // A missing/unmounted notice surface must never silently trap navigation.
      publish({ kind: "history", message: message()!.history }); return Promise.resolve(true);
    }
    return new Promise((resolve) => { waiting = resolve; publish({ kind: "confirm", message: message()!.confirm }); });
  }
  const leavesPage = (href: string) => {
    try {
      const current = new URL(currentHref), next = new URL(href, currentHref);
      if (!["http:", "https:"].includes(next.protocol)) return false;
      return current.origin !== next.origin || current.pathname !== next.pathname;
    } catch { return false; }
  };
  function click(event: MouseEvent) {
    if (!owners.size || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element | null;
    const link = typeof target?.closest === "function" ? target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || link.target && link.target.toLowerCase() !== "_self" || !leavesPage(link.href)) return;
    if (link === approvedLink) return;
    if (!subscribers.size) { publish({ kind: "history", message: message()!.history }); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void request().then((leave) => {
      if (!leave || !link.isConnected) return;
      // Replay the original link so Next keeps its own normal routing behavior.
      approvedLink = link; try { link.click(); } finally { approvedLink = null; }
    });
  }
  function unload(event: BeforeUnloadEvent) {
    if (!owners.size) return;
    event.preventDefault(); event.returnValue = "";
  }
  function history() {
    // popstate cannot be canceled. Keep an in-page notice in the persistent
    // Shell as Next changes the page; never trap Back/Forward or rewrite it.
    if (owners.size && leavesPage(browser.location.href)) { choose(false); publish({ kind: "history", message: message()!.history }); }
    currentHref = browser.location.href;
  }
  function attach() {
    currentHref = browser.location.href;
    page.addEventListener("click", click, true);
    browser.addEventListener("beforeunload", unload);
    browser.addEventListener("popstate", history, true);
  }
  function detach() {
    page.removeEventListener("click", click, true);
    browser.removeEventListener("beforeunload", unload);
    browser.removeEventListener("popstate", history, true);
  }
  return { request, choose, getSnapshot: () => notice,
    subscribe(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); if (!subscribers.size && waiting) choose(false); }; },
    retain(confirm: string, history: string) {
    const token = Symbol("retained research command");
    if (!owners.size) attach();
    owners.set(token, { confirm, history });
    return () => { owners.delete(token); if (!owners.size) { detach(); if (waiting) choose(false); } };
  } };
}
let guard: ReturnType<typeof createResearchNavigationGuard> | undefined;
function browserGuard() {
  if (typeof window === "undefined") return undefined;
  return guard ??= createResearchNavigationGuard(window, document);
}
export function retainResearchCommandNavigation(confirm: string, history: string): () => void {
  return browserGuard()?.retain(confirm, history) ?? (() => {});
}
export const confirmResearchNavigation = (): Promise<boolean> => browserGuard()?.request() ?? Promise.resolve(true);
export const subscribeResearchNavigation = (listener: () => void): (() => void) => browserGuard()?.subscribe(listener) ?? (() => {});
export const getResearchNavigationNotice = (): ResearchNavigationNotice | null => browserGuard()?.getSnapshot() ?? null;
export const chooseResearchNavigation = (leave: boolean): void => { browserGuard()?.choose(leave); };
