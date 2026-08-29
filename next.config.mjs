import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "media-src 'self' https:",
].join("; ");

/**
 * The one document that loads the Google Maps JavaScript API (`/appearance-map`,
 * embedded by the Appearance & placements editor) carries Google's documented
 * allow-list instead of the console policy:
 * https://developers.google.com/maps/documentation/javascript/content-security-policy
 * It may be framed only by this origin, and it sends an origin-level referrer
 * because the browser key is website-restricted on Google's side. Every other
 * route keeps the strict policy above, `no-referrer` included.
 */
export const appearanceMapContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  // 'unsafe-eval' is required by Google's allow-list sample ("Allowlist CSP",
  // lines 98-110, page updated 2026-08-25). It is tolerable ONLY because this
  // document is an authenticated frame that renders the map alone: no console
  // UI, no operator data, no secret ever reaches it.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com *.google.com *.googleusercontent.com",
  "connect-src 'self' https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:",
  "frame-src *.google.com",
  "worker-src blob:",
  "media-src 'self'",
].join("; ");

export const appearanceMapFramePath = "/appearance-map";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
          },
        ],
      },
      {
        // Later entries win for a repeated header key, so this narrows exactly
        // four headers for the map document and inherits the rest from above.
        source: appearanceMapFramePath,
        headers: [
          { key: "Content-Security-Policy", value: appearanceMapContentSecurityPolicy },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The frame renders per session: never let a proxy or the browser
          // replay an authenticated map document to another operator.
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
