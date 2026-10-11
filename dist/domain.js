export const CATEGORIES = Object.freeze([
  { id: 'cat', label: '고양이', icon: 'cat', color: '#8266d4', defaultCycle: 30 },
  { id: 'dog', label: '강아지', icon: 'dog', color: '#df9852', defaultCycle: 30 },
  { id: 'clothes', label: '옷', icon: 'shirt', color: '#6698ce', defaultCycle: 0 },
  { id: 'life', label: '생활', icon: 'home', color: '#6aab91', defaultCycle: 30 },
  { id: 'other', label: '기타', icon: 'package', color: '#92939e', defaultCycle: 0 },
]);

const DAY = 86_400_000;
const CATEGORY_IDS = new Set(CATEGORIES.map(({ id }) => id));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateValue(value, label = '날짜') {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) throw new TypeError(`${label}는 YYYY-MM-DD 형식이어야 해요.`);
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) throw new TypeError(`${label}가 올바르지 않아요.`);
  return stamp;
}

export function todayISO() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function addDays(iso, amount) {
  if (!Number.isInteger(amount)) throw new TypeError('날짜 간격은 정수여야 해요.');
  return new Date(dateValue(iso) + amount * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((dateValue(to) - dateValue(from)) / DAY);
}

function shiftMonth(iso, amount) {
  const date = new Date(dateValue(iso));
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

function amountInWon(raw) {
  const cleaned = raw.replace(/[원₩,\s]/g, '');
  let total = 0;
  let tail = cleaned.replace(/(\d+(?:\.\d+)?)(만|천)/g, (_, n, unit) => {
    total += Number(n) * (unit === '만' ? 10000 : 1000);
    return '';
  });
  total += Number(tail || 0);
  return Math.round(total);
}

function guessCategory(text) {
  if (/고양이|냥이|냥냥|캣|츄르|차오|두부\s*모래|벤토나이트|스크래처/i.test(text)) return 'cat';
  if (/강아지|댕댕|반려견|퍼피|도그|배변\s*패드|개껌/i.test(text)) return 'dog';
  if (/티셔츠|셔츠|바지|청바지|니트|가디건|원피스|치마|재킷|자켓|코트|후드|맨투맨|양말|신발|운동화|속옷|잠옷|패딩|스웨터|옷/i.test(text)) return 'clothes';
  if (/휴지|세제|섬유\s*유연제|샴푸|린스|치약|칫솔|비누|바디\s*워시|키친\s*타월|키친\s*타올|물티슈|수세미|생수|커피|주방|생활/i.test(text)) return 'life';
  return 'other';
}

function guessCycle(text, category) {
  if (/장난감|스크래처|이동장|하우스|침대|방석|목줄|리드줄|하네스|식기|밥그릇|급식기|급수기|옷|케이지|캣타워|브러시|빗(?:\s|$)/i.test(text)) return 0;
  if ((category === 'cat' || category === 'dog') && /사료|간식|츄르|모래|배변\s*패드|개껌|덴탈\s*껌|영양제|유산균|샴푸|티슈/i.test(text)) return 30;
  if (category === 'life' && /휴지|세제|유연제|샴푸|린스|치약|비누|워시|타월|타올|물티슈|수세미|생수|커피/.test(text)) return 30;
  return 0;
}

/** A small, local Korean parser. All suggested fields remain editable in the UI. */
export function parseMemo(text, today = todayISO()) {
  dateValue(today);
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('구매 내용을 한 줄로 적어 주세요.');
  const original = text.trim();
  let rest = original;
  let date = today;
  let matchedDate;
  if ((matchedDate = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/))) {
    dateValue(matchedDate[1]);
    date = matchedDate[1];
  } else if ((matchedDate = rest.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/))) {
    date = `${matchedDate[1] || today.slice(0, 4)}-${matchedDate[2].padStart(2, '0')}-${matchedDate[3].padStart(2, '0')}`;
    dateValue(date);
  } else if ((matchedDate = rest.match(/그저께|그제|어제|오늘|지난\s*달|지난\s*주|\d+일\s*전/))) {
    const relative = matchedDate[0].replace(/\s/g, '');
    if (relative === '어제') date = addDays(today, -1);
    else if (relative === '그저께' || relative === '그제') date = addDays(today, -2);
    else if (relative === '지난달') date = shiftMonth(today, -1);
    else if (relative === '지난주') date = addDays(today, -7);
    else if (/^\d+일전$/.test(relative)) date = addDays(today, -Number.parseInt(relative, 10));
  }
  if (matchedDate) rest = rest.replace(matchedDate[0], ' ');

  const pricePattern = /(?:\d+(?:\.\d+)?\s*만\s*(?:\d+(?:\.\d+)?\s*천\s*)?(?:\d{1,4})?|\d+(?:\.\d+)?\s*천\s*(?:\d{1,3})?|\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*원|₩\s*\d[\d,]*(?:\.\d+)?/g;
  const prices = [...rest.matchAll(pricePattern)].map((match) => {
    const prefix = rest.slice(0, match.index).match(/(?:총(?:\s*금액|액)?|합계|합산|(?:1\s*)?(?:봉지|세트|박스|묶음|켤레|개|봉|팩|통|병|벌|장|포|캔)당)\s*$/)?.[0] || '';
    const end = match.index + match[0].length;
    const suffix = rest.slice(end).match(/^(?:짜리|씩|으로|이고|이며|에)(?=\s|$)/)?.[0] || '';
    return {
      amount: amountInWon(match[0]),
      start: match.index - prefix.length,
      end: end + suffix.length,
      total: /^(?:총|합계|합산)/.test(prefix),
      perUnit: /당\s*$/.test(prefix) || suffix === '씩',
    };
  });
  // An explicitly stated total wins over a unit price, including discounted totals.
  const selectedPrice = prices.find((item) => item.total) || prices[0];
  for (const item of [...prices].reverse()) rest = rest.slice(0, item.start) + ' ' + rest.slice(item.end);

  // A bare count is intentional; package weights remain part of the product name.
  const quantityMatch = rest.match(/(\d+(?:\.\d+)?\s*(?:봉지|세트|박스|묶음|켤레|개|봉|팩|통|병|벌|장|포|캔))(?:을|를|만|은|는|에)?(?![가-힣a-z])/i);
  const quantity = quantityMatch ? quantityMatch[1].replace(/\s/g, '') : '1개';
  if (quantityMatch) rest = rest.replace(quantityMatch[0], ' ');
  const quantityCount = quantityMatch ? Number.parseFloat(quantityMatch[1]) : 1;
  const price = selectedPrice ? Math.round(selectedPrice.amount * (selectedPrice.perUnit && !selectedPrice.total ? quantityCount : 1)) : 0;

  const shopMatch = rest.match(/([가-힣a-zA-Z0-9·._-]+)(?:에서|에선)/);
  const shop = shopMatch ? shopMatch[1] : '';
  if (shopMatch) rest = rest.replace(shopMatch[0], ' ');

  const cycleMatch = rest.match(/(\d+)일\s*(?:마다|주기|간격)/);
  if (cycleMatch) rest = rest.replace(cycleMatch[0], ' ');
  const category = guessCategory(original);
  const cycleDays = cycleMatch ? Number(cycleMatch[1]) : guessCycle(original, category);
  const name = rest
    .replace(/(?:구매|주문|결제)(?:\s*했(?:어요|어|다)|\s*완료|\s*함)?|샀(?:어요|어|다|음)|샀습니다|구입(?:했(?:어요|어|다)|함)?/g, ' ')
    .replace(/(?:총|합계)\s*(?=\s|$)/g, ' ')
    .replace(/^[\s,.:;!?~-]+|[\s,.:;!?~-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: name || '새 구매', category, price, quantity, date, cycleDays, shop, note: original };
}

function stringField(value, label, max, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new TypeError(`${label} 형식이나 길이를 확인해 주세요.`);
  return value.trim();
}

function integerField(value, label, max, fallback = 0) {
  const number = value == null ? fallback : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0 || number > max) throw new TypeError(`${label}는 0~${max.toLocaleString('ko-KR')} 사이의 정수여야 해요.`);
  return number;
}

export function normalizeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('구매 기록 형식이 올바르지 않아요.');
  const name = stringField(input.name, '상품명', 120);
  if (!name) throw new TypeError('상품명을 입력해 주세요.');
  const category = input.category ?? 'other';
  if (!CATEGORY_IDS.has(category)) throw new TypeError('구매 분류를 확인해 주세요.');
  const date = input.date ?? todayISO();
  dateValue(date, '구매일');
  const nextReminder = input.nextReminder ?? null;
  if (nextReminder !== null) dateValue(nextReminder, '다음 알림 날짜');
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) throw new TypeError('기록 생성 시간이 올바르지 않아요.');
  dateValue(createdAt.slice(0, 10), '기록 생성 날짜');
  const generatedId = () => globalThis.crypto?.randomUUID?.() ?? `purchase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const id = input.id == null ? generatedId() : stringField(input.id, '기록 ID', 120);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new TypeError('기록 ID가 올바르지 않아요.');
  return {
    id, name, category,
    price: integerField(input.price, '금액', 1_000_000_000),
    quantity: stringField(input.quantity, '수량', 40, '1개') || '1개',
    date,
    cycleDays: integerField(input.cycleDays, '재구매 주기', 3650),
    shop: stringField(input.shop, '구매처', 120),
    note: stringField(input.note, '메모', 2000),
    nextReminder,
    lastAction: input.lastAction == null ? null : stringField(input.lastAction, '알림 응답', 100),
    createdAt,
  };
}

function productKey(record) {
  return `${record.category}:${record.name.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]+/gu, '')}`;
}

/** The newest purchase supersedes the previous purchase and its reminder. */
export function getReminders(records, today = todayISO()) {
  dateValue(today);
  const latest = new Map();
  for (const record of records) {
    const key = productKey(record);
    const previous = latest.get(key);
    if (!previous || record.date > previous.date || (record.date === previous.date && (record.createdAt || '') >= (previous.createdAt || ''))) latest.set(key, record);
  }
  return [...latest.values()]
    .filter((record) => record.cycleDays > 0)
    .map((record) => {
      const dueDate = record.nextReminder || addDays(record.date, record.cycleDays);
      const daysLeft = daysBetween(today, dueDate);
      const status = daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'soon' : 'upcoming';
      return { ...record, dueDate, daysLeft, status };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'ko-KR'));
}

export function monthlyStats(records, month = todayISO().slice(0, 7)) {
  if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new TypeError('월은 YYYY-MM 형식이어야 해요.');
  const previousMonth = shiftMonth(`${month}-01`, -1).slice(0, 7);
  const byCategory = Object.fromEntries(CATEGORIES.map(({ id }) => [id, 0]));
  let total = 0;
  let count = 0;
  let previousTotal = 0;
  for (const record of records) {
    if (record.date.startsWith(month)) {
      total += record.price;
      count += 1;
      byCategory[CATEGORY_IDS.has(record.category) ? record.category : 'other'] += record.price;
    } else if (record.date.startsWith(previousMonth)) previousTotal += record.price;
  }
  return { total, count, byCategory, previousTotal, changePercent: previousTotal ? Math.round((total - previousTotal) / previousTotal * 100) : total ? null : 0 };
}

/** Relative sample data, explicitly marked as examples by the application. */
export function seedRecords(today = todayISO()) {
  dateValue(today);
  const samples = [
    { id: 'sample-churu', name: '고양이 츄르', category: 'cat', price: 18000, quantity: '3봉', age: 34, cycleDays: 30, shop: '쿠팡', note: '참치맛을 제일 좋아해요.' },
    { id: 'sample-dogfood', name: '강아지 사료', category: 'dog', price: 42000, quantity: '1봉', age: 25, cycleDays: 30, shop: '펫프렌즈', note: '늘 먹던 연어 사료 2kg' },
    { id: 'sample-shirt', name: '소프트 코튼 티셔츠', category: 'clothes', price: 29000, quantity: '1벌', age: 2, cycleDays: 0, shop: '무신사', note: '크림색 · M 사이즈' },
    { id: 'sample-litter', name: '고양이 두부모래', category: 'cat', price: 24900, quantity: '3봉', age: 5, cycleDays: 28, shop: '쿠팡', note: '무향으로 구매했어요.' },
    { id: 'sample-towel', name: '도톰한 키친타월', category: 'life', price: 12900, quantity: '1팩', age: 0, cycleDays: 45, shop: '마켓컬리', note: '' },
    { id: 'sample-treat', name: '강아지 오리 간식', category: 'dog', price: 8900, quantity: '2봉', age: 3, cycleDays: 21, shop: '동네 펫숍', note: '' },
    { id: 'sample-socks', name: '데일리 양말', category: 'clothes', price: 15000, quantity: '5켤레', age: 39, cycleDays: 0, shop: '무신사', note: '' },
    { id: 'sample-detergent', name: '액체 세탁세제', category: 'life', price: 16900, quantity: '1통', age: 38, cycleDays: 60, shop: '이마트', note: '' },
  ];
  return samples.map(({ age, ...sample }) => normalizeRecord({ ...sample, date: addDays(today, -age), createdAt: `${addDays(today, -age)}T09:00:00.000Z` }));
}
