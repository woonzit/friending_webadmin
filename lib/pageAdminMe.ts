import { adminCall, type AdminResponse } from "@/lib/adminClient";

/**
 * One `admin_me` answer for the panels a page mounts together. The member page mounts four
 * panels that each need Core's own answer - the role, or a capability block - before they show
 * anything, and each used to ask for it separately. The function this returns asks Core on its
 * first call and hands every later call the same answer, so the panels mounted with it share one
 * request. It is only the answer at mount: a panel's retry, and its re-read after its own write,
 * still ask Core themselves. The page makes a new one each time its panels mount, and nothing of
 * it outlives the page.
 */
export function pageAdminMe(ask: () => Promise<AdminResponse | null> = () => adminCall("admin_me", {})): () => Promise<AdminResponse | null> {
  let answer: Promise<AdminResponse | null> | null = null;
  return () => answer ??= ask();
}
