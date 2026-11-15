export type WoonzStatus = 'all' | 'pending' | 'active' | 'unsubscribed';
export type WoonzFilters = { days: 7 | 30 | 90; page: number; status: WoonzStatus };
export type WoonzReport = WoonzFilters & {
  ok: true; version: 1; generated_at: number; tracking_since: number; can_see_addresses: boolean; total: number;
  counts: { active: number; pending: number; unsubscribed: number; business: number; creator: number };
  daily: Array<{ date: string; pageviews: number; visitors: number; starts: number; signups: number }>;
  sources: Array<{ label: string; count: number }>; devices: Array<{ label: string; count: number }>;
  subscribers: Array<{ id: string; email: string; name: string; city: string; role: 'business' | 'creator'; status: Exclude<WoonzStatus, 'all'>; created_at: number; confirmed_at: number | null; confirmation_mail: string; welcome_mail: string }>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const string = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
export function woonzFilters(params: Record<string, string | string[] | undefined>): WoonzFilters {
  const days = params.days === '7' ? 7 : params.days === '90' ? 90 : 30;
  const page = typeof params.page === 'string' && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1;
  const status = ['pending', 'active', 'unsubscribed'].includes(String(params.status)) && typeof params.status === 'string' ? params.status as WoonzStatus : 'all';
  return { days, page, status };
}
export function parseWoonzReport(value: unknown): WoonzReport | null {
  if (!object(value) || !keys(value, ['ok', 'version', 'generated_at', 'tracking_since', 'can_see_addresses', 'days', 'page', 'status', 'total', 'counts', 'daily', 'sources', 'devices', 'subscribers'])
    || value.ok !== true || value.version !== 1 || !count(value.generated_at) || !count(value.tracking_since)
    || value.tracking_since > value.generated_at || typeof value.can_see_addresses !== 'boolean'
    || ![7, 30, 90].includes(Number(value.days)) || typeof value.days !== 'number'
    || !count(value.page) || value.page < 1 || value.page > 10000 || (!string(value.status, 20) || !['all', 'pending', 'active', 'unsubscribed'].includes(value.status))
    || !count(value.total) || !object(value.counts) || !keys(value.counts, ['active', 'pending', 'unsubscribed', 'business', 'creator'])
    || !Object.values(value.counts).every(count) || (value.counts.business as number) + (value.counts.creator as number) !== value.counts.active) return null;
  if (!Array.isArray(value.daily) || value.daily.length !== value.days) return null;
  for (let i = 0; i < value.daily.length; i++) {
    const day = value.daily[i];
    if (!object(day) || !keys(day, ['date', 'pageviews', 'visitors', 'starts', 'signups']) || !string(day.date, 10)
      || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || ![day.pageviews, day.visitors, day.starts, day.signups].every(count)
      || (day.visitors as number) > (day.pageviews as number)) return null;
    const timestamp = Date.parse(day.date);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day.date
      || (i > 0 && timestamp - Date.parse(value.daily[i - 1].date) !== 86400000)) return null;
  }
  for (const name of ['sources', 'devices'] as const) {
    const items = value[name];
    if (!Array.isArray(items) || items.length > 10 || items.some(item => !object(item) || !keys(item, ['label', 'count'])
      || !string(item.label, 253) || !count(item.count) || (name === 'devices' && !['mobile', 'desktop'].includes(item.label)))) return null;
  }
  const mailStates = ['queued', 'accepted', 'delivered', 'retry', 'failed', 'bounced', 'complained', 'superseded', 'unknown', 'not_queued', 'not_retained'];
  if (!Array.isArray(value.subscribers) || value.subscribers.length > 25 || new Set(value.subscribers.map(r => object(r) ? r.id : null)).size !== value.subscribers.length) return null;
  for (const row of value.subscribers) {
    if (!object(row) || !keys(row, ['id', 'email', 'name', 'city', 'role', 'status', 'created_at', 'confirmed_at', 'confirmation_mail', 'welcome_mail'])
      || !string(row.id, 24) || !/^[a-f0-9]{24}$/.test(row.id) || !string(row.email, 254) || !/^[^\s@]+@[^\s@]+$/.test(row.email)
      || !string(row.name, 200) || !string(row.city, 240) || (!string(row.role, 20) || !['business', 'creator'].includes(row.role))
      || (!string(row.status, 20) || !['pending', 'active', 'unsubscribed'].includes(row.status)) || !count(row.created_at)
      || (row.confirmed_at !== null && !count(row.confirmed_at)) || (!string(row.confirmation_mail, 30) || !mailStates.includes(row.confirmation_mail)) || (!string(row.welcome_mail, 30) || !mailStates.includes(row.welcome_mail))
      || (value.can_see_addresses === false && (!/^.\*\*\*@/.test(row.email) || row.name !== '' || row.city !== ''))) return null;
  }
  return value as unknown as WoonzReport;
}
