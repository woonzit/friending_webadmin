export type SiteAnalyticsFilters = { days: 7 | 30 | 90; page: number; focus: 'all' | 'go' };
export type SiteAnalyticsStep = { at: number; kind: 'pageview' | 'click'; page: string; target: string; placement: '' | 'header' | 'content' | 'footer' };
export type SiteAnalyticsReport = SiteAnalyticsFilters & {
  ok: true; version: 1; generated_at: number; tracking_since: number;
  totals: { views: number; clicks: number; visits: number; go_visits: number; home_visits: number; home_go_clicks: number; home_go_arrivals: number };
  daily: Array<{ date: string; views: number; visits: number }>;
  countries: Array<{ label: string; count: number }>; devices: Array<{ label: 'mobile' | 'desktop'; count: number }>; sources: Array<{ label: string; count: number }>;
  pages: Array<{ path: string; title: string; views: number; visits: number }>;
  links: Array<{ page: string; target: string; placement: 'header' | 'content' | 'footer'; clicks: number; visits: number }>;
  journey_total: number;
  journeys: Array<{ id: string; started_at: number; ended_at: number; country: string; device: 'mobile' | 'desktop'; views: number; clicks: number; go_clicked: boolean; go_visited: boolean; truncated: boolean; steps: SiteAnalyticsStep[] }>;
};
export function siteAnalyticsFilters(params: Record<string, string | string[] | undefined>): SiteAnalyticsFilters {
  return { days: params.days === '7' ? 7 : params.days === '90' ? 90 : 30,
    page: typeof params.page === 'string' && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1,
    focus: params.focus === 'go' ? 'go' : 'all' };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const path = (v: unknown): v is string => str(v, 200) && /^\/(?:[a-z0-9][a-z0-9-]*\/)*$/.test(v)
  && !/^\/(?:wp-|site-metrics|cart\/|checkout\/|my-account\/|author\/|app\/|api\/|search\/|go\/unsubscribe\/)/.test(v);
const target = (v: unknown): v is string => {
  if (!str(v, 220)) return false;
  if (['outbound:app-store', 'outbound:google-play', 'outbound:shop'].includes(v)) return true;
  const parts = v.split('#');
  return path(parts[0]) && (parts.length === 1 || (parts.length === 2 && ['people', 'areyouin', 'how-it-works', 'download', 'preorder', 'reserve', 'safety', 'watch', 'film', 'faq', 'modes', 'the-cat', 'in-the-box'].includes(parts[1])));
};
const placement = (v: unknown) => typeof v === 'string' && ['header', 'content', 'footer'].includes(v);
const country = (v: unknown): v is string => str(v, 2) && /^[A-Z]{2}$/.test(v);
const device = (v: unknown) => v === 'mobile' || v === 'desktop';
const source = (v: unknown): v is string => str(v, 253) && (v === 'direct' || /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(v));

/** Closed, bounded projection: a provider failure never becomes an empty report. */
export function parseSiteAnalyticsReport(value: unknown): SiteAnalyticsReport | null {
  if (!object(value) || !keys(value, ['ok', 'version', 'generated_at', 'tracking_since', 'days', 'page', 'focus', 'totals', 'daily', 'countries', 'devices', 'sources', 'pages', 'links', 'journey_total', 'journeys'])
    || value.ok !== true || value.version !== 1 || !count(value.generated_at) || value.generated_at > 4102444800 || !count(value.tracking_since) || value.tracking_since > value.generated_at
    || (value.days !== 7 && value.days !== 30 && value.days !== 90) || !count(value.page) || value.page < 1 || value.page > 10000 || !['all', 'go'].includes(String(value.focus)) || typeof value.focus !== 'string'
    || !object(value.totals) || !keys(value.totals, ['views', 'clicks', 'visits', 'go_visits', 'home_visits', 'home_go_clicks', 'home_go_arrivals']) || !Object.values(value.totals).every(count)) return null;
  const totals = value.totals as SiteAnalyticsReport['totals'];
  if (totals.visits > totals.views || totals.go_visits > totals.visits || totals.home_visits > totals.visits || totals.home_go_clicks > totals.home_visits || totals.home_go_arrivals > totals.home_go_clicks || totals.home_go_arrivals > totals.go_visits || totals.home_go_clicks > totals.clicks) return null;
  if (!Array.isArray(value.daily) || value.daily.length !== value.days) return null;
  let views = 0;
  for (let i = 0; i < value.daily.length; i++) {
    const day = value.daily[i];
    if (!object(day) || !keys(day, ['date', 'views', 'visits']) || !str(day.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !count(day.views) || !count(day.visits) || day.visits > day.views) return null;
    const timestamp = Date.parse(day.date);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day.date || (i > 0 && timestamp - Date.parse(value.daily[i - 1].date) !== 86400000)) return null;
    views += day.views;
  }
  if (views !== totals.views || value.daily.at(-1).date !== new Date(value.generated_at * 1000).toISOString().slice(0, 10)) return null;
  for (const name of ['countries', 'devices', 'sources'] as const) {
    const rows = value[name];
    if (!Array.isArray(rows) || rows.length > ({ countries: 300, devices: 2, sources: 20 }[name]) || rows.some(row => !object(row) || !keys(row, ['label', 'count']) || !count(row.count) || row.count < 1 || !({ countries: country, devices: device, sources: source }[name])(row.label)) || new Set(rows.map(row => row.label)).size !== rows.length) return null;
    const sum = rows.reduce((n, row) => n + row.count, 0);
    if (name === 'sources' ? sum > views : sum !== views) return null;
  }
  if (!Array.isArray(value.pages) || value.pages.length > 100 || new Set(value.pages.map(row => object(row) ? row.path : null)).size !== value.pages.length) return null;
  for (const row of value.pages) if (!object(row) || !keys(row, ['path', 'title', 'views', 'visits']) || !path(row.path) || !str(row.title, 240) || !count(row.views) || !count(row.visits) || row.visits < 1 || row.visits > row.views || row.views > views) return null;
  if (value.pages.reduce((n, row) => n + row.views, 0) > views) return null;
  if (!Array.isArray(value.links) || value.links.length > 100) return null;
  const linkKeys = new Set<string>();
  for (const row of value.links) {
    if (!object(row) || !keys(row, ['page', 'target', 'placement', 'clicks', 'visits']) || !path(row.page) || !target(row.target) || !placement(row.placement) || !count(row.clicks) || !count(row.visits) || row.visits < 1 || row.visits > row.clicks) return null;
    const key = `${row.page}|${row.target}|${row.placement}`;
    if (linkKeys.has(key)) return null;
    linkKeys.add(key);
  }
  if (value.links.reduce((n, row) => n + row.clicks, 0) > totals.clicks || !count(value.journey_total) || !Array.isArray(value.journeys) || value.journeys.length > 20 || value.journeys.length > value.journey_total || new Set(value.journeys.map(row => object(row) ? row.id : null)).size !== value.journeys.length) return null;
  for (const row of value.journeys) {
    if (!object(row) || !keys(row, ['id', 'started_at', 'ended_at', 'country', 'device', 'views', 'clicks', 'go_clicked', 'go_visited', 'truncated', 'steps']) || !str(row.id, 16) || !/^[a-f0-9]{16}$/.test(row.id)
      || !count(row.started_at) || !count(row.ended_at) || row.started_at > row.ended_at || row.ended_at > value.generated_at || !country(row.country) || !device(row.device) || !count(row.views) || row.views < 1 || !count(row.clicks)
      || typeof row.go_clicked !== 'boolean' || typeof row.go_visited !== 'boolean' || typeof row.truncated !== 'boolean' || !Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 40 || (value.focus === 'go' && !row.go_clicked && !row.go_visited)) return null;
    for (const step of row.steps) {
      if (!object(step) || !keys(step, ['at', 'kind', 'page', 'target', 'placement']) || !count(step.at) || step.at < row.started_at || step.at > row.ended_at || !path(step.page)) return null;
      if (step.kind === 'pageview') { if (step.target !== '' || step.placement !== '') return null; }
      else if (step.kind !== 'click' || !target(step.target) || !placement(step.placement)) return null;
    }
  }
  return value as unknown as SiteAnalyticsReport;
}
