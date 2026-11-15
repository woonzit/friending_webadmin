import 'server-only';
import { parseWoonzReport, type WoonzFilters, type WoonzReport } from '@/lib/woonz';

/** The dedicated Woonz service owns its collections; both sides recheck Core admin membership. */
export async function readWoonzReport(adminEmail: string, filters: WoonzFilters): Promise<WoonzReport> {
  const secret = process.env.WOONZ_ADMIN_SECRET ?? '';
  if (!/^[a-f0-9]{64,}$/.test(secret)) throw new Error('woonz-unavailable');
  const response = await fetch('https://woonz.com/api/admin-report', {
    method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ ...filters, admin_email: adminEmail }),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('woonz-unavailable');
  const text = await response.text();
  if (text.length > 250000) throw new Error('woonz-unavailable');
  const report = parseWoonzReport(JSON.parse(text));
  if (!report || report.days !== filters.days || report.page !== filters.page || report.status !== filters.status) throw new Error('woonz-unavailable');
  return report;
}
