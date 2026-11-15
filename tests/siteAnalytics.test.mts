import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSiteAnalyticsReport, siteAnalyticsFilters } from '../lib/siteAnalytics.ts';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/site-analytics-report.json', import.meta.url), 'utf8'));

test('site analytics accepts the isolated PHP provider capture including out-of-order delivery and truncated paths', () => {
  const report = fixture();
  assert.deepEqual(parseSiteAnalyticsReport(report), report);
  assert.equal(report.totals.home_go_clicks, 2);
  assert.equal(report.totals.home_go_arrivals, 1);
  assert.ok(report.journeys.some((row: { truncated: boolean }) => row.truncated));
});
test('site analytics rejects unknown fields, loose types and private URL material', () => {
  const base = fixture();
  for (const value of [null, {}, [], {...base, token:'private'}, {...base, ok:false}, {...base, version:2}, {...base, days:'7'}, {...base, focus:['all']}, {...base, generated_at:Number.MAX_SAFE_INTEGER}, {...base, countries:[{label:'hu',count:base.totals.views}]}, {...base, pages:[{...base.pages[0],path:'/go/?email=secret'}]}, {...base, links:[{...base.links[0],target:'javascript:alert(1)'}]}, {...base, links:[{...base.links[0],target:'/go/#email-secret'}]}, {...base, journeys:[{...base.journeys[0],email:'private@example.test'}]}, {...base, journeys:[{...base.journeys[0],steps:[{...base.journeys[0].steps[0],page:'/wp-admin/'}]}]}]) assert.equal(parseSiteAnalyticsReport(value), null);
});
test('site analytics requires reconciled totals, unique breakdowns and a possible funnel', () => {
  const base = fixture();
  for (const value of [{...base,countries:[]}, {...base,devices:[...base.devices,base.devices[0]]}, {...base,daily:base.daily.slice(1)}, {...base,totals:{...base.totals,views:base.totals.views+1}}, {...base,totals:{...base.totals,home_go_arrivals:3}}, {...base,pages:[base.pages[0],base.pages[0]]}, {...base,links:[base.links[0],base.links[0]]}, {...base,journeys:[base.journeys[0],base.journeys[0]]}]) assert.equal(parseSiteAnalyticsReport(value),null);
});
test('site analytics admits a measured empty report, not an absent response', () => {
  const base = fixture();
  const empty = {...base,totals:Object.fromEntries(Object.keys(base.totals).map(key=>[key,0])),daily:base.daily.map((day: { date: string })=>({date:day.date,views:0,visits:0})),countries:[],devices:[],sources:[],pages:[],links:[],journey_total:0,journeys:[]};
  assert.deepEqual(parseSiteAnalyticsReport(empty),empty);
});
test('site analytics query filters are bounded and never accept a browser actor', () => {
  assert.deepEqual(siteAnalyticsFilters({days:'7',page:'2',focus:'go',admin_email:'intruder@example.test'}),{days:7,page:2,focus:'go'});
  assert.deepEqual(siteAnalyticsFilters({days:['90'],page:'100000',focus:['go']}),{days:30,page:1,focus:'all'});
});
