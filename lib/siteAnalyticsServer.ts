import 'server-only';
import { parseSiteAnalyticsReport, type SiteAnalyticsFilters, type SiteAnalyticsReport } from '@/lib/siteAnalytics';

/** Independent reporting credential; the provider also rechecks active Core membership. */
export async function readSiteAnalyticsReport(adminEmail: string, filters: SiteAnalyticsFilters): Promise<SiteAnalyticsReport> {
  const secret = process.env.SITE_ANALYTICS_ADMIN_SECRET ?? '';
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('site-analytics-unavailable');
  const response = await fetch('https://friending.com/site-metrics/report.php', {
    method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ ...filters, version: 1, admin_email: adminEmail }),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('site-analytics-unavailable');
  const text = await response.text();
  if (text.length > 1000000) throw new Error('site-analytics-unavailable');
  const report = parseSiteAnalyticsReport(JSON.parse(text));
  if (!report || report.days !== filters.days || report.page !== filters.page || report.focus !== filters.focus) throw new Error('site-analytics-unavailable');
  return report;
}
