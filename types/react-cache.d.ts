/**
 * React's `cache`, which lib/session.ts uses to share one membership check between the layout
 * and the page of a server render. Next 15 renders the App Router with its own vendored React,
 * whose server build exports `cache` (one memo per server request, none outside a render) and
 * whose client build exports it as a pass-through. The installed `@types/react` 18 declares it
 * only among its `react/canary` types; this declares that one function and nothing else of them.
 */
import "react";

declare module "react" {
  export function cache<CachedFunction extends Function>(fn: CachedFunction): CachedFunction;
}
