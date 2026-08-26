type HeaderReader = { get(name: string): string | null };

export const ADMIN_REQUEST_HEADER = "x-freelove-admin-request";
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

/**
 * Same-origin guard for cookie-authenticated media subresources. `<video>` and
 * `<img>` GET requests cannot attach the custom mutation header and commonly
 * omit `Origin`, so they must carry a same-host Referer (or Origin) and may not
 * report a cross-site Fetch Metadata value. Directly opening an evidence URL
 * therefore fails even with a copied path.
 */
export function isTrustedAdminMediaRead(headers: HeaderReader): boolean {
  const host = headers.get("host") ?? "";
  const source = headers.get("origin") ?? headers.get("referer") ?? "";
  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  return host !== ""
    && source !== ""
    && sameHost(source, host)
    && (!fetchSite || fetchSite === "same-origin");
}
