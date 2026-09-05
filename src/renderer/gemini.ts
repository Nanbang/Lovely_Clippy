// 제미나이 클라이언트.
// 컴퓨터 켜고 끌 때까지 대화 하나가 계속 이어진다.
// 사용자 발언과 트리거 관찰이 같은 대화에 섞여 들어간다.

import { PERSONA } from "./persona";

const MODEL = "gemini-3-flash-preview";
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

type Turn = { role: "user" | "model"; parts: { text: string }[] };

// 세션 대화 기록. 앱 켜져 있는 동안 계속 쌓인다.
const history: Turn[] = [];

// 핀으로 고정한 것들 (나중에 파일 저장 붙일 자리)
const pinned: string[] = [];

let thinkingSupported = true;

export function pin(text: string) {
  pinned.push(text);
}

export function getHistory() {
  return history;
}

export function resetHistory() {
  history.length = 0;
}

function systemPrompt(): string {
  let s = PERSONA;

  if (pinned.length) {
    s += `\n\n## Things you remember about this person\n${pinned.map((p) => "- " + p).join("\n")}`;
  }

  s += `\n\n## Animation
Start every reply with one animation name in square brackets, then a space, then your line.
Available: [Greeting] [Wave] [GetAttention] [Alert] [Explain] [Searching] [Thinking]
[Congratulate] [GetWizardy] [GetTechy] [GetArtsy] [IdleEyeBrowRaise] [Hearing_1]
[LookDown] [LookLeft] [LookRight] [Print] [Save] [SendMail] [EmptyTrash] [Writing] [Processing]
Pick whichever fits the mood of your line. Example: [IdleEyeBrowRaise] 포챈 세 시간째네.`;

  return s;
}

/**
 * 트리거가 감지한 상황을 대화에 밀어넣는다.
 * 사용자가 말한 게 아니라 클리피가 '본' 것이므로 관찰로 표시한다.
 */
export function pushObservation(observation: string) {
  history.push({
    role: "user",
    parts: [
      {
        text:
          `[SYSTEM — 사용자가 보낸 메시지가 아님. 네가 화면에서 직접 관찰한 내용이다.]\n` +
          observation +
          `\n\n이걸 보고 사용자에게 먼저 말을 걸어라. 관찰 데이터에 없는 숫자는 절대 지어내지 마라.`,
      },
    ],
  });
}

async function* callGemini(): AsyncGenerator<string> {
  if (!API_KEY) {
    yield "[Alert] API 키가 없어. .env 파일에 VITE_GEMINI_API_KEY를 넣어줘.";
    return;
  }

  const body: any = {
    system_instruction: { parts: [{ text: systemPrompt() }] },
    contents: history,
    generationConfig: { maxOutputTokens: 2000, temperature: 1.3 },
  };
  if (thinkingSupported) {
    body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}` +
    `:streamGenerateContent?alt=sse&key=${API_KEY}`;

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
        // 조각난 JSON은 무시
      }
    }
  }

  if (full) history.push({ role: "model", parts: [{ text: full }] });
}

/** 사용자가 채팅으로 말을 걸었을 때 */
export function sendMessage(message: string): AsyncGenerator<string> {
  history.push({ role: "user", parts: [{ text: message }] });
  return callGemini();
}

/** 트리거가 발동했을 때 — 클리피가 먼저 말함 */
export function speakUnprompted(observation: string): AsyncGenerator<string> {
  pushObservation(observation);
  return callGemini();
}

/** 앱 켰을 때 첫 인사 */
export function greet(): AsyncGenerator<string> {
  history.push({
    role: "user",
    parts: [
      {
        text:
          "[SYSTEM] 방금 컴퓨터가 켜졌고 너도 막 깨어났다. " +
          "사용자에게 첫인사를 건네라. 짧게. 아직 화면에서 본 건 없다.",
      },
    ],
  });
  return callGemini();
}
