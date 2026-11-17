import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWoonzReport, woonzFilters, validWoonzSocialUrl } from '../lib/woonz.ts';
const fixture = () => ({
  ok: true, version: 3, generated_at: 1800000000, tracking_since: 1799999000, country_tracking_since: 1799999500, can_see_addresses: true,
  days: 7, page: 1, status: 'all', total: 1,
  counts: { active: 1, pending: 0, unsubscribed: 0, business: 0, creator: 1 },
  daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(9+i).padStart(2,'0')}`, pageviews: 5, visitors: 3, starts: 1, signups: 1 })),
  sources: [{ label: 'direct', count: 35 }], devices: [{ label: 'mobile', count: 35 }],
  countries: [{ code: 'HU', count: 20 }, { code: 'US', count: 10 }, { code: 'ZZ', count: 5 }],
  subscribers: [{ id: 'a'.repeat(24), email: 'test@example.test', name: 'Test', city: 'Brooklyn', country: 'US', social_profiles: {tiktok:'https://tiktok.com/@neighbor',instagram:'',youtube:'https://youtube.com/@%C3%A1rv%C3%ADz',twitch:''}, role: 'creator', status: 'active', created_at: 1799999500, confirmed_at: 1799999600, confirmation_mail: 'delivered', welcome_mail: 'accepted' }],
});
test('Woonz accepts a complete report and preserves values', () => assert.deepEqual(parseWoonzReport(fixture()), fixture()));
test('Woonz rejects malformed, partial, and loosely typed reports', () => {
  const base = fixture();
  for (const value of [null, {}, [], {...base, secret: 'must not cross'}, {...base, ok: false}, {...base, days: '7'}, {...base, status:['all']}, {...base, counts:{...base.counts, active:2}}, {...base, daily:base.daily.slice(1)}, {...base, total:'1'}, {...base, subscribers:[{...base.subscribers[0], confirmation_mail:['delivered']}]}, {...base, devices:[{label:'unknown',count:1}]}]) assert.equal(parseWoonzReport(value), null);
});
test('Woonz refuses unmasked viewer data and accepts a masked report', () => {
  const base = fixture(); base.can_see_addresses = false;
  assert.equal(parseWoonzReport(base), null);
  base.subscribers[0] = {...base.subscribers[0], email:'t***@example.test', name:'', city:'', country:'', social_profiles:{tiktok:'',instagram:'',youtube:'',twitch:''}};
  assert.ok(parseWoonzReport(base));
});
test('Woonz filters keep bounded, typed values and ignore actor input', () => {
  assert.deepEqual(woonzFilters({days:'7',page:'2',status:'pending',admin_email:'intruder@example.test'}), {days:7,page:2,status:'pending'});
  assert.deepEqual(woonzFilters({days:['90'],page:'-1',status:['active']}), {days:30,page:1,status:'all'});
});
test('Woonz countries reject incomplete, duplicated or inconsistent totals', () => {
  const base = fixture();
  for (const countries of [undefined, [], [{code:'HU',count:34}], [{code:'hu',count:35}], [{code:'HUN',count:35}], [{code:'HU',count:'35'}], [{code:'HU',count:35,ip:'private'}], [{code:'HU',count:20},{code:'HU',count:15}], [{code:'HU',count:35},{code:'US',count:0}]]) {
    assert.equal(parseWoonzReport({...base,countries}), null);
  }
  for (const country_tracking_since of ['1799999500', 1799990000, 1800000001]) assert.equal(parseWoonzReport({...base,country_tracking_since}),null);
  assert.equal(parseWoonzReport({...base, version:1}),null);
  assert.ok(parseWoonzReport({...base,countries:[{code:'ZZ',count:35}]}));
  assert.ok(parseWoonzReport({...base,countries:[],daily:base.daily.map(day=>({...day,pageviews:0,visitors:0}))}));
});

test('Woonz optional profiles reject unsafe links, partial fields and viewer disclosure', () => {
  const base=fixture();
  for (const bad of ['javascript:alert(1)', 'https://tiktok.com.evil.test/@name', 'https://evil.test/@name', 'https://name@tiktok.com/@name', 'https://tiktok.com/@name?tracking=yes', 'https://tiktok.com/@name#secret', 'http://tiktok.com/@name', 'https://tiktok.com/@%2F%2Fevil.test', 'https://tiktok.com/@%ZZ']) {
    assert.equal(parseWoonzReport({...base,subscribers:[{...base.subscribers[0],social_profiles:{...base.subscribers[0].social_profiles,tiktok:bad}}]}),null);
  }
  for (const country of ['us','XX','USA',null]) assert.equal(parseWoonzReport({...base,subscribers:[{...base.subscribers[0],country}]}),null);
  assert.equal(parseWoonzReport({...base,version:2}),null);
  assert.equal(parseWoonzReport({...base,subscribers:[{...base.subscribers[0],social_profiles:{tiktok:''}}]}),null);
  assert.equal(parseWoonzReport({...base,can_see_addresses:false,subscribers:[{...base.subscribers[0],email:'t***@example.test',name:'',city:''}]}),null);
  assert.ok(validWoonzSocialUrl('https://youtube.com/channel/UC_example','youtube'));
  assert.ok(validWoonzSocialUrl('https://twitch.tv/local_creator','twitch'));
  assert.equal(validWoonzSocialUrl('https://youtube.com/watch?v=123','youtube'),false);
});
