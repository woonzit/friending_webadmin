import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import AdminMembershipUnavailable from '@/components/AdminMembershipUnavailable';
import { adminMe, AdminMembershipUnconfirmedError } from '@/lib/session';
import { readWoonzReport } from '@/lib/woonzServer';
import { woonzFilters, WOONZ_SOCIAL_PLATFORMS, type WoonzReport } from '@/lib/woonz';

export const dynamic = 'force-dynamic';
export default async function WoonzPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let me;
  try { me = await adminMe(); } catch (error) {
    if (error instanceof AdminMembershipUnconfirmedError) return <AdminMembershipUnavailable checkId={crypto.randomUUID()} />;
    throw error;
  }
  if (!me) redirect('/login');
  const filters = woonzFilters(await searchParams);
  const t = await getTranslations('woonz');
  const locale = await getLocale();
  let report: WoonzReport;
  try { report = await readWoonzReport(me.email, filters); } catch {
    return <div><header className="page-header"><h1>{t('title')}</h1></header><div className="alert alert-warning" role="alert">{t('unavailable')}</div><p><a className="button" href="/woonz">{t('refresh')}</a></p></div>;
  }
  const date = (timestamp: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(timestamp * 1000);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const countryNames = new Intl.DisplayNames([locale], { type: 'region' });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const pageviews = report.daily.reduce((sum, day) => sum + day.pageviews, 0);
  const starts = report.daily.reduce((sum, day) => sum + day.starts, 0);
  const signups = report.daily.reduce((sum, day) => sum + day.signups, 0);
  const today = report.daily.at(-1)!;
  const peak = Math.max(1, ...report.daily.map(day => day.pageviews));
  const pages = Math.max(1, Math.ceil(report.total / 25));
  const pageHref = (page: number) => `/woonz?days=${report.days}&status=${report.status}&page=${page}`;
  const cards = [
    ['views', pageviews, t('period', { days: report.days })], ['visitorsToday', today.visitors, t('visitorEstimate')],
    ['confirmed', report.counts.active, t('allTime')], ['pending', report.counts.pending, t('needsConfirmation')],
    ['starts', starts, t('period', { days: report.days })], ['signups', signups, t('includesPending')],
  ] as const;
  return <div className="woonz-console">
    <header className="page-header"><div className="page-header-copy"><h1>{t('title')}</h1><p className="page-subtitle">{t('subtitle')}</p></div><div className="page-actions"><a className="button button-secondary" href={pageHref(report.page)}>{t('refresh')}</a><a className="button" href="https://woonz.com" target="_blank" rel="noopener noreferrer">{t('openSite')} ↗</a></div></header>
    <p className="list-note">{t('trackingSince', { date: date(report.tracking_since) })}</p>
    <form className="filter-bar" action="/woonz" method="get"><label>{t('periodLabel')}<select name="days" defaultValue={String(report.days)}>{[7, 30, 90].map(days => <option key={days} value={days}>{t('period', { days })}</option>)}</select></label><label>{t('statusLabel')}<select name="status" defaultValue={report.status}>{['all', 'active', 'pending', 'unsubscribed'].map(status => <option key={status} value={status}>{t(`status.${status}`)}</option>)}</select></label><button className="button" type="submit">{t('apply')}</button></form>
    <section className="stat-grid woonz-stats" aria-label={t('statsLabel')}>{cards.map(([key, value, detail]) => <article className="stat-card" key={key}><span className="stat-label">{t(`cards.${key}`)}</span><strong className="stat-value">{number(value)}</strong><span className="stat-meta">{detail}</span></article>)}</section>
    <section className="panel" id="traffic"><div className="panel-header"><h2>{t('traffic')}</h2><span className="list-note">{t('utc')}</span></div><div className="panel-body"><svg className="woonz-chart" viewBox="0 0 900 180" role="img" aria-label={t('chartLabel')}><line x1="0" y1="160" x2="900" y2="160" stroke="currentColor" opacity=".2" />{report.daily.map((day, i) => <rect key={day.date} x={i * 900 / report.days + 2} y={160 - day.pageviews / peak * 150} width={Math.max(2, 900 / report.days - 4)} height={day.pageviews / peak * 150} rx="2" fill="#f1dc4f"><title>{day.date}: {number(day.pageviews)}</title></rect>)}</svg><div className="woonz-chart-axis"><span>{report.daily[0].date}</span><span>{today.date}</span></div><p className="list-note">{t('analyticsNote')}</p><details className="woonz-daily"><summary>{t('dailyTable')}</summary><div className="table-wrap"><table><thead><tr>{['day', 'views', 'visitors', 'starts', 'signups'].map(key => <th key={key}>{t(`daily.${key}`)}</th>)}</tr></thead><tbody>{[...report.daily].reverse().map(day => <tr key={day.date}><td>{day.date}</td><td>{number(day.pageviews)}</td><td>{number(day.visitors)}</td><td>{number(day.starts)}</td><td>{number(day.signups)}</td></tr>)}</tbody></table></div></details></div></section>
    <section className="panel" id="countries">
      <div className="panel-header"><h2>{t('countries')}</h2><span className="list-note">{t('countrySince', { date: date(report.country_tracking_since) })}</span></div>
      <div className="panel-body"><p className="list-note">{t('countryNote')}</p></div>
      {report.countries.length === 0 ? <div className="panel-body"><p className="list-note">{t('noTraffic')}</p></div> : <div className="table-wrap woonz-country-table"><table><thead><tr><th>{t('countryName')}</th><th>{t('daily.views')}</th><th>{t('countryShare')}</th></tr></thead><tbody>{report.countries.map(item => <tr key={item.code}><td>{item.code === 'ZZ' ? t('countryUnknown') : countryNames.of(item.code) || item.code}</td><td>{number(item.count)}</td><td>{percent.format(item.count / pageviews)}</td></tr>)}</tbody></table></div>}
      <div className="panel-body"><a className="list-note" href="https://db-ip.com" target="_blank" rel="noopener noreferrer">{t('countryAttribution')}</a></div>
    </section>
    <div className="woonz-breakdowns" id="sources">{(['sources', 'devices'] as const).map(kind => <section className="panel" key={kind}><div className="panel-header"><h2>{t(kind)}</h2></div><div className="panel-body">{report[kind].length === 0 ? <p className="list-note">{t('noTraffic')}</p> : <ul className="woonz-breakdown-list">{report[kind].map(item => <li key={item.label}><span>{kind === 'devices' ? t(`device.${item.label}`) : item.label === 'direct' ? t('direct') : item.label}</span><strong>{number(item.count)}</strong></li>)}</ul>}</div></section>)}</div>
    <section className="panel" id="subscribers"><div className="panel-header"><h2>{t('subscribers')}</h2><span className="list-note">{t('audience', { business: number(report.counts.business), creator: number(report.counts.creator), unsubscribed: number(report.counts.unsubscribed) })}</span></div><div className="panel-body"><p className="list-note">{t('deliveryNote')}</p>{!report.can_see_addresses ? <p className="list-note">{t('masked')}</p> : null}</div><div className="table-wrap"><table><thead><tr>{['email', 'role', 'location', 'profiles', 'status', 'joined', 'confirmation', 'welcome'].map(key => <th key={key}>{t(`table.${key}`)}</th>)}</tr></thead><tbody>{report.subscribers.length === 0 ? <tr><td colSpan={8}>{t('empty')}</td></tr> : report.subscribers.map(row => <tr key={row.id}><td><strong>{row.email}</strong>{row.name ? <small className="woonz-name">{row.name}</small> : null}</td><td>{t(`role.${row.role}`)}</td><td>{row.city || '—'}{row.country ? <small className="woonz-name">{countryNames.of(row.country) || row.country}</small> : null}</td><td>{WOONZ_SOCIAL_PLATFORMS.some(platform => row.social_profiles[platform]) ? <ul className="woonz-profile-links">{WOONZ_SOCIAL_PLATFORMS.filter(platform => row.social_profiles[platform]).map(platform => <li key={platform}><a href={row.social_profiles[platform]} target="_blank" rel="noopener noreferrer">{t(`platform.${platform}`)} ↗</a></li>)}</ul> : '—'}</td><td><span className={`woonz-status woonz-status-${row.status}`}>{t(`status.${row.status}`)}</span></td><td>{date(row.created_at)}</td><td>{t(`mail.${row.confirmation_mail}`)}</td><td>{t(`mail.${row.welcome_mail}`)}</td></tr>)}</tbody></table></div><div className="pagination"><span>{t('pagination', { page: report.page, pages, total: report.total })}</span><div>{report.page > 1 ? <Link prefetch={false} className="button button-secondary" href={pageHref(report.page - 1)}>{t('previous')}</Link> : null}{report.page < pages ? <Link prefetch={false} className="button button-secondary" href={pageHref(report.page + 1)}>{t('next')}</Link> : null}</div></div></section>
    <p className="list-note">{t('updated', { date: date(report.generated_at) })}</p>
  </div>;
}
