type HeaderReader = { get(name: string): string | null };

export const ADMIN_REQUEST_HEADER = "x-friending-admin-request";
export const ADMIN_REQUEST_HEADER_VALUE = "1";

function sameHost(urlValue: string, host: string): boolean {
  try {
    return new URL(urlValue).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function isSameOrigin(headers: HeaderReader): boolean {
  const origin = headers.get("origin");
  const host = headers.get("host") ?? "";
  if (!origin || !host || !sameHost(origin, host)) return false;
  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  return !fetchSite || fetchSite === "same-origin";
}

export function isTrustedAdminRequest(headers: HeaderReader): boolean {
  return (
    headers.get(ADMIN_REQUEST_HEADER) === ADMIN_REQUEST_HEADER_VALUE &&
    isSameOrigin(headers)
  );
}

/** Fetch Metadata destinations of the media elements that embed private evidence. */
const MEDIA_FETCH_DESTINATIONS: ReadonlySet<string> = new Set(["image", "video", "audio"]);

/**
 * Same-origin guard for cookie-authenticated media subresources. `<video>` and
 * `<img>` GET requests cannot attach the custom mutation header and omit
 * `Origin`, and the console's `Referrer-Policy: no-referrer` also strips
 * `Referer` — so a request is trusted when EITHER a same-host Referer/Origin
 * accompanies a non-cross-site Fetch Metadata value, OR, with no such header,
 * the browser itself reports `Sec-Fetch-Site: same-origin` for a media
 * element (`Sec-Fetch-Dest: image`, `video` or `audio`). Both are forbidden
 * headers no page script or other site can set. Directly opening an evidence
 * URL (`Sec-Fetch-Site: none`), embedding it elsewhere, or a same-origin
 * navigation to it (a link click arrives without Referer under the console
 * policy, with `Sec-Fetch-Dest: document`) therefore still fails.
 *
 * Before the second branch existed, every private evidence `<img>`/`<video>`
 * (sent without Referer under the console policy) got 403.
 */
export function isTrustedAdminMediaRead(headers: HeaderReader): boolean {
  const host = headers.get("host") ?? "";
  const source = headers.get("origin") ?? headers.get("referer") ?? "";
  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  if (host === "") return false;
  if (source !== "") {
    return sameHost(source, host) && (!fetchSite || fetchSite === "same-origin");
  }
  const fetchDest = headers.get("sec-fetch-dest")?.toLowerCase() ?? "";
  return fetchSite === "same-origin" && MEDIA_FETCH_DESTINATIONS.has(fetchDest);
}
