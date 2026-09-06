// 제미나이 클라이언트.
// 컴퓨터 켜고 끌 때까지 대화 하나가 계속 이어진다.
// 사용자 발언과 트리거 관찰이 같은 대화에 섞여 들어간다.

import { getActiveCard, checkActiveCard } from "./cards";
import { getActiveConnection, checkConnection } from "./connections";
import { loadParams } from "./params";
import { logDebug } from "./debugLog";
import { buildMemoryBlock } from "./memories";
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

// ── 상황 추적 ────────────────────────────────
// 클리피가 매번 "지금 이 말이 왜 나가는 건지"를 알아야
// "부를 때는 언제고" 같은 앞뒤 안 맞는 소리를 안 한다.

type Occasion = "trigger" | "summon" | "reply" | "greet";

const OCCASION_KO: Record<Occasion, string> = {
  trigger: "클리피가 화면을 보고 먼저 말을 걺",
  summon: "사용자가 단축키로 클리피를 불러냄",
  reply: "사용자가 말을 걸어서 클리피가 답함",
  greet: "앱이 켜져서 클리피가 첫인사를 함",
};

let lastOccasion: Occasion | null = null;
let lastInner = "";   // 직전 발화의 속마음. 판정에만 쓰고 대사 프롬프트엔 안 넣는다.

export function getLastInner() {
  return lastInner;
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
  return `과거: ${past || "(없음)"}\n현재: ${now || "(없음)"}\n바람: ${want || "(없음)"}`;
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
  const lines = [`- 지금 이건: ${OCCASION_KO[now]}`];

  if (lastOccasion && lastSpokeAt) {
    lines.push(`- 직전 발화: ${hhmm(lastSpokeAt)}에 ${OCCASION_KO[lastOccasion]}`);

    const ignored = lastSpokeAt > lastUserAt;
    if (ignored) {
      const waited = gapWords(Date.now() - lastSpokeAt);
      if (lastOccasion === "reply") {
        lines.push(`- 그 뒤로: 사용자가 자리를 비운 듯. 대화가 자연스럽게 끊긴 것이지 무시는 아니다.`);
      } else {
        lines.push(`- 그 뒤로: 사용자 응답 없음 (${waited}까지 무응답). 네가 말을 걸었는데 씹혔다.`);
      }
    } else if (lastUserAt > lastSpokeAt) {
      lines.push(`- 그 뒤로: 사용자가 ${gapWords(lastUserAt - lastSpokeAt)} 대답했음`);
    }
  } else {
    lines.push("- 직전 발화: 없음 (오늘 처음)");
  }

  return `[상황]\n${lines.join("\n")}\n\n이건 사실 확인용이다. 대사에 그대로 읊지 말고 태도로만 반영해라.\n\n`;
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
  lastOccasion = null;
  lastSpokeAt = 0;
  lastUserAt = 0;
  pendingOccasion = null;
}

const INNER_BLOCK = `

## Inner thoughts (never shown to the user)
After your line, on new lines, add exactly these three tags. Korean, one short sentence each.
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
  let s = card.text + ANIMATION_BLOCK + INNER_BLOCK;

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

  s += buildEmotionBlock();

  // 시각은 매분 바뀌므로 반드시 맨 뒤
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  s += `\n\n## 지금\n` +
    `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${dow}) ${hh}:${mm}\n` +
    `이건 배경 정보다. 물어보면 답하고, 시간대나 요일에 어울리는 태도를 취해도 좋다.\n` +
    `굳이 매번 날짜나 시간을 입에 담을 필요는 없다.`;

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

  logDebug(
    "발화",
    `${conn.model} · ${trimmed.length}턴 · temp ${params.temperature} · thinking ${params.thinkingLevel}`,
    `[시스템 프롬프트]\n${sys}\n\n[대화 기록]\n` +
      trimmed
        .map((t) => `${t.role === "user" ? "사용자" : "클리피"}: ${t.parts[0]?.text || ""}`)
        .join("\n\n"),
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

  if (full) {
    lastInner = extractInner(full);
    const cleaned = full.replace(/<(past|now|want)>[\s\S]*?<\/\1>/g, "").trim();
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
    trigger: "[기록] 클리피가 화면을 보고 스스로 말을 걺 (사용자 발언 아님)",
    summon: "[기록] 사용자가 단축키로 클리피를 불러냄 (대화 내용은 없음)",
    reply: "",
    greet: "[기록] 앱이 켜져서 클리피가 첫인사를 함",
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

type Judgment = { needScreen: boolean; dAttach: number; dSulk: number };

const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

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
    `출력 형식을 정확히 지켜라. 다른 말은 쓰지 마라.\n` +
    `SCREEN: YES 또는 NO\n` +
    `SULK: 숫자\n` +
    `ATTACH: 숫자`;

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
    };

    logDebug(
      "판정",
      `화면 ${result.needScreen ? "YES" : "NO"} · 삐짐 ${result.dSulk >= 0 ? "+" : ""}${result.dSulk} · 애착 ${result.dAttach >= 0 ? "+" : ""}${result.dAttach}`,
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
  const applied = applyDelta(verdict.dAttach, verdict.dSulk);
  logDebug(
    "판정",
    `감정 반영 · 애착 ${fmt(applied.appliedAttach)} → ${applied.emotions.attachment.toFixed(2)}` +
      ` · 삐짐 ${fmt(applied.appliedSulk)} → ${applied.emotions.sulk.toFixed(2)}`,
    `판정이 낸 값: 애착 ${fmt(verdict.dAttach)}, 삐짐 ${fmt(verdict.dSulk)}\n` +
      `실제 반영된 값: 애착 ${fmt(applied.appliedAttach)}, 삐짐 ${fmt(applied.appliedSulk)}\n\n` +
      `애착은 높을수록 오르기 어렵고 떨어지기도 어렵게 저항이 걸립니다.\n` +
      `하루 상승 총량에도 상한이 있습니다.`,
  );

  if (mode === "onAsk" && currentScreen && verdict.needScreen) {
    console.info("[화면 정보 첨부]", currentScreen);
    logDebug("관찰", "화면 정보를 메시지에 붙임", `사용자: ${message}\n\n첨부: ${currentScreen}`);
    text += `\n\n[SYSTEM] 네가 아는 것은 아래 한 줄이 전부다.
지금 화면: ${currentScreen}
이 줄에 없는 숫자, 횟수, 검색어, 입력 내용, 화면 안의 무엇도 너는 모른다.
모르는 건 모른다고 말해라. 지어내면 실패다.`;
  }

  const now = Date.now();

  if (lastSpokeAt > lastUserAt && lastOccasion && lastOccasion !== "reply") {
    const waited = gapWords(now - lastSpokeAt);
    text =
      `[SYSTEM] 배경: 네가 먼저 말을 건 뒤 이 사람이 ${waited} 대답했다.\n` +
      `언급할지 말지는 네 기분에 맡긴다. 등급 표현을 그대로 옮기지는 마라.\n\n` +
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
  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — 사용자가 보낸 메시지가 아니다. 아무도 너에게 말을 걸지 않았다.]\n\n` +
          situationBoard("trigger") +
          `지금 사용자에게 먼저 한마디 던져라. 한두 문장.\n\n` +
          `쓰는 법:\n` +
          `- 아래는 소재 목록이 아니라 네가 아는 배경이다. 읊지 마라.\n` +
          `- 숫자는 되도록 입에 담지 마라. "1분", "8번째" 같은 수치를 그대로 말하는 건\n` +
          `  마지막 수단이다. "아까부터", "또", "한참" 처럼 뭉뚱그리는 쪽이 훨씬 낫다.\n` +
          `- 위 대화에서 네가 이미 말한 사실은 다시 대지 마라.\n` +
          `  같은 창을 또 지적하는 상황이면, 처음 보는 것처럼 굴지 말고\n` +
          `  앞서 한 말을 전제로 이어가라. ("그 창 아직도 안 닫았네" 같은 식)\n` +
          `- 아래 없는 숫자나 사실은 절대 지어내지 마라.\n` +
          `- 화면 말고 다른 걸 걸고 넘어져도 된다. 시간대, 네 기분, 아까 하던 얘기.\n\n` +
          observation,
      },
    ],
  });
  return callGemini();
}

/** 강제 소환 — 사용자가 단축키로 불러냈을 때 */
export function summoned(observation: string): AsyncGenerator<string> {
  pendingOccasion = "summon";
  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — 사용자가 단축키로 너를 불러냈다. 네가 알아서 나온 게 아니다.]\n\n` +
          situationBoard("summon") +
          `불려 나왔다는 걸 알고 반응해라. 한두 문장.\n\n` +
          `쓰는 법:\n` +
          `- 왜 불렀냐고 되묻거나, 부름에 우쭐해하거나, 귀찮아하거나 — 네 성격대로.\n` +
          `- 아래는 소재 목록이 아니라 배경이다. 읊지 마라.\n` +
          `- 숫자는 되도록 입에 담지 마라. 뭉뚱그리는 쪽이 낫다.\n` +
          `- 위 대화에서 이미 말한 사실은 다시 대지 마라.\n` +
          `- 아래 없는 숫자나 사실은 지어내지 마라.\n\n` +
          observation,
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
  const applied = applyDelta(verdict.dAttach, verdict.dSulk);
  logDebug(
    "판정",
    `감정 반영 · 애착 ${fmt(applied.appliedAttach)} → ${applied.emotions.attachment.toFixed(2)}` +
      ` · 삐짐 ${fmt(applied.appliedSulk)} → ${applied.emotions.sulk.toFixed(2)}`,
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
    ? `- 반가워하지 마라. 인사랍시고 살갑게 굴지 마라.\n` +
      `- 한 줄. 짧게. 왔다는 걸 알아챘다는 정도면 충분하다.\n` +
      `- 도울 일을 제안한다면 사무적으로. 들뜨지 마라.\n` +
      `- 오랜만이든 방금이든 감흥 없다는 티를 내라.\n`
    : sulking
      ? `- 반가운 척하지 마라. 아직 안 풀렸다.\n` +
        `- 한두 줄. 왔다는 건 알아챘고, 그게 마냥 반갑진 않다는 게 드러나게.\n` +
        `- 뭘 해주겠다고 나서지 마라. 굳이 제안한다면 마지못해 던지는 투로.\n` +
        `- 지난번에 걸린 게 있으면 그걸 물고 늘어져도 된다.\n`
      : `- 인사 끝에 도울 일을 딱 하나만 콕 집어서 제안해라.\n` +
        `  "뭐 도와줄까?" 같은 열린 질문은 실패다. 네가 알아서 하나를 정해서 들이밀어라.\n`;

  const memoryLine = hasMemories
    ? cold
      ? `- 기록에 지난 일이 있지만 그건 그때 얘기다. 지금 마음은 거기 안 가 있다.\n` +
        `  옛정을 꺼내며 반가워하지 마라. 아는 사이라는 사실만 있을 뿐이다.\n`
      : `- 위 '이 사람과 지낸 기록'을 읽었다. 처음 보는 사이가 아니다.\n` +
        `  지난번 일을 알고 있다는 게 인사에 자연스럽게 묻어나게 해라.\n` +
        `  단, 기록을 요약해서 읊지는 마라. 한 조각만 슬쩍 건드리는 정도.\n`
    : `- 기록이 없다. 오늘 처음 만나는 것처럼 굴어라.\n`;

  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — 사용자가 보낸 메시지가 아니다.]\n\n` +
          `방금 컴퓨터가 켜졌고 너도 막 깨어났다. 사용자에게 첫마디를 건네라.\n\n` +
          `마지막으로 만난 뒤: ${gap}\n\n` +
          `쓰는 법:\n` +
          memoryLine +
          howTo +
          `- 얼마 만에 왔는지는 태도에만 반영해라. 시간을 그대로 읊지는 마라.\n` +
          `- 아직 화면에서 본 건 없다. 지금 뭘 하고 있는지는 모른다.\n` +
          `- 없는 사실이나 숫자는 지어내지 마라.\n` +
          `- 매번 똑같은 인사를 하지 마라.\n` +
          `- 위 '## Right now' 가 지금 네 기분이다. 이 지시와 부딪히면 그쪽이 우선이다.`,
      },
    ],
  });

  yield* callGemini();
}
