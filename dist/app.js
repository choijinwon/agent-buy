import { CATEGORIES, todayISO, addDays, parseMemo, normalizeRecord, getReminders, monthlyStats, seedRecords } from './domain.js';

const KEY = 'mwo-satji.records.v1';
const $ = (q, root = document) => root.querySelector(q);
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('ko-KR');
const category = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
const monthName = m => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월`;
const shortDate = d => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const paths = {
  bag: '<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M9 13h.01M15 13h.01M10 16c1.2.7 2.8.7 4 0"/>',
  home: '<path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/>',
  receipt: '<path d="M6 3 9 5l3-2 3 2 3-2v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 9h6M9 13h6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15v-7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  cat: '<path d="m4 11 1-7 6 4h2l6-4 1 7c2 12-18 12-16 0Z"/><path d="M8 12h.01M16 12h.01m-5 3 1 1 1-1M2 15h4M18 15h4M3 18l4-1m10 0 4 1"/>',
  dog: '<path d="M7 8c2-4 8-4 10 0l1 8c-1 6-11 6-12 0l1-8Z"/><path d="M7 7 4 5 2 13l4 1m11-7 3-2 2 8-4 1M9 12h.01M15 12h.01m-4 4 1 1 1-1"/>',
  clothes: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c0 5-8 5-8 0Z"/>',
  life: '<path d="M7 8h10v13H7V8ZM9 8V4h6v4M9 4V2h8M10 13h4"/>',
  other: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m10 2-.6 3-2.1 1.2-2.9-.9-2 3.4L4.7 11v2l-2.3 2.3 2 3.4 2.9-.9L9.4 19l.6 3h4l.6-3 2.1-1.2 2.9.9 2-3.4-2.3-2.3v-2l2.3-2.3-2-3.4-2.9.9L14.6 5 14 2h-4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5M17 3v5M3 11h18M7 15h3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
  leaf: '<path d="M20 3C8 1 1 8 6 17c9 5 17-2 14-14ZM4 21 15 10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.other}</svg>`; }
function catIcon(id, cls = '') { return `<span class="category-icon ${esc(id)} ${cls}">${icon(id)}</span>`; }
const state = { view: 'dashboard', records: [], demo: true, filter: 'all', query: '', month: todayISO().slice(0, 7), reminderFilter: 'all' };
let storageError = '';
let deferredInstall = null;
let quickDraft = '';
let toastTimer;
try {
  const raw = localStorage.getItem(KEY);
  if (raw !== null) {
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.records)) throw new Error('저장 형식이 올바르지 않아요.');
    state.records = saved.records.map(normalizeRecord);
    state.demo = false;
  } else state.records = seedRecords();
} catch (e) { storageError = '기록을 불러오지 못했어요. 브라우저 저장 공간을 확인해 주세요.'; state.records = []; state.demo = false; }

function notify(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}
function persist(records) {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, records })); }
  catch { notify('저장하지 못했어요. 브라우저 저장 공간을 확인하고 다시 시도해 주세요.'); return false; }
  state.records = records; state.demo = false; storageError = ''; return true;
}
function changeView(view, filter = 'all') {
  quickDraft = $('#quick-note')?.value || quickDraft;
  state.view = view; state.filter = filter; state.query = ''; render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#page-title')?.focus({ preventScroll: true });
}
const navigation = [ ['dashboard', 'home', '홈'], ['records', 'receipt', '구매 기록'], ['reminders', 'bell', '재구매 알림'], ['report', 'chart', '월별 리포트'] ];
function nav(mobile = false) {
  const count = getReminders(state.records).filter(r => r.daysLeft <= 3).length;
  return navigation.map(([view, ico, label]) => `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(ico)}<span>${label}</span>${view === 'reminders' && count ? `<span class="nav-count">${count}</span>` : ''}</button>`).join('');
}
function render() {
  const title = navigation.find(n => n[0] === state.view)[2];
  $('#app').innerHTML = `<aside class="sidebar">
    <a class="brand" href="#" data-view="dashboard"><span class="brand-symbol">${icon('bag')}</span><span>뭐샀지<span class="brand-dot">.</span></span></a>
    <div class="brand-caption">나를 위한 구매 기억</div>
    <div class="nav-label">MY LITTLE MEMORY</div><nav aria-label="주 메뉴">${nav()}</nav>
    <div class="sidebar-bottom"><div class="little-note">${icon('leaf')}<p>작은 기록이 모여<br><strong>가벼운 일상이 돼요.</strong></p><span>오늘의 소비도 기억해둘게요.</span></div>
    <button class="nav-item" data-action="settings">${icon('settings')}<span>설정 및 데이터</span></button>
    <div class="local-status"><span></span>이 브라우저에 안전하게 보관 중</div></div>
  </aside>
  <div class="app-body"><header class="topbar"><span class="breadcrumb">내 일상 <span>/</span> <strong>${title}</strong></span><a href="#" class="brand mobile-brand" data-view="dashboard"><span class="brand-symbol">${icon('bag')}</span>뭐샀지.</a><div class="top-actions"><button class="icon-button" data-action="search" aria-label="구매 기록 검색">${icon('search')}</button><span class="top-divider"></span><span class="today-date">${icon('calendar')}${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' })}</span><button class="avatar" data-action="settings" aria-label="설정 열기">나</button></div></header>
  <main id="main" class="main-content">${storageError ? `<div class="error-banner" role="alert">${esc(storageError)}</div>` : ''}
  ${state.demo ? `<div class="demo-banner"><span><span class="demo-tag">둘러보기</span>예시 기록으로 뭐샀지를 먼저 만나보세요.</span><button data-action="start">내 기록 시작하기 ${icon('arrow')}</button></div>` : ''}
  ${state.view === 'dashboard' ? dashboard() : state.view === 'records' ? recordsView() : state.view === 'reminders' ? remindersView() : reportView()}
  <footer class="page-footer"><span>덜 기억해도 괜찮아요. 뭐샀지가 있으니까.</span><span>MADE FOR YOUR EVERYDAY</span></footer>
  </main></div><nav class="mobile-nav" aria-label="모바일 메뉴">${nav(true)}</nav>`;
}
function pageHeading(eyebrow, title, subtitle, action = true) {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1 id="page-title" tabindex="-1">${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action ? `<button class="primary-button heading-add" data-action="new">${icon('plus')}구매 기록하기</button>` : ''}</div>`;
}
function dashboard() {
  const stats = monthlyStats(state.records, todayISO().slice(0, 7));
  const reminders = getReminders(state.records);
  const urgent = reminders.find(r => r.daysLeft <= 3);
  const recent = [...state.records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const currentMonth = Number(todayISO().slice(5, 7));
  return `${pageHeading('A LITTLE NOTE, A LIGHTER DAY', '오늘도, 잘 기억해둘게요<span class="heading-spark">✳</span>', '무엇을 샀는지, 언제 다시 필요한지. 가볍게 적고 잊어버리세요.')}
  <div class="dashboard-grid"><div class="main-column"><section class="quick-card" aria-labelledby="quick-title"><div class="quick-content"><div class="section-kicker">${icon('spark')} 나의 구매 기억 도우미</div><h2 id="quick-title">오늘은 뭘 샀나요?</h2><p>말하듯 적어주세요. 깔끔하게 정리해둘게요.</p><form id="quick-form"><label class="sr-only" for="quick-note">구매 메모</label><textarea id="quick-note" maxlength="1000" placeholder="고양이 간식 3봉 샀어, 18,000원 🐾" rows="2">${esc(quickDraft)}</textarea><div class="quick-input-footer"><span>${icon('check')}품목 · 금액 · 카테고리 자동 정리</span><button type="submit" class="primary-button">기억해줘 ${icon('arrow')}</button></div></form><div class="quick-examples"><span>이렇게 적어보세요</span><button data-example="강아지 사료 2kg 32,000원 샀어">강아지 사료 샀어</button><button data-example="어제 흰색 티셔츠 29,000원 샀어">어제 산 티셔츠</button></div></div><div class="receipt-art" aria-hidden="true"><span class="receipt-pin"></span><div class="tiny-receipt"><div class="receipt-art-logo">${icon('bag')} 뭐샀지</div><span class="receipt-dash"></span><div class="receipt-mini-line"><span>작은 소비</span><span>+1</span></div><div class="receipt-mini-line"><span>소중한 기억</span><span>+1</span></div><span class="receipt-dash"></span><div class="receipt-art-total">오늘도 잘 챙겼어요</div><span class="receipt-smile">◡</span></div><span class="art-star star-one">✦</span><span class="art-star star-two">✧</span></div></section>
    <section class="month-overview"><div class="section-heading"><h2>${currentMonth}월의 소비 기억 <span class="soft-count">${stats.count}건</span></h2><button class="text-button" data-view="report">한눈에 보기 ${icon('chevron')}</button></div><div class="category-cards">${['cat', 'dog', 'clothes', 'life'].map(id => { const c = category(id); return `<button class="category-card ${id}" data-category="${id}">${catIcon(id)}<span class="category-card-label">${esc(c.label)}</span><strong>${money(stats.byCategory[id])}<small>원</small></strong><span class="category-card-count">${state.records.filter(r => r.category === id && r.date.startsWith(todayISO().slice(0, 7))).length}번의 기록 ${icon('arrow')}</span></button>`; }).join('')}</div></section>
    <section class="panel recent-panel"><div class="section-heading"><h2>최근 구매 기록</h2><button class="text-button" data-view="records">전체 보기 ${icon('chevron')}</button></div>${recent.length ? `<div class="purchase-list">${recent.map(recordRow).join('')}</div>` : empty('receipt', '첫 번째 기억을 남겨볼까요?', '사료 한 봉, 티셔츠 한 장. 어떤 구매든 좋아요.', '구매 기록하기', 'new')}</section>
  </div><aside class="side-column"><section class="reminder-highlight"><div class="section-kicker">${icon('bell')} 뭐샀지가 챙겨드려요 <span class="live-dot"></span></div>${urgent ? `<div class="reminder-hero-icon">${catIcon(urgent.category)}<span class="small-clock">${icon('clock')}</span></div><h2>${esc(urgent.name)}<br><span>${urgent.lastAction === 'low' ? '장볼 때 챙겨주세요' : '떨어져 갈 때예요'}</span></h2><p>마지막 구매는 ${shortDate(urgent.date)}<br>평소 ${urgent.cycleDays}일 주기로 다시 챙기는 물건이에요.</p><button class="dark-button full-width" data-action="reorder" data-id="${esc(urgent.id)}">새로 샀어요 ${icon('check')}</button><div class="reminder-sub-actions"><button data-action="snooze" data-id="${esc(urgent.id)}">아직 있어요</button><span></span><button data-action="low" data-id="${esc(urgent.id)}">거의 없어요</button></div>` : `<div class="reminder-hero-icon">${catIcon('cat')}<span class="small-clock">${icon('check')}</span></div><h2>지금은 넉넉해요.<br><span>마음 놓고 지내세요</span></h2><p>${reminders.length ? '다음 구매 때가 다가오면<br>여기서 알려드릴게요.' : '소모품의 구매 주기를 기록하면<br>다시 살 때를 함께 챙겨드려요.'}</p><button class="dark-button full-width" data-view="reminders">내 알림 확인하기 ${icon('arrow')}</button>`}<div class="estimate-note">구매 주기를 바탕으로 예상한 알림이에요.</div></section>
  <section class="panel upcoming-panel"><div class="section-heading"><h2>다가오는 재구매</h2><span class="round-count">${reminders.filter(r => r.id !== urgent?.id).length}</span></div>${reminders.filter(r => r.id !== urgent?.id).slice(0, 3).map(r => `<button class="upcoming-item" data-action="edit" data-id="${esc(r.id)}">${catIcon(r.category)}<span><strong>${esc(r.name)}</strong><small>${shortDate(r.dueDate)} 예상</small></span><b class="due-badge ${r.daysLeft <= 3 ? 'near' : ''}">${dueLabel(r)}</b></button>`).join('') || `<p class="quiet-empty">다가오는 알림이 없어요.</p>`}<button class="upcoming-all" data-view="reminders">알림 모두 보기 ${icon('arrow')}</button></section>
  <div class="memory-tip">${icon('leaf')}<div><strong>나를 조금 더 잘 아는 소비</strong><p>기록할수록 필요한 것만,<br>알맞은 때에 살 수 있어요.</p></div></div></aside></div>`;
}
function dueLabel(r) { return r.lastAction === 'low' ? '구매 필요' : r.daysLeft < 0 ? `${Math.abs(r.daysLeft)}일 지남` : r.daysLeft === 0 ? '오늘' : `D−${r.daysLeft}`; }
function recordRow(r) {
  return `<button class="purchase-row" data-action="edit" data-id="${esc(r.id)}">${catIcon(r.category)}<span class="purchase-info"><strong>${esc(r.name)}</strong><span>${esc(category(r.category).label)}<i>·</i>${esc(r.quantity || '수량 미입력')}${r.shop ? `<i>·</i>${esc(r.shop)}` : ''}</span></span><span class="purchase-amount"><strong>${r.price ? `${money(r.price)}<small>원</small>` : '<span class="no-price">금액 미입력</span>'}</strong><span>${shortDate(r.date)}${r.date.slice(0, 4) !== todayISO().slice(0, 4) ? ` · ${r.date.slice(0, 4)}년` : ''}</span></span>${icon('chevron', 'row-chevron')}</button>`;
}
function empty(ico, title, desc, label, action) { return `<div class="empty-state">${icon(ico)}<h3>${title}</h3><p>${desc}</p>${label ? `<button class="secondary-button" data-action="${action}">${label}</button>` : ''}</div>`; }
function monthControl() { return `<div class="month-control"><button class="icon-button" data-month-step="-1" aria-label="이전 달">${icon('chevron', 'rotate')}</button><label class="sr-only" for="month-select">조회할 월</label><input id="month-select" type="month" min="1900-01" max="2100-12" value="${state.month}"><button class="icon-button" data-month-step="1" aria-label="다음 달">${icon('chevron')}</button></div>`; }
function filteredRecords() { return state.records.filter(r => r.date.startsWith(state.month) && (state.filter === 'all' || r.category === state.filter) && (!state.query || [r.name, r.shop, r.note, category(r.category).label, r.quantity].some(v => String(v || '').toLowerCase().includes(state.query.toLowerCase())))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); }
function recordsResult() { const rows = filteredRecords(); return `<div class="results-heading"><span>구매 기록 <strong>${rows.length}건</strong></span><span>합계 <strong>${money(rows.reduce((s, r) => s + r.price, 0))}원</strong></span></div>${rows.length ? `<div class="purchase-list records-list">${rows.map(recordRow).join('')}</div>` : empty('search', state.query ? '찾는 기록이 없어요' : '아직 이 달의 기록이 없어요', state.query ? '다른 검색어나 카테고리로 찾아보세요.' : '첫 구매를 기록하거나 다른 달을 선택해보세요.', state.query ? '' : '구매 기록하기', 'new')}`; }
function recordsView() { return `${pageHeading('YOUR EVERYDAY ARCHIVE', '그때, 뭐 샀더라?', '작은 구매도 오래 기억할 수 있도록 모아뒀어요.')}<section class="panel records-panel"><div class="records-toolbar">${monthControl()}<div class="search-field">${icon('search')}<label class="sr-only" for="record-search">구매 기록 검색</label><input type="search" id="record-search" placeholder="이 달의 품목, 구매처, 메모 검색" value="${esc(state.query)}"></div></div><div class="filter-chips" aria-label="카테고리 필터">${[{ id: 'all', label: '전체' }, ...CATEGORIES].map(c => `<button class="filter-chip ${state.filter === c.id ? 'selected' : ''}" data-filter="${esc(c.id)}" aria-pressed="${state.filter === c.id}">${c.id === 'all' ? '' : icon(c.id)}${esc(c.label)}</button>`).join('')}</div><div id="record-results">${recordsResult()}</div></section>`; }
function remindersView() {
  let list = getReminders(state.records);
  const due = list.filter(r => r.daysLeft <= 3).length;
  if (state.reminderFilter === 'due') list = list.filter(r => r.daysLeft <= 3);
  return `${pageHeading('A GENTLE LITTLE REMINDER', '필요해질 때, 잊지 않도록', '마지막 구매일과 사용 주기를 보고 다시 살 때를 예상해요.', false)}<div class="reminder-toolbar"><div class="filter-chips"><button class="filter-chip ${state.reminderFilter === 'all' ? 'selected' : ''}" data-reminder-filter="all">전체 알림</button><button class="filter-chip ${state.reminderFilter === 'due' ? 'selected' : ''}" data-reminder-filter="due">챙길 물건 <b>${due}</b></button></div><button class="secondary-button" data-action="calendar">${icon('calendar')}캘린더로 내보내기</button></div><div class="reminder-grid">${list.map(r => `<article class="panel reminder-card"><div class="reminder-card-top">${catIcon(r.category)}<span class="due-badge ${r.daysLeft <= 3 ? 'near' : ''}">${dueLabel(r)}</span></div><h2>${esc(r.name)}</h2><p>${esc(category(r.category).label)} · ${esc(r.quantity || '수량 미입력')}</p><dl><div><dt>마지막 구매</dt><dd>${shortDate(r.date)}</dd></div><div><dt>구매 주기</dt><dd>${r.cycleDays}일마다</dd></div><div><dt>다음 확인</dt><dd>${r.dueDate.replaceAll('-', '.')}</dd></div></dl><button class="primary-button full-width" data-action="reorder" data-id="${esc(r.id)}">${icon('plus')}새로 샀어요</button><div class="reminder-sub-actions"><button data-action="snooze" data-id="${esc(r.id)}">아직 있어요 <small>+7일</small></button><span></span><button data-action="low" data-id="${esc(r.id)}">거의 없어요</button></div><button class="text-button reminder-edit" data-action="edit" data-id="${esc(r.id)}">${icon('edit')}구매 주기 수정</button></article>`).join('')}</div>${list.length ? `<p class="inline-info">${icon('info')}알림은 앱을 열면 확인할 수 있어요. 앱 밖에서도 알림을 받으려면 캘린더 파일을 가져오세요.</p>` : `<section class="panel">${empty('bell', '지금은 챙길 알림이 없어요', '구매 기록에 사용 주기를 입력하면 재구매를 챙겨드려요.', '구매 기록하기', 'new')}</section>`}`;
}
function reportView() {
  const stats = monthlyStats(state.records, state.month);
  const max = Math.max(...Object.values(stats.byCategory), 1);
  const cats = CATEGORIES.filter(c => stats.byCategory[c.id] > 0);
  const weeks = [0, 0, 0, 0, 0]; state.records.filter(r => r.date.startsWith(state.month)).forEach(r => { weeks[Math.min(4, Math.floor((Number(r.date.slice(8)) - 1) / 7))] += r.price; });
  const maxWeek = Math.max(...weeks, 1);
  const difference = stats.total - stats.previousTotal;
  return `${pageHeading('YOUR MONTH IN LITTLE MOMENTS', '이번 달의 소비를 돌아봐요', '어디에, 얼마나 썼는지. 기억을 모으면 흐름이 보여요.', false)}<div class="report-toolbar">${monthControl()}<button class="text-button" data-action="export">${icon('download')}전체 기록 백업</button></div><div class="report-summary"><section class="report-total"><span>${monthName(state.month)} 총 구매 금액</span><strong>${money(stats.total)}<small>원</small></strong><p>${stats.previousTotal ? `지난달보다 <b>${money(Math.abs(difference))}원 ${difference >= 0 ? '더' : '덜'}</b> 썼어요` : '지난달 구매 금액이 없어 비교를 기다리고 있어요'}</p>${icon('bag', 'report-watermark')}</section><section class="panel report-count"><span>차곡차곡 쌓인 기록</span><strong>${stats.count}<small>건</small></strong><p>이번 달 나를 위한 소비</p></section></div><div class="report-grid"><section class="panel"><div class="section-heading"><h2>카테고리별 구매</h2><span class="muted">금액 기준</span></div>${cats.length ? `<div class="category-breakdown">${CATEGORIES.map(c => `<div class="breakdown-row">${catIcon(c.id)}<div><div class="breakdown-label"><span>${esc(c.label)}</span><strong>${money(stats.byCategory[c.id])}원</strong></div><div class="bar-track"><span class="bar-fill ${c.id}" style="width:${stats.byCategory[c.id] / max * 100}%"></span></div></div></div>`).join('')}</div>` : empty('chart', '기록이 쌓이면 보여드릴게요', '금액을 입력한 구매 기록이 아직 없어요.')}</section><section class="panel"><div class="section-heading"><h2>주별 구매 흐름</h2><span class="muted">${Number(state.month.slice(5))}월</span></div><div class="weekly-chart" role="img" aria-label="${esc(weeks.map((v, i) => `${i + 1}주차 ${money(v)}원`).join(', '))}">${weeks.map((v, i) => `<div class="week-column"><span class="week-amount">${v >= 10000 ? `${(v / 10000).toFixed(1)}만` : money(v)}</span><div class="week-bar-space"><div class="week-bar ${v === maxWeek ? 'peak' : ''}" style="height:${v / maxWeek * 100}%"></div></div><span>${i + 1}주</span></div>`).join('')}</div><p class="chart-note">매월 1일부터 7일씩 묶어서 보여드려요.</p></section></div>`;
}

function openRecord(initial = {}, editing = false, fromMemo = false) {
  const r = { name: '', category: 'cat', price: '', quantity: '', date: todayISO(), cycleDays: 30, shop: '', note: '', ...initial };
  const dialog = $('#record-dialog');
  dialog.innerHTML = `<form id="record-form" data-edit-id="${editing ? esc(r.id) : ''}"><div class="dialog-heading"><div><p class="eyebrow">A NEW LITTLE MEMORY</p><h2 id="record-title">${editing ? '구매 기록 수정' : fromMemo ? '이렇게 기억해둘까요?' : '오늘의 구매 기록'}</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="닫기">${icon('close')}</button></div>${fromMemo ? `<div class="parse-notice">${icon('spark')}메모에서 정리했어요. 저장 전에 한 번 확인해 주세요.</div>` : ''}<div class="form-body"><label class="field">무엇을 샀나요?<input name="name" required maxlength="120" value="${esc(r.name)}" placeholder="예: 고양이 츄르 간식"></label><div class="form-two"><label class="field">카테고리<select name="category">${CATEGORIES.map(c => `<option value="${esc(c.id)}" ${r.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><label class="field">구매 날짜<input type="date" name="date" required min="1900-01-01" max="${todayISO()}" value="${esc(r.date)}"></label></div><div class="form-two"><label class="field">총 구매 금액 <span>선택</span><div class="input-suffix"><input type="number" inputmode="numeric" name="price" min="0" max="1000000000" step="1" value="${r.price === 0 ? '' : esc(r.price)}" placeholder="0"><span>원</span></div></label><label class="field">수량 <span>선택</span><input name="quantity" maxlength="40" value="${esc(r.quantity)}" placeholder="예: 3봉, 2kg"></label></div><label class="field">구매처 <span>선택</span><input name="shop" maxlength="120" value="${esc(r.shop)}" placeholder="예: 쿠팡, 동네 마트"></label><div class="cycle-field"><span class="cycle-icon">${icon('bell')}</span><label for="cycle-input"><strong>다시 살 때 챙겨주세요</strong><span>알림이 필요 없으면 0일로 설정해 주세요.</span></label><div class="cycle-input"><input id="cycle-input" name="cycleDays" type="number" inputmode="numeric" min="0" max="3650" required value="${esc(r.cycleDays)}" aria-label="재구매 주기 (일)"><span>일마다</span></div></div><label class="field">나만의 메모 <span>선택</span><textarea name="note" maxlength="2000" rows="2" placeholder="다음에 살 때 기억하고 싶은 것">${esc(r.note)}</textarea></label><p id="form-error" class="form-error" role="alert"></p></div><div class="dialog-footer">${editing ? `<button type="button" class="delete-button" data-action="delete" data-id="${esc(r.id)}">${icon('trash')}삭제</button>` : `<span class="save-note">${icon('check')}이 브라우저에 저장돼요</span>`}<button type="submit" class="primary-button">${icon('check')}${editing ? '수정 저장하기' : '기억해두기'}</button></div></form>`;
  dialog.showModal();
  requestAnimationFrame(() => $('input[name="name"]', dialog).focus());
}
function saveForm(form) {
  const values = Object.fromEntries(new FormData(form));
  const id = form.dataset.editId;
  const previous = state.records.find(r => r.id === id);
  try {
    if (values.date > todayISO()) throw new Error('구매 날짜는 오늘 또는 이전 날짜로 입력해 주세요.');
    const changedSchedule = previous && (Number(values.cycleDays) !== previous.cycleDays || values.date !== previous.date);
    const record = normalizeRecord({ ...previous, ...values, id: id || undefined, price: Number(values.price || 0), cycleDays: Number(values.cycleDays), createdAt: previous?.createdAt || new Date().toISOString(), nextReminder: changedSchedule ? null : previous?.nextReminder || null, lastAction: changedSchedule ? null : previous?.lastAction || null });
    if (id && state.demo) {
      state.records = state.records.map(r => r.id === id ? record : r); $('#record-dialog').close(); render(); notify('예시 기록을 수정했어요. 내 기록은 “내 기록 시작하기”에서 시작하세요.'); return;
    }
    const wasDemo = state.demo;
    const existing = wasDemo ? [] : state.records;
    const next = id ? existing.map(r => r.id === id ? record : r) : [...existing, record];
    if (!persist(next)) return;
    quickDraft = ''; $('#record-dialog').close(); render(); notify(wasDemo ? '첫 기록을 저장했어요. 예시 기록은 내 구매 내역에 포함되지 않아요.' : '기억해뒀어요. 다음에 필요할 때 찾아드릴게요.');
  } catch (e) { $('#form-error').textContent = e.message || '입력 내용을 다시 확인해 주세요.'; }
}
function actOnReminder(id, action) {
  const current = getReminders(state.records).find(r => r.id === id);
  if (!current) return;
  const base = current.dueDate > todayISO() ? current.dueDate : todayISO();
  const nextDate = action === 'snooze' ? addDays(base, 7) : todayISO();
  const next = state.records.map(r => r.id === id ? { ...r, nextReminder: nextDate, lastAction: action === 'snooze' ? 'enough' : 'low' } : r);
  const isDemo = state.demo;
  if (isDemo) state.records = next; else if (!persist(next)) return;
  render(); notify(`${isDemo ? '예시 알림: ' : ''}${action === 'snooze' ? `${shortDate(nextDate)}에 다시 챙겨드릴게요.` : '구매가 필요한 물건으로 표시했어요.'}`);
}
function openSettings() {
  $('#settings-dialog').innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">MAKE YOURSELF AT HOME</p><h2 id="settings-title">나의 뭐샀지</h2></div><button class="icon-button" data-action="close-dialog" aria-label="닫기">${icon('close')}</button></div><div class="settings-body"><div class="settings-intro"><span class="brand-symbol">${icon('bag')}</span><div><strong>작은 기억을 오래 간직해요.</strong><p>${state.demo ? '지금은 예시 기록을 둘러보고 있어요.' : `${state.records.length}개의 기록이 이 브라우저에 있어요.`}</p></div></div><h3>휴대폰에서도 편하게</h3><p class="settings-description">홈 화면에 추가하면 앱처럼 열 수 있어요. iPhone은 Safari의 공유 → 홈 화면에 추가, Android는 Chrome의 메뉴 → 앱 설치를 선택하세요.</p><button class="secondary-button full-width" data-action="install">${icon('download')}홈 화면에 설치하기</button><h3>나의 기록 보관하기</h3><p class="settings-description">기록은 현재 기기의 브라우저에 저장돼요. 다른 기기로 옮기거나 브라우저 데이터를 지우기 전에는 백업해 주세요.</p><div class="settings-buttons"><button class="secondary-button" data-action="export">${icon('download')}JSON 백업</button><button class="secondary-button" data-action="import">${icon('upload')}백업 가져오기</button></div><h3>재구매 알림</h3><p class="settings-description">이 버전은 앱을 열 때 재구매 알림을 보여줘요. 캘린더로 내보낸 뒤 캘린더 앱에서 가져오면 예정일 하루 전 알림을 설정할 수 있어요. 자동 동기화되지는 않아요.</p><button class="secondary-button full-width" data-action="calendar">${icon('calendar')}캘린더 파일 내보내기</button><div class="settings-bottom"><span>뭐샀지 v1.0 · 내 일상을 위한 작은 기록</span>${state.demo ? '<button class="text-button" data-action="start">내 기록 시작하기</button>' : '<button class="delete-button" data-action="reset">전체 기록 삭제</button>'}</div></div>`;
  $('#settings-dialog').showModal();
}
function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportRecords() { download(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), sample: state.demo, records: state.records }, null, 2), 'application/json', `뭐샀지-${state.demo ? '예시-' : ''}${todayISO()}.json`); notify('기록 백업 파일을 내보냈어요.'); }
function exportCalendar() {
  const reminders = getReminders(state.records);
  if (!reminders.length) { notify('구매 주기가 설정된 기록이 없어요. 먼저 구매를 기록해 주세요.'); return; }
  const escapeICS = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r/g, '');
  const fold = line => { let result = '', length = 0; for (const char of line) { const bytes = new TextEncoder().encode(char).length; if (length + bytes > 73) { result += '\r\n '; length = 1; } result += char; length += bytes; } return result; };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MwoSatji//Purchase Memory//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  reminders.forEach(r => { const due = r.dueDate < todayISO() ? todayISO() : r.dueDate; lines.push('BEGIN:VEVENT', `UID:${r.id}@mwosatji.local`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`, `DTSTART;VALUE=DATE:${due.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${addDays(due, 1).replaceAll('-', '')}`, `SUMMARY:${escapeICS(`뭐샀지 · ${r.name} 다시 확인하기`)}`, `DESCRIPTION:${escapeICS(`마지막 구매 ${r.date} / ${r.cycleDays}일 주기. 재고가 남아 있는지 확인해 주세요. 앱의 알림 변경은 캘린더에 자동 반영되지 않습니다.`)}`, 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${escapeICS(`${r.name} 구매 시점을 확인해 주세요.`)}`, 'END:VALARM', 'END:VEVENT'); });
  lines.push('END:VCALENDAR'); download(lines.map(fold).join('\r\n') + '\r\n', 'text/calendar;charset=utf-8', `뭐샀지-${state.demo ? '예시-' : ''}재구매-알림.ics`); notify('캘린더 파일을 내보냈어요. 캘린더 앱에서 가져오기를 완료해 주세요.');
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button, a[data-view]'); if (!button) return;
  if (button.dataset.view) { event.preventDefault(); changeView(button.dataset.view); return; }
  if (button.dataset.category) { state.month = todayISO().slice(0, 7); changeView('records', button.dataset.category); return; }
  if (button.dataset.example) { $('#quick-note').value = button.dataset.example; $('#quick-note').focus(); return; }
  if (button.dataset.filter) { state.filter = button.dataset.filter; render(); return; }
  if (button.dataset.reminderFilter) { state.reminderFilter = button.dataset.reminderFilter; render(); return; }
  if (button.dataset.monthStep) {
    const [year, month] = state.month.split('-').map(Number); const d = new Date(year, month - 1 + Number(button.dataset.monthStep), 1);
    if (d.getFullYear() < 1900 || d.getFullYear() > 2100) return;
    state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render(); return;
  }
  const action = button.dataset.action, id = button.dataset.id;
  if (action === 'new') openRecord();
  if (action === 'edit') { const r = state.records.find(r => r.id === id); if (r) openRecord(r, true); }
  if (action === 'reorder') { const r = state.records.find(r => r.id === id); if (r) { const { id: oldId, createdAt, nextReminder, lastAction, ...values } = r; openRecord({ ...values, date: todayISO() }); } }
  if (action === 'snooze' || action === 'low') actOnReminder(id, action);
  if (action === 'settings') openSettings();
  if (action === 'close-dialog') button.closest('dialog').close();
  if (action === 'search') { changeView('records'); $('#record-search').focus(); }
  if (action === 'start') { if (persist([])) { $('#settings-dialog').close(); render(); notify('이제 나만의 구매 기록을 시작해보세요.'); $('#quick-note')?.focus(); } }
  if (action === 'delete') {
    if (!confirm('이 구매 기록을 삭제할까요? 삭제한 기록은 되돌릴 수 없어요.')) return;
    const next = state.records.filter(r => r.id !== id); if (state.demo) state.records = next; else if (!persist(next)) return;
    $('#record-dialog').close(); render(); notify('구매 기록을 삭제했어요.');
  }
  if (action === 'reset') {
    if (!confirm(`구매 기록 ${state.records.length}개를 모두 삭제할까요? 되돌릴 수 없으니 필요한 기록은 먼저 백업해 주세요.`)) return;
    if (persist([])) { $('#settings-dialog').close(); render(); notify('전체 구매 기록을 삭제했어요.'); }
  }
  if (action === 'export') exportRecords();
  if (action === 'import') $('#import-file').click();
  if (action === 'calendar') exportCalendar();
  if (action === 'install') {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) { notify('이미 앱으로 사용하고 있어요.'); return; }
    if (deferredInstall) { await deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; }
    else notify('브라우저 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요.');
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'quick-form') {
    event.preventDefault(); quickDraft = $('#quick-note').value.trim();
    if (!quickDraft) { notify('무엇을 샀는지 한 줄로 적어주세요.'); $('#quick-note').focus(); return; }
    try { openRecord(parseMemo(quickDraft), false, true); }
    catch (e) { notify(e.message || '구매 메모를 다시 확인해 주세요.'); }
  }
  if (event.target.id === 'record-form') { event.preventDefault(); saveForm(event.target); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'record-search') { state.query = event.target.value; $('#record-results').innerHTML = recordsResult(); }
  if (event.target.id === 'quick-note') quickDraft = event.target.value;
});
document.addEventListener('change', event => {
  if (event.target.id === 'month-select') { if (/^(19|20)\d{2}-(0[1-9]|1[0-2])$|^2100-(0[1-9]|1[0-2])$/.test(event.target.value)) { state.month = event.target.value; render(); } }
  if (event.target.name === 'category' && !$('#record-form').dataset.editId) $('#cycle-input').value = category(event.target.value).defaultCycle || 0;
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('32MB 이하의 백업 파일을 선택해 주세요.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.records)) throw new Error('뭐샀지 백업 파일 형식이 아니에요.');
    const next = data.records.map(normalizeRecord); if (new Set(next.map(r => r.id)).size !== next.length) throw new Error('중복된 기록 ID가 있어 가져올 수 없어요.');
    if (next.some(r => r.date > todayISO())) throw new Error('미래 구매 날짜가 있어요. 백업 파일을 확인해 주세요.');
    if (!confirm(`${data.sample ? '예시 데이터 파일이에요. ' : ''}${next.length}개의 기록을 가져올까요? 현재 기록은 이 파일로 교체됩니다.`)) return;
    if (persist(next)) { $('#settings-dialog').close(); render(); notify('백업 기록을 가져왔어요.'); }
  } catch (e) { notify(e instanceof SyntaxError ? '올바른 JSON 백업 파일을 선택해 주세요.' : e.message); }
  finally { event.target.value = ''; }
});
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); if (!$('dialog[open]')) { changeView('records'); $('#record-search').focus(); } } });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; });
window.addEventListener('storage', event => { if (event.key === KEY) { try { const value = JSON.parse(event.newValue); if (value?.version === 1 && Array.isArray(value.records)) { state.records = value.records.map(normalizeRecord); state.demo = false; render(); notify('다른 탭에서 변경한 기록을 반영했어요.'); } } catch {} } });
let renderedDay = todayISO();
document.addEventListener('visibilitychange', () => { if (!document.hidden && todayISO() !== renderedDay) { renderedDay = todayISO(); render(); } });
render();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* Online app remains available when installation is restricted. */ }));
