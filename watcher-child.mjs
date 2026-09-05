import { activeWindow } from 'get-windows';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────
//  설정 로드
// ─────────────────────────────────────────────

const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const FAST = cfg.발화.테스트모드;
const POLL_MS = 3000;
const MIN_GAP_S = FAST ? cfg.발화.최소간격초_테스트 : cfg.발화.최소간격초_실사용;
const TARGET_S = FAST ? cfg.발화.평균간격초_테스트 : cfg.발화.평균간격초_실사용;
const DWELL_MIN_S = cfg.카운팅.체류_최소초;
const ITEM_MIN_S = cfg.카운팅.개수_최소초;
const TH = cfg.임계값_분;

const IGNORE_APPS = ['windows terminal', 'windowsterminal', 'openconsole', 'conhost', 'terminal host'];

// ─────────────────────────────────────────────
//  창 제목 정리 & 분류
// ─────────────────────────────────────────────

const TAILS = [
  /\s*[-–—]\s*Microsoft.?\s?Edge$/i, /\s*[-–—]\s*Google Chrome$/i,
  /\s*[-–—]\s*Mozilla Firefox$/i, /\s*[-–—]\s*Whale$/i,
  /\s*[-–—]\s*개인$/, /\s*[-–—]\s*프로필 \d+$/,
  /\s*외 페이지 \d+개$/, /\s*및 페이지 \d+개$/, /\s*and \d+ more pages?$/i,
];

function clean(title) {
  let t = title || '', changed = true;
  while (changed) {
    changed = false;
    for (const re of TAILS) if (re.test(t)) { t = t.replace(re, ''); changed = true; }
  }
  return t.replace(/^\(\d+\)\s*/, '').trim();
}

const BROWSERS = ['edge', 'chrome', 'firefox', 'whale', 'brave', 'opera'];

function classify(win) {
  const app = win.owner?.name || '?';
  const exe = win.owner?.path ? path.basename(win.owner.path) : app;
  const title = clean(win.title);
  const hay = `${app} ${exe} ${title}`.toLowerCase();

  if (IGNORE_APPS.some(k => app.toLowerCase().includes(k)))
    return { kind: 'ignore', site: 'terminal', label: app, detail: title, exe };

  if ((cfg.ignoreTitles || []).some(k => title.toLowerCase().includes(k.toLowerCase())))
    return { kind: 'ignore', site: 'newtab', label: '새 탭', detail: title, exe };

  const unsafeOverlay = (cfg.안티치트 || []).some(k => hay.includes(k));
  const isBrowser = BROWSERS.some(b => app.toLowerCase().includes(b) || exe.toLowerCase().includes(b));

  // 등록된 사이트 먼저
  for (const s of cfg.sites) {
    if (!hay.includes(s.match.toLowerCase())) continue;
    let sub = null;
    if (s.extract) {
      try { sub = (title.match(new RegExp(s.extract, 'i')) || [])[1] || null; } catch {}
    }
    return {
      kind: 'known', site: s.as, label: sub ? `${s.as} ${sub}` : s.as,
      sub, unit: s.unit || '페이지', detail: title, exe, unsafeOverlay, registered: true,
    };
  }

  // 미등록 — 일반 규칙
  if (isBrowser) {
    // 제목 끝자락에서 사이트 이름을 대충 건져본다
    const guess = title.split(/\s[-–—|]\s/).pop();
    const label = guess && guess.length <= 20 && guess !== title ? guess : '웹페이지';
    return { kind: 'web', site: label, label, unit: '페이지', detail: title, exe, unsafeOverlay, registered: false };
  }

  return { kind: 'app', site: exe, label: title || app, unit: '화면', detail: title, exe, unsafeOverlay, registered: false };
}

// ─────────────────────────────────────────────
//  상태 & 카운팅 (6초/30초 확정 필터)
// ─────────────────────────────────────────────

const bootAt = Date.now();
let siteKey = null, siteStart = Date.now();
let detailKey = null, detailStart = Date.now();
let dwellCounted = false, itemCounted = false;

const switches = [];                 // 창 전환 시각 (전부 셈)
const itemLog = [];                  // { t, site, item } — 30초 이상 머문 것만
const visitCount = new Map();         // 화면 제목 -> 오늘 열어본 횟수
const siteSeconds = new Map();        // 사이트 -> 누적 초 (6초 이상 확정분만)

let pressure = 0, threshold = expo(TARGET_S), lastFire = 0, doubleTapAt = 0;
const usedEvents = new Map();
let lastRealCtx = null;

function expo(mean) { return -Math.log(1 - Math.random()) * mean; }
function ramp(x, lo, hi) { return x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo); }
function since(list, ms, now) { return list.filter(r => now - (r.t ?? r) < ms); }

// ─────────────────────────────────────────────
//  판정
// ─────────────────────────────────────────────

function thresholdFor(c) {
  if (c.kind === 'app') return TH.게임_체류;
  if (c.registered) return TH.사이트_체류;
  return TH.웹_체류;
}

function evaluate(now, c) {
  const stareMin = (now - detailStart) / 60000;
  const siteMin = (now - siteStart) / 60000;
  const hour = new Date(now).getHours();
  const sw4 = since(switches, 4 * 60 * 1000, now).length;
  const items = new Set(since(itemLog, 30 * 60 * 1000, now).filter(r => r.site === c.site).map(r => r.item)).size;
  const visits = visitCount.get(c.detail) || 0;
  const cands = [];

  if (stareMin > TH.화면_고정)
    cands.push({ ev: 'STARE', score: ramp(stareMin, TH.화면_고정, TH.화면_고정 * 4), anim: 'IdleEyeBrowRaise' });

  const t0 = thresholdFor(c);
  if (siteMin > t0)
    cands.push({ ev: 'SITE_LONG', score: ramp(siteMin, t0, t0 * 6), anim: 'GetAttention' });

  if (items >= 3)
    cands.push({ ev: 'BINGE', score: ramp(items, 3, 12), anim: 'Searching' });

  if (visits >= 3)
    cands.push({ ev: 'REVISIT', score: ramp(visits, 3, 8), anim: 'Explain' });

  if (sw4 >= 10)
    cands.push({ ev: 'RESTLESS', score: ramp(sw4, 10, 26) * 0.7, anim: 'GetWizardy' });

  if (!cands.length) return null;

  const night = (hour >= 2 && hour < 6) ? 1.6 : 1;
  for (const x of cands) {
    x.score = Math.min(1, x.score * night);
    const ago = (now - (usedEvents.get(x.ev) || 0)) / 1000;
    x.score *= Math.min(1, 0.15 + 0.85 * (ago / (FAST ? 90 : 2400)));
  }

  return cands.filter(x => x.score > 0.05).sort((a, b) => b.score - a.score)[0] || null;
}

// ─────────────────────────────────────────────
//  관찰 데이터 — 여기 있는 숫자만 모델이 쓸 수 있다
// ─────────────────────────────────────────────

function describe(c, cand) {
  const now = Date.now();
  const m = (ms) => Math.round(ms / 60000);
  const rows = [];

  rows.push(`프로그램: ${c.exe}`);
  rows.push(`앱/사이트: ${c.label}`);
  if (c.detail && c.detail !== c.label) rows.push(`창 제목: ${c.detail}`);
  if (!c.registered) rows.push(`(이 사이트는 등록되지 않음 — 세부 항목은 알 수 없음)`);

  const stare = m(now - detailStart);
  if (stare >= 1) rows.push(`이 화면 그대로 본 시간: ${stare}분`);

  const site = m(now - siteStart);
  if (site >= 1) rows.push(`이 앱/사이트에 머문 시간: ${site}분`);

  const visits = visitCount.get(c.detail) || 0;
  if (visits >= 2) rows.push(`이 화면을 오늘 열어본 횟수: ${visits}번째`);

  const total = Math.round((siteSeconds.get(c.site) || 0) / 60);
  if (total >= 2) rows.push(`오늘 ${c.label}에 쓴 총 시간: ${total}분`);

  const items = new Set(since(itemLog, 30 * 60 * 1000, now).filter(r => r.site === c.site).map(r => r.item)).size;
  if (items >= 2) rows.push(`최근 30분간 본 서로 다른 ${c.unit || '페이지'} 수: ${items}개`);

  const sw = since(switches, 4 * 60 * 1000, now).length;
  if (sw >= 5) rows.push(`최근 4분간 창 전환 횟수: ${sw}번`);

  const up = m(now - bootAt);
  rows.push(up >= 1 ? `클리피가 지켜본 시간: ${up}분` : `클리피가 지켜본 시간: 1분 미만 (방금 켜짐)`);

  const h = new Date(now).getHours();
  const part = h < 5 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : h < 23 ? '저녁' : '밤늦게';
  rows.push(`지금 대략 ${part} ${h % 12 || 12}시쯤`);

  return '[관찰 데이터] — 이 숫자들만 사용 가능. 없는 수치는 절대 지어내지 말 것.\n'
    + rows.map(r => '- ' + r).join('\n');
}

// ─────────────────────────────────────────────
//  대사 생성
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  발화
// ─────────────────────────────────────────────

function fire(now, c, cand) {
  usedEvents.set(cand.ev, now);
  lastFire = now; pressure = 0; threshold = expo(TARGET_S);

  const payload = {
    type: 'observation',
    event: cand.ev,
    score: Number(cand.score.toFixed(2)),
    label: c.label,
    detail: c.detail,
    exe: c.exe,
    unsafeOverlay: !!c.unsafeOverlay,
    text: describe(c, cand),
    at: now,
  };

  if (process.send) process.send(payload);
  else console.log(JSON.stringify(payload, null, 2)); // 단독 실행 시 확인용

  doubleTapAt = Math.random() < cfg.발화.연속발화확률
    ? now + (20 + Math.random() * 40) * 1000 : 0;
}

// ─────────────────────────────────────────────
//  메인 루프
// ─────────────────────────────────────────────

async function tick() {
  const now = Date.now();
  let win;
  try { win = await activeWindow(); } catch { return; }
  if (!win) return;

  const c = classify(win);
  const sKey = `${c.kind}:${c.site}`;
  const dKey = `${sKey}|${c.detail}`;

  if (sKey !== siteKey) {
    if (siteKey && !siteKey.startsWith('ignore:') && c.kind !== 'ignore') switches.push(now);
    siteKey = sKey; siteStart = now;
  }
  if (dKey !== detailKey) {
    detailKey = dKey; detailStart = now;
    dwellCounted = false; itemCounted = false;
  }

  if (c.kind === 'ignore') return;
  lastRealCtx = c;

  const held = (now - detailStart) / 1000;

  // 6초 이상 머문 것만 시간으로 인정
  if (held >= DWELL_MIN_S) {
    if (!dwellCounted) {
      dwellCounted = true;
      visitCount.set(c.detail, (visitCount.get(c.detail) || 0) + 1);
      siteSeconds.set(c.site, (siteSeconds.get(c.site) || 0) + DWELL_MIN_S);
    } else {
      siteSeconds.set(c.site, (siteSeconds.get(c.site) || 0) + POLL_MS / 1000);
    }
  }
  // 30초 이상 머문 것만 '한 개 봤다'로 인정
  if (held >= ITEM_MIN_S && !itemCounted) {
    itemCounted = true;
    itemLog.push({ t: now, site: c.site, item: c.detail });
    if (itemLog.length > 3000) itemLog.splice(0, 1500);
  }

  const cand = evaluate(now, c);
  if (!cand) return;
  pressure += cand.score * (POLL_MS / 1000);

  const gapOk = (now - lastFire) / 1000 >= MIN_GAP_S;
  const ready = doubleTapAt ? now >= doubleTapAt : pressure >= threshold;
  if (gapOk && ready) fire(now, c, cand);
}

// ─────────────────────────────────────────────

// 부모(Electron)로부터 명령 받기
process.on('message', (msg) => {
  if (msg && msg.type === 'force') {
    const now = Date.now();
    const c = lastRealCtx || {
      kind: 'app', site: 'desktop', label: '바탕화면',
      detail: '', exe: 'explorer.exe', unit: '화면',
    };
    const cand = evaluate(now, c) || { ev: 'FORCED', score: 1, anim: 'GetAttention' };
    fire(now, c, cand);
  }
});

if (!process.send) {
  console.log(`watcher 단독 실행 · ${FAST ? '테스트' : '실사용'} 모드 · Ctrl+C 종료`);
}

setInterval(tick, POLL_MS);
