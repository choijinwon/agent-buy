import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, parseMemo, normalizeRecord, getReminders, monthlyStats, seedRecords, todayISO } from '../dist/domain.js';

const TODAY = '2026-10-11';
const record = (changes = {}) => normalizeRecord({ id: 'test-item', name: '고양이 츄르', category: 'cat', price: 18000, quantity: '3봉', date: '2026-09-07', cycleDays: 30, createdAt: '2026-09-07T09:00:00.000Z', ...changes });

test('Korean memo separates product, price, package count, date and shop', () => {
  const parsed = parseMemo('어제 쿠팡에서 고양이 츄르 3봉 18,000원 샀어', TODAY);
  assert.equal(parsed.name, '고양이 츄르');
  assert.equal(parsed.category, 'cat');
  assert.equal(parsed.price, 18000);
  assert.equal(parsed.quantity, '3봉');
  assert.equal(parsed.date, '2026-10-10');
  assert.equal(parsed.shop, '쿠팡');
  assert.equal(parsed.cycleDays, 30);
});

test('Korean money units and decimals produce total won without becoming quantity', () => {
  for (const amount of ['18,000원', '1만 8천원', '1만 8000원', '1.8만원', '₩18,000']) {
    const result = parseMemo(`고양이 간식 ${amount} 구매`, TODAY);
    assert.equal(result.price, 18000, amount);
    assert.equal(result.quantity, '1개', amount);
    assert.equal(result.name, '고양이 간식', amount);
  }
  assert.equal(parseMemo('강아지 간식 1만 8천 500원', TODAY).price, 18500);
  const particles = parseMemo('고양이 츄르 3봉을 18000원에 샀어', TODAY);
  assert.equal(particles.quantity, '3봉');
  assert.equal(particles.name, '고양이 츄르');
});

test('common purchase particles retain the package count and clean product name', () => {
  for (const text of ['고양이 간식 3봉에 1만 8000원 샀어', '어제 고양이 간식 3봉을 18,000원에 구매했어요']) {
    const result = parseMemo(text, TODAY);
    assert.equal(result.name, '고양이 간식');
    assert.equal(result.quantity, '3봉');
    assert.equal(result.price, 18000);
  }
});

test('unit prices multiply by the purchased count', () => {
  for (const text of ['고양이 츄르 개당 6000원 3봉 샀어', '고양이 츄르 3봉 봉당 6천원에 샀어', '고양이 츄르 6000원씩 3봉 샀어']) {
    const result = parseMemo(text, TODAY);
    assert.equal(result.name, '고양이 츄르', text);
    assert.equal(result.quantity, '3봉', text);
    assert.equal(result.price, 18000, text);
  }
  const socks = parseMemo('양말 개당 3000원 5켤레 샀어', TODAY);
  assert.equal(socks.price, 15000);
  assert.equal(socks.quantity, '5켤레');
  assert.equal(parseMemo('고양이 간식 봉당 6000원 샀어', TODAY).price, 6000);
});

test('an explicit total takes precedence over unit prices without multiplying twice', () => {
  for (const text of ['고양이 츄르 개당 6000원 3봉 총 18000원 샀어', '고양이 츄르 총 18000원 봉당 6000원 3봉 샀어', '고양이 츄르 3봉 개당 7000원 총 18000원에 샀어', '고양이 츄르 봉당 6000원 3봉 합계 18000원']) {
    const result = parseMemo(text, TODAY);
    assert.equal(result.price, 18000, text);
    assert.equal(result.quantity, '3봉', text);
    assert.equal(result.name, '고양이 츄르', text);
  }
  assert.equal(parseMemo('고양이 츄르 3봉 총 18000원 샀어', TODAY).price, 18000);
});

test('relative months clamp to actual calendar days, including leap years', () => {
  assert.equal(parseMemo('지난달 휴지 1팩 8900원', '2026-03-31').date, '2026-02-28');
  assert.equal(parseMemo('지난달 휴지 1팩', '2024-03-31').date, '2024-02-29');
  assert.equal(parseMemo('9월 11일 강아지 사료 42000원', TODAY).date, '2026-09-11');
  assert.equal(parseMemo('2025-12-31 티셔츠 29000원', TODAY).date, '2025-12-31');
  assert.throws(() => parseMemo('2월 30일 휴지', TODAY), /올바르지/);
});

test('reminders apply to consumables and explicit intervals, not durable pet products or clothes', () => {
  assert.equal(parseMemo('강아지 사료 1봉 3만원', TODAY).cycleDays, 30);
  assert.equal(parseMemo('고양이 장난감 1개 5000원', TODAY).cycleDays, 0);
  assert.equal(parseMemo('강아지 하네스 1개 29000원', TODAY).cycleDays, 0);
  assert.equal(parseMemo('고양이 가방 1개 29000원', TODAY).cycleDays, 0);
  assert.equal(parseMemo('티셔츠 1벌 29000원', TODAY).category, 'clothes');
  assert.equal(parseMemo('티셔츠 1벌 29000원', TODAY).cycleDays, 0);
  assert.equal(parseMemo('고양이 간식 3봉 14일마다 18000원', TODAY).cycleDays, 14);
});

test('date arithmetic is calendar-based over year and leap-day boundaries', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2026-09-30', '2026-10-02'), 2);
  assert.throws(() => addDays('2026-02-30', 1), /올바르지/);
});

test('import validation rejects malformed dates, unexpected field types and unsafe numbers', () => {
  for (const invalid of [null, [], { name: '' }, { name: 12 }, { name: '츄르', price: '1000' }, { name: '츄르', price: -1 }, { name: '츄르', price: Infinity }, { name: '츄르', cycleDays: 1.5 }, { name: '츄르', category: '__proto__' }, { name: '츄르', date: '2026-02-30' }, { name: '츄르', nextReminder: 'tomorrow' }, { name: '츄르', id: '<script>' }]) assert.throws(() => normalizeRecord(invalid));
  const safe = normalizeRecord({ name: '  츄르  ', price: 1000, unexpected: 'discarded' });
  assert.equal(safe.name, '츄르');
  assert.equal(safe.category, 'other');
  assert.equal(safe.unexpected, undefined);
  assert.ok(safe.id);
});

test('a repurchase replaces an old reminder even when the newer purchase disables reminders', () => {
  const old = record();
  const newer = record({ id: 'new', name: '고양이  츄르', date: TODAY, createdAt: `${TODAY}T09:00:00.000Z` });
  const reminders = getReminders([old, newer], TODAY);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].id, 'new');
  assert.equal(reminders[0].daysLeft, 30);
  assert.deepEqual(getReminders([old, { ...newer, cycleDays: 0 }], TODAY), []);
});

test('reminders honor snooze, categorize due today, and sort by urgency', () => {
  const overdue = record();
  const due = record({ id: 'dog', category: 'dog', name: '강아지 사료', date: '2026-09-11' });
  const snoozed = record({ id: 'litter', name: '두부모래', nextReminder: '2026-10-18' });
  const reminders = getReminders([snoozed, due, overdue], TODAY);
  assert.deepEqual(reminders.map(({ id, daysLeft, status }) => ({ id, daysLeft, status })), [
    { id: 'test-item', daysLeft: -4, status: 'overdue' },
    { id: 'dog', daysLeft: 0, status: 'soon' },
    { id: 'litter', daysLeft: 7, status: 'soon' },
  ]);
});

test('monthly aggregation uses previous calendar month and handles missing baselines', () => {
  const records = [record({ date: '2026-12-31', price: 10000 }), record({ id: 'new', date: '2027-01-01', price: 15000 }), record({ id: 'shirt', category: 'clothes', date: '2027-01-05', price: 5000 })];
  const stats = monthlyStats(records, '2027-01');
  assert.deepEqual(stats, { total: 20000, count: 2, byCategory: { cat: 15000, dog: 0, clothes: 5000, life: 0, other: 0 }, previousTotal: 10000, changePercent: 100 });
  assert.equal(monthlyStats([], '2027-01').changePercent, 0);
  assert.equal(monthlyStats([records[1]], '2027-01').changePercent, null);
  assert.throws(() => monthlyStats(records, '2027-13'));
});

test('sample data is valid and keeps both an overdue cat item and soon-due dog item', () => {
  const samples = seedRecords(TODAY);
  assert.equal(samples.length, 8);
  samples.forEach((sample) => assert.deepEqual(normalizeRecord(sample), sample));
  const reminders = getReminders(samples, TODAY);
  assert.equal(reminders.find(({ id }) => id === 'sample-churu').status, 'overdue');
  assert.equal(reminders.find(({ id }) => id === 'sample-dogfood').status, 'soon');
  assert.equal(reminders.some(({ category }) => category === 'clothes'), false);
});
