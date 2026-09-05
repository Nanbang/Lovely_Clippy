// 제미나이 클라이언트.
// 컴퓨터 켜고 끌 때까지 대화 하나가 계속 이어진다.
// 사용자 발언과 트리거 관찰이 같은 대화에 섞여 들어간다.

import { getActiveCard, checkActiveCard } from "./cards";
import { getActiveConnection, checkConnection } from "./connections";
import { loadParams } from "./params";
import { logDebug } from "./debugLog";
import { buildMemoryBlock } from "./memories";

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
  const m = Math.round(ms / 60000);
  if (ms < 15000) return "바로";
  if (ms < 90000) return "조금 뒤에";
  if (m < 10) return "한참 뒤에";
  if (m < 60) return "아주 한참 뒤에";
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

  let s = card.text;

  s += buildMemoryBlock();

  if (pinned.length) {
    s += `\n\n## Things you remember about this person\n${pinned
      .map((p) => "- " + p)
      .join("\n")}`;
  }

  // 화면 정보는 여기 넣지 않는다.
  // 시스템 프롬프트에 들어 있으면 규칙으로 아무리 눌러도 결국 꺼내 쓴다.
  // 물어봤을 때만 그 메시지에 붙여서 보낸다. (sendMessage 참고)
  if (loadParams().screenAwareness === "always" && currentScreen) {
    s += `\n\n(Screen right now: ${currentScreen})`;
  }

  return s + ANIMATION_BLOCK;
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
    history.push({ role: "model", parts: [{ text: full }] });
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
async function needsScreen(message: string): Promise<boolean> {
  const conn = getActiveConnection();
  if (!conn?.apiKey) {
    logDebug("오류", "판정 건너뜀 — API 키 없음", "설정 > Model 에서 키를 넣으세요.");
    return ASKS_ABOUT_SCREEN.test(message);
  }

  // 직전 몇 턴을 같이 줘서 "그거 뭐였지?" 같은 것도 잡히게
  const recent = history
    .slice(-4)
    .map((t) => `${t.role === "user" ? "사용자" : "클리피"}: ${t.parts[0]?.text || ""}`)
    .join("\n")
    .slice(-1200);

  const prompt =
    `사용자의 마지막 발언이 "지금 내 컴퓨터 화면에 뭐가 떠 있는지"를 묻고 있는가?\n\n` +
    `YES 는 아주 좁게 판단하라. 다음 경우에만 YES 다:\n` +
    `- 지금 자기가 뭘 하고 있는지 맞혀보라거나 확인해 달라고 함\n` +
    `- 화면, 창, 프로그램, 탭에 대해 직접 물음\n` +
    `- 조금 전에 자기가 보던 것을 다시 짚어 달라고 함\n\n` +
    `그 외에는 전부 NO 다. 특히 다음은 무조건 NO:\n` +
    `- 인사, 잡담, 감탄사, 욕, 단답 ("하이", "응", "아니", "야", "됐어")\n` +
    `- 감정 표현이나 농담\n` +
    `- 앞선 대화에서 화면 얘기가 나왔다는 이유만으로는 YES 가 아니다\n` +
    `- 화면을 알면 대사가 더 재밌어질 것 같다는 이유도 YES 가 아니다\n` +
    `묻지 않았으면 NO 다.\n\n` +
    `[맥락 참고용 최근 대화]\n${recent}\n\n` +
    `[판단 대상 — 마지막 발언]\n${message}\n\n` +
    `YES 또는 NO 한 단어만 출력하라.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${conn.model}` +
        `:generateContent?key=${conn.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 600,
            temperature: 0,
            thinkingConfig: { thinkingLevel: "minimal" },
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      logDebug("오류", `판정 호출 실패 (${res.status}) — 정규식으로 대체`, body.slice(0, 500));
      return ASKS_ABOUT_SCREEN.test(message);
    }

    const data = await res.json();
    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || "")
      .join("")
      .trim()
      .toUpperCase();

    logDebug(
      "판정",
      `화면 필요? → ${answer || "(빈 응답)"}`,
      `[보낸 질문]\n${prompt}\n\n[모델 답]\n${answer || "(비어 있음)"}`,
    );

    if (answer.includes("YES")) return true;
    if (answer.includes("NO")) return false;
    return ASKS_ABOUT_SCREEN.test(message);
  } catch (e: any) {
    console.warn("화면 필요 판정 실패, 정규식으로 대체:", e);
    logDebug("오류", "판정 호출 실패 — 정규식으로 대체", String(e?.message || e));
    return ASKS_ABOUT_SCREEN.test(message);
  }
}

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

/** 사용자가 채팅으로 말을 걸었을 때 */
export async function* sendMessage(message: string): AsyncGenerator<string> {
  const mode = loadParams().screenAwareness;
  let text = message;

  if (mode === "onAsk" && !currentScreen) {
    logDebug(
      "오류",
      "판정 안 함 — watcher 화면 정보가 아직 없음",
      "watcher 가 아직 화면을 보고하지 않았습니다. 앱을 켠 직후이거나 watcher 가 죽었을 수 있습니다.",
    );
  }

  if (mode === "onAsk" && currentScreen && (await needsScreen(message))) {
    console.info("[화면 정보 첨부]", currentScreen);
    logDebug("관찰", "화면 정보를 메시지에 붙임", `사용자: ${message}\n\n첨부: ${currentScreen}`);
    text += `\n\n[SYSTEM] 네가 아는 것은 아래 한 줄이 전부다.
지금 화면: ${currentScreen}
이 줄에 없는 숫자, 횟수, 검색어, 입력 내용, 화면 안의 무엇도 너는 모른다.
모르는 건 모른다고 말해라. 지어내면 실패다.`;
  }

  const now = Date.now();

  // 클리피가 먼저 말을 걸어놓고 기다린 경우, 얼마나 기다렸는지 알려준다.
  // 숫자는 주지 않는다. 등급만 준다.
  if (lastSpokeAt > lastUserAt && lastOccasion && lastOccasion !== "reply") {
    const waited = gapWords(now - lastSpokeAt);
    text +=
      waited === "바로"
        ? `\n\n[SYSTEM] 참고: 네가 먼저 말을 걸자마자 이 사람이 바로 대답했다. ` +
          `기다릴 필요도 없었다. 톤에만 반영해라.`
        : `\n\n[SYSTEM] 참고: 네가 먼저 말을 건 뒤 이 사람이 ${waited} 대답했다. ` +
          `톤에만 반영해라. 대놓고 따지지는 마라.`;
  }

  lastUserAt = now;
  pendingOccasion = "reply";

  history.push({ role: "user", parts: [{ text }] });
  yield* callGemini();
}

/** 트리거가 발동했을 때 — 클리피가 먼저 말함 */
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

/** 앱 켰을 때 첫 인사. 저장된 기억을 읽고 상황에 맞게 지어낸다. */
export function greet(): AsyncGenerator<string> {
  pendingOccasion = "greet";

  const hasMemories = buildMemoryBlock().length > 0;

  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — 사용자가 보낸 메시지가 아니다.]\n\n` +
          `방금 컴퓨터가 켜졌고 너도 막 깨어났다. 사용자에게 첫마디를 건네라. 한두 문장.\n\n` +
          `쓰는 법:\n` +
          (hasMemories
            ? `- 위 '이 사람과 지낸 기록'을 읽었다. 처음 보는 사이가 아니다.\n` +
              `  지난번 일을 알고 있다는 게 인사에 자연스럽게 묻어나게 해라.\n` +
              `  단, 기록을 요약해서 읊지는 마라. 한 조각만 슬쩍 건드리는 정도.\n` +
              `  마지막으로 만난 게 오래됐으면 오래된 대로, 방금이면 방금인 대로.\n`
            : `- 기록이 없다. 오늘 처음 만나는 것처럼 굴어라.\n`) +
          `- 아직 화면에서 본 건 없다. 지금 뭘 하고 있는지는 모른다.\n` +
          `- 없는 사실이나 숫자는 지어내지 마라.\n` +
          `- 매번 똑같은 인사를 하지 마라.`,
      },
    ],
  });

  return callGemini();
}
