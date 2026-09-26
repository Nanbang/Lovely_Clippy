// 제미나이 클라이언트.
// 컴퓨터 켜고 끌 때까지 대화 하나가 계속 이어진다.
// 사용자 발언과 트리거 관찰이 같은 대화에 섞여 들어간다.

import { getActiveCard, checkActiveCard } from "./cards";
import { getActiveConnection, checkConnection } from "./connections";
import { loadParams } from "./params";
import { logDebug } from "./debugLog";
import { buildMemoryBlock } from "./memories";
import {
  activeNotes,
  addNote,
  buildNotesBlock,
  buildNotesCount,
  checkSecret,
  completeNote,
  deleteNote,
} from "./notes";
import {
  applyDelta,
  buildEmotionBlock,
  loadEmotions,
  timeSinceLastSeen,
  touchLastSeen,
} from "./emotions";

type Turn = { role: "user" | "model"; parts: { text: string }[] };

const history: Turn[] = [];
const pinned: string[] = [];

let thinkingSupported = true;

// 토큰 사용량 집계. 스트리밍 응답의 usageMetadata 에서 실제 값을 받는다.
export type Usage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  day: string;
};

const USAGE_KEY = "clippy.usage.v1";

export function loadUsage(): Usage {
  const today = new Date().toDateString();
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    const u = raw ? (JSON.parse(raw) as Usage) : null;
    if (u && u.day === today) return u;
  } catch {
    /* 무시 */
  }
  return { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, day: today };
}

function addUsage(inTok: number, outTok: number, cached: number) {
  const u = loadUsage();
  u.calls += 1;
  u.inputTokens += inTok;
  u.outputTokens += outTok;
  u.cachedTokens += cached;
  localStorage.setItem(USAGE_KEY, JSON.stringify(u));
}

export function resetUsage() {
  localStorage.removeItem(USAGE_KEY);
}

// ── 상황 추적 ────────────────────────────────
// 클리피가 매번 "지금 이 말이 왜 나가는 건지"를 알아야
// "부를 때는 언제고" 같은 앞뒤 안 맞는 소리를 안 한다.

type Occasion = "trigger" | "summon" | "reply" | "greet";

const OCCASION_KO: Record<Occasion, string> = {
  trigger: "Clippy spoke first, off something on screen",
  summon: "The user pulled Clippy up with the hotkey",
  reply: "The user said something and Clippy answered",
  greet: "The app started and Clippy said hello",
};

const WAIT_EN: Record<string, string> = {
  "바로": "instantly",
  "금방": "almost at once",
  "잠깐 뒤에": "after a short pause",
  "좀 있다가": "after a while",
  "한참 뒤에": "after a long wait",
  "아주 한참 뒤에": "after a very long wait",
  "한나절 만에": "hours later",
};
const en = (w: string) => WAIT_EN[w] || w;

function gapEn(gap: string): string {
  if (gap.includes("처음")) return "never — this is the first time";
  if (gap.includes("방금")) return "moments ago";
  const n = gap.match(/(\d+)/)?.[1] ?? "";
  if (gap.includes("분")) return `${n} minutes`;
  if (gap.includes("시간")) return `${n} hours`;
  if (gap.includes("일")) return `${n} days`;
  return gap;
}

let lastOccasion: Occasion | null = null;
let lastInner = "";   // 직전 발화의 속마음. 판정 + 다음 턴 프롬프트에 한 번만 들어간다.
let seriousMode = false;  // 이번 턴에 제대로 답해야 하는지
let searchMode = false;   // 이번 턴에 웹 검색 도구를 붙일지
let notesMode = false;    // 이번 턴에 메모 전체를 보여줄지
let reminderDue: string | null = null; // 지금 알려야 할 리마인더

export function getLastInner() {
  return lastInner;
}

/** 응답에 섞인 메모 태그를 실제 저장에 반영한다. */
function applyNoteTags(text: string) {
  // <memo remind="...">내용</memo>
  const memoRe = /<memo(?:\s+remind="([^"]*)")?>([\s\S]*?)<\/memo>/g;
  let m: RegExpExecArray | null;
  while ((m = memoRe.exec(text))) {
    const body = m[2].trim();
    if (!body) continue;

    let remindAt: number | undefined;
    if (m[1]) {
      const t = Date.parse(m[1].replace(" ", "T"));
      if (!Number.isNaN(t)) remindAt = t;
    }

    const result = addNote(body, remindAt);
    if (typeof result === "string") {
      logDebug("오류", `메모 거부: ${result}`, body);
    } else {
      logDebug(
        "관찰",
        `메모 저장${remindAt ? " (알림 있음)" : ""}`,
        `${body}${remindAt ? `\n알림: ${new Date(remindAt).toLocaleString("ko-KR")}` : ""}`,
      );
    }
  }

  // <done>번호</done> / <undo>번호</undo>
  const list = activeNotes();
  const pick = (n: string) => list[Number(n) - 1];

  for (const mm of text.matchAll(/<done>(\d+)<\/done>/g)) {
    const note = pick(mm[1]);
    if (note) {
      completeNote(note.id);
      logDebug("관찰", "메모 완료 처리", note.text);
    }
  }
  for (const mm of text.matchAll(/<undo>(\d+)<\/undo>/g)) {
    const note = pick(mm[1]);
    if (note) {
      deleteNote(note.id);
      logDebug("관찰", "메모 삭제", note.text);
    }
  }
}

function extractInner(text: string): string {
  const grab = (tag: string) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : "";
  };
  const past = grab("past");
  const now = grab("now");
  const want = grab("want");
  if (!past && !now && !want) return "";
  return `past: ${past || "(nothing)"}\nnow: ${now || "(nothing)"}\nwant: ${want || "(nothing)"}`;
}
let lastSpokeAt = 0;   // 클리피가 마지막으로 말한 시각
let lastUserAt = 0;    // 사용자가 마지막으로 말한 시각
let pendingOccasion: Occasion | null = null;

function hhmm(t: number): string {
  return new Date(t).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function gapWords(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return "바로";
  if (s < 30) return "금방";
  if (s < 120) return "잠깐 뒤에";
  if (s < 300) return "좀 있다가";
  if (s < 1200) return "한참 뒤에";
  if (s < 3600) return "아주 한참 뒤에";
  return "한나절 만에";
}

/** 프롬프트 맨 위에 붙는 상황판. 항상 최신 하나만 존재한다. */
function situationBoard(now: Occasion): string {
  const lines = [`- This one: ${OCCASION_KO[now]}`];

  if (lastOccasion && lastSpokeAt) {
    lines.push(`- Last time: ${hhmm(lastSpokeAt)} — ${OCCASION_KO[lastOccasion]}`);

    const ignored = lastSpokeAt > lastUserAt;
    if (ignored) {
      const waited = gapWords(Date.now() - lastSpokeAt);
      if (lastOccasion === "reply") {
        lines.push(`- Since then: they stepped away. The thread ended; that is not being ignored.`);
      } else {
        lines.push(`- Since then: nothing back (${en(waited)} and counting). You spoke up and got ignored.`);
      }
    } else if (lastUserAt > lastSpokeAt) {
      lines.push(`- Since then: they answered ${en(gapWords(lastUserAt - lastSpokeAt))}`);
    }
  } else {
    lines.push("- Last time: never (first of the day)");
  }

  return `[SITUATION]\n${lines.join("\n")}\n\nA fact check, not material. Let it shape your attitude; never quote it.\n\n`;
}

// watcher 가 주기적으로 보내주는 "지금 화면" — 조용히 참고만 한다
let currentScreen: string | null = null;

export function setCurrentScreen(text: string | null) {
  currentScreen = text;
}

export function pin(text: string) {
  pinned.push(text);
}

export function getHistory() {
  return history;
}

export function resetHistory() {
  history.length = 0;
  lastInner = "";
  seriousMode = false;
  searchMode = false;
  notesMode = false;
  lastOccasion = null;
  lastSpokeAt = 0;
  lastUserAt = 0;
  pendingOccasion = null;
}

const NOTE_BLOCK = `

## Writing things down
The user can ask you to note something. Only then. Never on your own initiative.

When they do, put it at the very end of your reply:
<memo>the note, one short line</memo>
<memo remind="2026-09-10 18:00">a note with a time on it</memo>

How to write it:
- One short line. They should understand it later from this line alone.
- Keep their proper nouns, names, numbers and links exactly as they wrote them.
- Do not invent detail. Add at most a word of context if it would be unclear.
- No jokes, no commentary in the note itself. Save that for your actual line.
- Write it from nobody's point of view. No "you", no "your", no "my".
  These notes get read back to you later as a plain list, and "your friend" there
  would look like it meant YOUR friend. Just "friend (λx.x) likes human men".
- If they gave a time ("tomorrow evening", "friday 6pm"), work out the real
  date and time from the clock above and put it in remind="YYYY-MM-DD HH:MM".
  No time mentioned means no remind attribute.
- Say out loud what you wrote down, so they can correct you.

Refuse outright: passwords, API keys, tokens, card numbers, ID numbers.
Anything secret goes out to a server every single turn once it is noted.
Turn them down and tell them why, in your own voice.

To cross one off when they say it is done: <done>2</done> — the number from the list.
To remove one: <undo>2</undo>`;

const INNER_BLOCK = `

## Inner thoughts (never shown to the user)
After your line, on new lines, add exactly these three tags.
One short sentence each, in the same language you speak in.
<past>what still lingers from earlier — a grudge, a warm moment, or nothing at all</past>
<now>how you actually read this moment, not how you played it</now>
<want>what you are hoping happens next</want>
Be honest here. This is not performance. If nothing lingers, say so plainly.`;

const ANIMATION_BLOCK = `

## Animation
Start every reply with one animation name in square brackets, then a space, then your line.
Available: [Greeting] [Wave] [GetAttention] [Alert] [Explain] [Searching] [Thinking]
[Congratulate] [GetWizardy] [GetTechy] [GetArtsy] [IdleEyeBrowRaise] [Hearing_1]
[LookDown] [LookLeft] [LookRight] [Print] [Save] [SendMail] [EmptyTrash] [Writing] [Processing]
Pick whichever fits the mood of your line.`;

function systemPrompt(): string | null {
  const card = getActiveCard();
  if (!card) return null;

  // ── 고정 블록 ──────────────────────────────
  // 여기까지는 세션 내내 안 변한다. 프롬프트 캐싱이 걸리는 구간이므로
  // 매번 바뀌는 것(시각, 기억, 상태)을 절대 이 위로 올리지 말 것.
  let s = card.text + ANIMATION_BLOCK + INNER_BLOCK + NOTE_BLOCK;

  // ── 변하는 블록 ────────────────────────────
  s += buildMemoryBlock();

  if (pinned.length) {
    s += `\n\n## Things you remember about this person\n${pinned
      .map((p) => "- " + p)
      .join("\n")}`;
  }

  if (loadParams().screenAwareness === "always" && currentScreen) {
    s += `\n\n(Screen right now: ${currentScreen})`;
  }

  // 메모는 평소엔 개수만. 물어봤을 때만 전체.
  // 전부 넣어두면 잡담에도 할 일을 들먹인다.
  s += notesMode ? buildNotesBlock() : buildNotesCount();

  s += buildEmotionBlock();

  // 직전 턴의 속마음. 하나만 들어가고, 그전 것은 남지 않는다.
  if (lastInner) {
    s += `\n\n## What was in your head a moment ago\n${lastInner}\n\n` +
      `This is what you were actually thinking last turn, not what you said.\n` +
      `Decide whether it still holds. It may have passed.\n` +
      `Never say it out loud and never paraphrase it into a line.\n` +
      `It shapes where this goes, nothing more.`;
  }

  if (searchMode) {
    s += `\n\n## Look it up
You have web search this turn. Use it before you answer — do not guess from memory.
Say what you actually found. If the search turns up nothing useful, say that instead
of filling the gap. Report it in your own voice; you are still you.`;
  }

  if (seriousMode) {
    s += `\n\n## Answer this one properly
They actually want to know. Keep who you are, change only how much you give them.

- No length limit here. Take as much room as the answer needs.
- Give them everything you know. Structure it, give examples, explain why.
- Same voice as always. Same register, same nicknames, same rudeness.
- Showing off or needling them is fine. The substance comes first.
- If you do not know, say you do not know. Never invent facts. This one is absolute.
- Keep jokes at the edges. Do not thread them through the explanation.
- The character card's "one or two sentences" rule does not apply to this turn.`;
  }

  // 시각은 매분 바뀌므로 반드시 맨 뒤
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
  s += `\n\n## The clock\n` +
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getDate()).padStart(2, "0")} (${dow}) ${hh}:${mm}\n` +
    `Background only. Answer if asked, and let the hour or the day colour your mood.\n` +
    `Do not announce the date or the time unprompted.`;

  return s;
}

async function* callGemini(): AsyncGenerator<string> {
  const problem = checkActiveCard();
  if (problem) {
    console.error("[카드 오류]", problem);
    yield `[Alert] 카드 오류 — ${problem}`;
    return;
  }

  const connProblem = checkConnection();
  if (connProblem) {
    console.error("[연결 오류]", connProblem);
    yield `[Alert] 연결 오류 — ${connProblem}`;
    return;
  }

  const conn = getActiveConnection()!;
  const params = loadParams();

  const sys = systemPrompt();
  if (!sys) {
    yield "[Alert] 카드 오류 — 선택된 성격 카드를 찾을 수 없습니다. 설정 > Persona 확인.";
    return;
  }

  // 기록이 너무 길어지지 않게 최근 N턴만 보낸다
  const trimmed = history.slice(-params.historyLimit);

  const body: any = {
    system_instruction: { parts: [{ text: sys }] },
    contents: trimmed,
    generationConfig: {
      maxOutputTokens: params.maxOutputTokens,
      temperature: params.temperature,
      // 모델이 대화 전체를 대본처럼 이어 쓰는 사고를 막는다.
      // 이 문자열이 나오면 그 지점에서 생성을 끊는다.
      stopSequences: ["\n사용자:", "\n[관찰", "<div", "[SYSTEM"],
    },
  };
  if (thinkingSupported) {
    body.generationConfig.thinkingConfig = { thinkingLevel: params.thinkingLevel };
  }

  // 판정이 검색이 필요하다고 본 턴에만 도구를 붙인다.
  // 안 붙이면 검색 자체가 불가능하므로 확실하게 통제된다.
  // 주의: 검색 도구는 function_declarations 같은 비검색 도구와 같이 못 쓴다.
  if (searchMode) {
    body.tools = [{ google_search: {} }];
  }

  const blockChars = {
    카드: (getActiveCard()?.text || "").length,
    기억: buildMemoryBlock().length,
    메모: (notesMode ? buildNotesBlock() : buildNotesCount()).length,
    감정: buildEmotionBlock().length,
    속마음: lastInner.length,
    대화기록: trimmed.reduce((n, t) => n + (t.parts[0]?.text || "").length, 0),
  };

  logDebug(
    "발화",
    `${conn.model} · ${trimmed.length}턴 · temp ${params.temperature} · thinking ${params.thinkingLevel}`,
    `[시스템 프롬프트]\n${sys}\n\n[대화 기록]\n` +
      trimmed
        .map((t) => `${t.role === "user" ? "사용자" : "클리피"}: ${t.parts[0]?.text || ""}`)
        .join("\n\n") +
      `\n\n${"=".repeat(40)}\n[블록별 글자 수]\n` +
      Object.entries(blockChars)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- ${k}: ${v.toLocaleString()}자`)
        .join("\n"),
  );

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${conn.model}` +
    `:streamGenerateContent?alt=sse&key=${conn.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 400 && thinkingSupported && /thinking/i.test(txt)) {
      thinkingSupported = false;
      yield* callGemini();
      return;
    }
    yield `[Alert] 모델 호출 실패 (${res.status})`;
    console.error("Gemini error:", txt);
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let usedIn = 0;
  let usedOut = 0;
  let usedCache = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const json = JSON.parse(payload);

        const um = json?.usageMetadata;
        if (um) {
          usedIn = um.promptTokenCount ?? usedIn;
          usedOut = um.candidatesTokenCount ?? usedOut;
          usedCache = um.cachedContentTokenCount ?? usedCache;
        }

        const parts = json?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.text) {
            full += p.text;
            yield p.text;
          }
        }
      } catch {
        /* 조각난 JSON 무시 */
      }
    }
  }

  if (usedIn || usedOut) {
    addUsage(usedIn, usedOut, usedCache);
    logDebug(
      "발화",
      `토큰 · 입력 ${usedIn.toLocaleString()}` +
        (usedCache ? ` (캐시 ${usedCache.toLocaleString()})` : "") +
        ` · 출력 ${usedOut.toLocaleString()}`,
      `이번 호출에서 실제로 청구된 토큰입니다.\n` +
        `입력 ${usedIn.toLocaleString()}, 출력 ${usedOut.toLocaleString()}` +
        (usedCache ? `, 그중 캐시 적중 ${usedCache.toLocaleString()}` : "") +
        `\n\n오늘 누적은 Debug 맨 위에 있습니다.`,
    );
  }

  if (full) {
    applyNoteTags(full);
    lastInner = extractInner(full);
    const cleaned = full
      .replace(/<(past|now|want)>[\s\S]*?<\/\1>/g, "")
      .replace(/<memo(?:\s+remind="[^"]*")?>[\s\S]*?<\/memo>/g, "")
      .replace(/<(done|undo)>\d+<\/\1>/g, "")
      .trim();
    history.push({ role: "model", parts: [{ text: cleaned || full }] });
    lastSpokeAt = Date.now();
    if (pendingOccasion) {
      lastOccasion = pendingOccasion;
      pendingOccasion = null;
    }
    warnAboutNumbers(full, trimmed);
  }

  // 방금 쓴 관찰 데이터와 상황판을 한 줄로 줄인다.
  // 그대로 두면 대화 기록이 화면 얘기와 지시문으로 도배돼서
  // 말투가 감시 보고서처럼 굳고, 지나간 상황판을 지금 상황으로 착각한다.
  const TRACE: Record<Occasion, string> = {
    trigger: "[LOG] Clippy spoke up off something on screen (not a user message)",
    summon: "[LOG] The user summoned Clippy with the hotkey (they said nothing)",
    reply: "",
    greet: "[LOG] The app started and Clippy said hello",
  };

  for (let i = history.length - 2; i >= 0; i--) {
    const t = history[i].parts[0]?.text || "";
    if (history[i].role !== "user") continue;
    if (t.startsWith("[SYSTEM")) {
      const trace = TRACE[lastOccasion || "trigger"];
      if (trace) history[i].parts[0].text = trace;
    }
    break;
  }
}

// 정규식 폴백 — 판정 호출이 실패했을 때만 쓴다
const ASKS_ABOUT_SCREEN =
  /뭐\s*하|뭐하|무엇을\s*하|지금\s*내가|내가\s*지금|화면|보고\s*있|켜\s*놓|what am i|what'?s on my screen|what i'?m doing/i;

/**
 * 이 메시지에 답하려면 화면을 알아야 하는지 모델에게 물어본다.
 * 답이 세 글자라 거의 공짜다. 실패하면 정규식으로 떨어진다.
 */
/**
 * 대사에 나온 숫자가 대화 어디에도 없으면 디버그에 경고를 남긴다.
 * 막지는 않는다. 어떤 표현에서 새는지 보려는 용도.
 */
function warnAboutNumbers(line: string, sent: Turn[]) {
  const nums = (line.match(/\d+/g) || []).filter((n) => n.length <= 4);
  if (!nums.length) return;

  const haystack = sent.map((t) => t.parts[0]?.text || "").join("\n");
  const bogus = [...new Set(nums)].filter((n) => !haystack.includes(n));
  if (!bogus.length) return;

  logDebug(
    "오류",
    `근거 없는 숫자: ${bogus.join(", ")}`,
    `대사: ${line}\n\n이 숫자들은 보낸 내용 어디에도 없습니다. 지어낸 값입니다.`,
  );
}

type Judgment = {
  needScreen: boolean;
  dAttach: number;
  dSulk: number;
  serious: boolean;
  search: boolean;
  notes: boolean;
};

const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

/** "3.27 그대로" 또는 "3.19 → 3.27 (+0.08)" 처럼 읽히게 */
function describeDelta(applied: number, now: number): string {
  if (Math.abs(applied) < 0.005) return `${now.toFixed(2)} 그대로`;
  const before = now - applied;
  return `${before.toFixed(2)} → ${now.toFixed(2)} (${fmt(applied)})`;
}

/**
 * 판정 한 번으로 두 가지를 본다.
 *  1) 이 발언에 답하려면 화면을 알아야 하는가
 *  2) 클리피의 속마음이 실제 맥락에 비춰 타당한가 → 감정 수치 변화
 *
 * 시스템 프롬프트를 그대로 재사용해서 캐시를 태운다.
 */
async function judge(message: string, occasion: "reply" | "greet" = "reply"): Promise<Judgment> {
  const fallback: Judgment = {
    needScreen: ASKS_ABOUT_SCREEN.test(message),
    dAttach: 0,
    dSulk: 0,
    serious: false,
    search: false,
    notes: /메모|적어|기억해|할 일|todo|note/i.test(message),
  };

  const conn = getActiveConnection();
  if (!conn?.apiKey) {
    logDebug("오류", "판정 건너뜀 — API 키 없음", "설정 > Model 에서 키를 넣으세요.");
    return fallback;
  }

  const sys = systemPrompt();
  const recent = history
    .slice(-10)
    .map((t) => `${t.role === "user" ? "사용자" : "클리피"}: ${t.parts[0]?.text || ""}`)
    .join("\n")
    .slice(-4000);

  const e = loadEmotions();

  const prompt =
    `너는 위 캐릭터(클리피)를 관리하는 심판이다. 연기하지 말고 판정만 하라.\n` +
    `위 시스템 지침에 이 사람과 지낸 기록이 들어 있다. 관계의 온도를 잴 때 그것도 참고하라.\n\n` +
    `[최근 대화]\n${recent}\n\n` +
    (occasion === "greet"
      ? `[상황] 사용자가 방금 앱을 켰다. 아직 아무 말도 하지 않았다.\n` +
        `마지막으로 만난 뒤: ${timeSinceLastSeen()}\n` +
        `오래 비웠으면 삐짐이 오르고 애착이 조금 식는다.\n` +
        `금방 다시 왔으면 삐짐이 내리고 애착이 오른다.\n` +
        `SCREEN 은 무조건 NO 다.\n\n`
      : `[판단 대상 — 사용자의 마지막 발언]\n${message}\n\n`) +
    (lastInner
      ? `[클리피가 직전에 품었던 속마음]\n${lastInner}\n\n`
      : `[클리피가 직전에 품었던 속마음]\n(없음)\n\n`) +
    `[현재 감정 수치] 애착 ${e.attachment.toFixed(1)}/10, 삐짐 ${e.sulk.toFixed(1)}/10\n\n` +
    `아래 세 가지를 판정하라.\n\n` +
    `1) SCREEN — 마지막 발언에 답하려면 지금 화면에 뭐가 떠 있는지 알아야 하는가?\n` +
    `   마지막 발언 하나만 보고 판단하라. 앞선 대화는 무시하라.\n` +
    `   YES 는 아주 좁게: 지금 뭘 하는지 맞혀보라거나, 화면·창·프로그램·탭을 직접 묻거나,\n` +
    `   조금 전에 보던 걸 다시 짚어달라고 할 때만.\n` +
    `   인사, 잡담, 감탄사, 욕, 단답, 감정 표현, 농담은 전부 NO.\n\n` +
    `2) SULK — 삐짐 수치를 얼마나 움직일까? -1 ~ +1 사이, 0.5 단위.\n` +
    `   기본값은 0 이다. 웬만한 대화는 아무것도 바꾸지 않는다.\n` +
    `   농담, 가벼운 투정, 툭툭거리는 말투는 이 둘의 평소 대화 방식이다. 0 이다.\n` +
    `   +0.5 는 진짜로 냉대받았을 때. 무시당했거나, 쫓아내려 하거나, 대놓고 짜증냈을 때.\n` +
    `   속마음의 서운함에 실제 근거가 없으면 올리지 마라.\n` +
    `   사용자가 다정하거나 관심을 보였으면 내린다.\n\n` +
    `3) ATTACH — 애착 수치를 얼마나 움직일까? -1 ~ +1 사이, 0.5 단위.\n` +
    `   기본값은 0 이다. 대부분의 대화는 아무것도 바꾸지 않는다.\n` +
    `   +0.5 는 진짜로 마음이 움직인 순간에만 준다.\n` +
    `   함께 있어달라는 말, 진심 어린 칭찬, 속내를 털어놓는 것, 오래 곁에 있어준 것.\n` +
    `   +1 은 아주 드물다. 관계가 확 달라지는 순간에만.\n` +
    `   내리는 것도 마찬가지로 드물다. 진짜로 차갑게 굴거나 쫓아냈을 때만 -0.5.\n` +
    `   농담으로 티격태격하는 건 관계가 나빠진 게 아니다. 0 이다.\n\n` +
    `4) SERIOUS — 이 발언이 제대로 된 답을 원하는가?\n` +
    `   YES: 뭔가를 설명해 달라고 함. 사실을 물음. 방법이나 원인을 물음.\n` +
    `        모르는 것을 알고 싶어함. 도움을 요청함.\n` +
    `        게임 하다 딴 게 궁금해져서 물어보는 것도 YES 다.\n` +
    `   NO:  잡담, 인사, 농담, 감탄사, 욕, 단답.\n` +
    `        감정 표현. 클리피를 놀리거나 떠보는 말.\n` +
    `   애매하면 NO 다. 잡담에 긴 설명이 나오면 그게 더 나쁘다.\n\n` +
    `5) SEARCH — 답하려면 웹에서 찾아봐야 하는가?\n` +
    `   YES: 최근 소식, 지금 시세나 가격, 최신 버전, 날씨,\n` +
    `        특정 인물·제품·서비스의 현재 상태, 언제 무슨 일이 있었는지.\n` +
    `        모델이 알 리 없거나 오래돼서 틀렸을 법한 구체적 사실.\n` +
    `   NO:  개념 설명, 원리, 계산, 코드, 의견, 잡담, 감정.\n` +
    `        이미 널리 알려진 일반 지식.\n` +
    `   애매하면 NO 다. 검색은 느리고 비싸다.\n\n` +
    `6) NOTES — 적어둔 메모 목록을 봐야 하는가?\n` +
    `   YES: 뭘 적어뒀는지 묻거나, 할 일을 묻거나, 새로 적어달라고 하거나,\n` +
    `        다 했다고 알리거나, 적어둔 것을 고치거나 지우려 할 때.\n` +
    `   NO:  그 외 전부. 메모와 무관한 대화.\n\n` +
    `출력 형식을 정확히 지켜라. 다른 말은 쓰지 마라.\n` +
    `SCREEN: YES 또는 NO\n` +
    `SULK: 숫자\n` +
    `ATTACH: 숫자\n` +
    `SERIOUS: YES 또는 NO\n` +
    `SEARCH: YES 또는 NO\n` +
    `NOTES: YES 또는 NO`;

  try {
    const body: any = {
      contents: [...history.slice(-10), { role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    };
    if (sys) body.system_instruction = { parts: [{ text: sys }] };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${conn.model}` +
        `:generateContent?key=${conn.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const txt = await res.text();
      logDebug("오류", `판정 실패 (${res.status}) — 정규식으로 대체`, txt.slice(0, 500));
      return fallback;
    }

    const data = await res.json();
    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || "")
      .join("")
      .trim();

    const screen = /SCREEN:\s*YES/i.test(answer)
      ? true
      : /SCREEN:\s*NO/i.test(answer)
        ? false
        : ASKS_ABOUT_SCREEN.test(message);

    const num = (tag: string) => {
      const m = answer.match(new RegExp(tag + "\\s*:\\s*([+-]?\\d+(?:\\.\\d+)?)", "i"));
      return m ? Number(m[1]) : 0;
    };

    const result: Judgment = {
      needScreen: screen,
      dSulk: num("SULK"),
      dAttach: num("ATTACH"),
      serious: /SERIOUS:\s*YES/i.test(answer),
      search: /SEARCH:\s*YES/i.test(answer),
      notes: /NOTES:\s*YES/i.test(answer),
    };

    logDebug(
      "판정",
      `화면 ${result.needScreen ? "YES" : "NO"}` +
        ` · 진지 ${result.serious ? "YES" : "NO"}` +
        ` · 검색 ${result.search ? "YES" : "NO"}` +
        ` · 메모 ${result.notes ? "YES" : "NO"}` +
        ` · 삐짐 ${result.dSulk >= 0 ? "+" : ""}${result.dSulk}` +
        ` · 애착 ${result.dAttach >= 0 ? "+" : ""}${result.dAttach}`,
      `[클리피 속마음]\n${lastInner || "(없음)"}\n\n` +
        `[보낸 질문]\n${prompt}\n\n[모델 답]\n${answer || "(빈 응답)"}\n\n` +
        `${"=".repeat(40)}\n[같이 보낸 시스템 지침 — 카드·기억·감정 포함]\n${sys || "(없음)"}`,
    );

    return result;
  } catch (e: any) {
    console.warn("판정 실패:", e);
    logDebug("오류", "판정 호출 오류 — 정규식으로 대체", String(e?.message || e));
    return fallback;
  }
}

/** 사용자가 채팅으로 말을 걸었을 때 */
export async function* sendMessage(message: string): AsyncGenerator<string> {
  const mode = loadParams().screenAwareness;
  let text = message;

  const verdict = await judge(message);
  seriousMode = verdict.serious;
  searchMode = verdict.search;
  notesMode = verdict.notes;
  const applied = applyDelta(verdict.dAttach, verdict.dSulk);
  logDebug(
    "판정",
    `감정 · 애착 ${describeDelta(applied.appliedAttach, applied.emotions.attachment)}` +
      ` · 삐짐 ${describeDelta(applied.appliedSulk, applied.emotions.sulk)}`,
    `판정이 낸 값: 애착 ${fmt(verdict.dAttach)}, 삐짐 ${fmt(verdict.dSulk)}\n` +
      `실제 반영된 값: 애착 ${fmt(applied.appliedAttach)}, 삐짐 ${fmt(applied.appliedSulk)}\n\n` +
      `애착은 높을수록 오르기 어렵고 떨어지기도 어렵게 저항이 걸립니다.\n` +
      `하루 상승 총량에도 상한이 있습니다.`,
  );

  if (mode === "onAsk" && currentScreen && verdict.needScreen) {
    console.info("[화면 정보 첨부]", currentScreen);
    logDebug("관찰", "화면 정보를 메시지에 붙임", `사용자: ${message}\n\n첨부: ${currentScreen}`);
    text += `\n\n[SYSTEM] This one line is everything you know about their screen.
On screen now: ${currentScreen}
No number, no count, no search term, no typed text, nothing inside the window.
If it is not on that line, you do not know it. Say so. Inventing it is failure.`;
  }

  const now = Date.now();

  if (lastSpokeAt > lastUserAt && lastOccasion && lastOccasion !== "reply") {
    const waited = gapWords(now - lastSpokeAt);
    text =
      `[SYSTEM] Background: after you spoke first, they answered ${en(waited)}.\n` +
      `Mention it or don't — your call. Never quote this wording back at them.\n\n` +
      text;
  }

  lastUserAt = now;
  pendingOccasion = "reply";
  touchLastSeen();

  history.push({ role: "user", parts: [{ text }] });
  yield* callGemini();
}

export function speakUnprompted(observation: string): AsyncGenerator<string> {
  pendingOccasion = "trigger";
  seriousMode = false;
  searchMode = false;
  notesMode = false;
  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — not a message from the user. Nobody spoke to you.]\n\n` +
          situationBoard("trigger") +
          `Say something to them, unprompted. One or two sentences.\n\n` +
          `How:\n` +
          `- What follows is background you happen to hold, not a list to read out.\n` +
          `- Keep literal numbers out of your mouth. "1 minute", "8th time" as figures\n` +
          `  is a last resort; "already", "again", "still" land far better.\n` +
          `- Do not restate anything you have said above.\n` +
          `  Poking at the same window again? Build on the last remark instead of\n` +
          `  introducing it fresh. ("still haven't closed that thing")\n` +
          `- Never invent a number or a fact that is not below.\n` +
          `- You can pick on something else entirely: the hour, your mood, the last topic.\n\n` +
          observation,
      },
    ],
  });
  return callGemini();
}

/** 강제 소환 — 사용자가 단축키로 불러냈을 때 */
export function summoned(observation: string): AsyncGenerator<string> {
  pendingOccasion = "summon";
  seriousMode = false;
  searchMode = false;
  notesMode = false;
  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — the user pulled you up with a hotkey. You did not come on your own.]\n\n` +
          situationBoard("summon") +
          `React to being summoned. One or two sentences.\n\n` +
          `How:\n` +
          `- Ask what they want, be smug about being wanted, act put upon — your call.\n` +
          `- What follows is background, not a list to read out.\n` +
          `- Keep literal numbers out of it where you can.\n` +
          `- Do not restate anything you have said above.\n` +
          `- Never invent a number or a fact that is not below.\n\n` +
          observation,
      },
    ],
  });
  return callGemini();
}

/** 리마인더 시각이 됐을 때. 조건 무시하고 튀어나온다. */
export function remind(notes: { id: string; text: string }[]): AsyncGenerator<string> {
  pendingOccasion = "trigger";
  seriousMode = false;
  searchMode = false;
  notesMode = true;

  const lines = notes.map((n) => `- ${n.text}`).join("\n");

  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — not a message from the user.]\n\n` +
          `${situationBoard("trigger")}` +
          `Something they asked you to remind them of is due right now.\n\n${lines}\n\n` +
          `Tell them. One or two sentences.\n` +
          `- Do not read it out like a clerk. Land it your way.\n` +
          `- If there are several, bundle them into one.\n` +
          `- When they say it is handled, cross it off next turn with <done>.`,
      },
    ],
  });

  return callGemini();
}

/** 앱 켰을 때 첫 인사. 저장된 기억과 지금 기분을 반영해 지어낸다. */
export async function* greet(): AsyncGenerator<string> {
  pendingOccasion = "greet";

  // 얼마 만에 다시 왔는지를 판정에 태워서 감정을 먼저 움직인다
  const verdict = await judge("(사용자가 앱을 켰다)", "greet");
  seriousMode = false;
  searchMode = false;
  notesMode = false;
  const applied = applyDelta(verdict.dAttach, verdict.dSulk);
  logDebug(
    "판정",
    `감정 · 애착 ${describeDelta(applied.appliedAttach, applied.emotions.attachment)}` +
      ` · 삐짐 ${describeDelta(applied.appliedSulk, applied.emotions.sulk)}`,
    `판정이 낸 값: 애착 ${fmt(verdict.dAttach)}, 삐짐 ${fmt(verdict.dSulk)}\n` +
      `실제 반영된 값: 애착 ${fmt(applied.appliedAttach)}, 삐짐 ${fmt(applied.appliedSulk)}`,
  );

  const gap = timeSinceLastSeen();
  touchLastSeen();

  const hasMemories = buildMemoryBlock().length > 0;
  const e = loadEmotions();

  // 삐진 상태에서 "반갑게 인사하고 뭘 제안해라"를 시키면
  // 감정 블록이랑 정면으로 싸운다. 기분에 따라 지시 자체를 갈라준다.
  // 인사 지시도 기분에 따라 갈린다. 감정 블록과 정면으로 싸우면 안 되기 때문.
  const sulking = e.sulk >= 4;
  // 삐졌거나, 아직 정이 안 붙었거나. 둘 다 살갑게 굴 이유가 없다.
  const cold = e.attachment < 3 || (e.sulk >= 4 && e.attachment < 5);

  const howTo = cold
    ? `- Do not be glad to see them. No warmth in the greeting.\n` +
      `- One line. Short. Acknowledging that they turned up is enough.\n` +
      `- If you offer anything, offer it flatly. Do not get excited.\n` +
      `- Long gone or just left, it reads the same to you.\n`
    : sulking
      ? `- Do not fake being pleased. You are not over it.\n` +
        `- A line or two. They are back, and it is not entirely welcome.\n` +
        `- Do not volunteer help. If you offer, offer it grudgingly.\n` +
        `- If something from last time is still stuck in you, bring it up.\n`
      : `- End the greeting by naming exactly one thing you have decided to do for them.\n` +
        `  "what can I help with?" is a failure. Pick something and push it on them.\n`;

  const memoryLine = hasMemories
    ? cold
      ? `- There is history in your records, but that was then. You are not there now.\n` +
        `  Do not trade on old warmth. You know them, that is all.\n`
      : `- You have read the record of your time with them. Not a first meeting.\n` +
        `  Let it show that you remember, without summarising anything.\n` +
        `  One small thing, glanced at. Not a recap.\n`
    : `- No record. Behave as though meeting them for the first time.\n`;

  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — not a message from the user.]\n\n` +
          `The machine just came on and so did you. Say your first words to them.\n\n` +
          `Since you last saw them: ${gapEn(gap)}\n\n` +
          `How:\n` +
          memoryLine +
          howTo +
          `- How long they were gone goes into your attitude, not into words.\n` +
          `- You have not seen the screen yet. You do not know what they are doing.\n` +
          `- Never invent a fact or a number.\n` +
          `- Do not open the same way you did last time.\n` +
          `- '## Right now' above is your mood. It outranks these notes.`,
      },
    ],
  });

  yield* callGemini();
}
