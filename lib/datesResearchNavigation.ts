/** One browser guard for all retained research commands, including hidden actor-fenced owners. */
export function createResearchNavigationGuard(browser: Window, page: Document) {
  const owners = new Map<symbol, { confirm: string; history: string }>();
  let currentHref = browser.location.href;
  const message = () => owners.values().next().value;
  const leavesPage = (href: string) => {
    try {
      const current = new URL(currentHref), next = new URL(href, currentHref);
      return current.origin !== next.origin || current.pathname !== next.pathname;
    } catch { return false; }
  };
  function click(event: MouseEvent) {
    if (!owners.size || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element | null;
    const link = typeof target?.closest === "function" ? target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || link.target && link.target.toLowerCase() !== "_self" || !leavesPage(link.href)) return;
    if (!browser.confirm(message()!.confirm)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function unload(event: BeforeUnloadEvent) {
    if (!owners.size) return;
    event.preventDefault(); event.returnValue = "";
  }
  function history() {
    // popstate cannot be canceled. Capture runs before Next's bubble listener,
    // warning before the old page/retained command is unmounted. Do not trap
    // Back/Forward or rewrite Next's private history state.
    if (owners.size && leavesPage(browser.location.href)) browser.alert(message()!.history);
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
  return { retain(confirm: string, history: string) {
    const token = Symbol("retained research command");
    if (!owners.size) attach();
    owners.set(token, { confirm, history });
    return () => { owners.delete(token); if (!owners.size) detach(); };
  } };
}
let guard: ReturnType<typeof createResearchNavigationGuard> | undefined;
export function retainResearchCommandNavigation(confirm: string, history: string): () => void {
  if (typeof window === "undefined") return () => {};
  guard ??= createResearchNavigationGuard(window, document);
  return guard.retain(confirm, history);
}
