// 대화 요약 생성. 저장 창에서 짧게/중간/길게 버튼을 누르면 호출된다.

import { getActiveConnection, checkConnection } from "./connections";
import { loadParams } from "./params";
import { getHistory } from "./gemini";
import { logDebug } from "./debugLog";
import { Memory, MemoryLength } from "./memories";

const SPEC: Record<"short" | "medium" | "long", string> = {
  short: "3~4문장. 오늘 무엇을 했고 어떤 분위기였는지만.",
  medium: "8~12문장. 무슨 얘기를 했는지, 사용자가 주로 뭘 하고 있었는지, 기억할 만한 순간.",
  long: "20문장 안팎. 대화 흐름을 따라가며 구체적으로. 인상적인 발언은 짧게 인용해도 좋다.",
};

/** gemini.ts 의 대화 기록을 사람이 읽을 수 있는 형태로 */
export function buildTranscript(): string {
  return getHistory()
    .map((t) => {
      const text = t.parts[0]?.text || "";
      if (t.role === "model") return `클리피: ${text}`;
      if (text.startsWith("[SYSTEM") || text.startsWith("[기록]")) {
        return `(${text.split("\n")[0].slice(0, 60)})`;
      }
      return `사용자: ${text}`;
    })
    .join("\n");
}

async function callModel(prompt: string): Promise<string> {
  const problem = checkConnection();
  if (problem) throw new Error(problem);

  const conn = getActiveConnection()!;
  const params = loadParams();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${conn.model}` +
      `:generateContent?key=${conn.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.4,
          thinkingConfig: { thinkingLevel: params.thinkingLevel },
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    logDebug("오류", `요약 실패 (${res.status})`, body.slice(0, 500));
    throw new Error(`모델 호출 실패 (${res.status})`);
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p.text || "")
    .join("")
    .trim();

  if (!text) throw new Error("빈 응답을 받았습니다.");
  return text;
}

/** 지금 세션을 요약한다. */
export async function summarizeSession(
  length: "short" | "medium" | "long",
  startedAt: number,
  endedAt: number,
): Promise<string> {
  const transcript = buildTranscript();
  if (!transcript.trim()) throw new Error("요약할 대화가 없습니다.");

  const stamp = (t: number) =>
    new Date(t).toLocaleString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  const prompt =
    `아래는 사용자와 클리피(데스크톱 비서 캐릭터)가 나눈 대화 기록이다.\n` +
    `이걸 나중에 클리피가 읽을 '기억'으로 요약하라.\n\n` +
    `분량: ${SPEC[length]}\n\n` +
    `규칙:\n` +
    `- 3인칭 관찰 기록처럼 담백하게. 캐릭터 연기하지 마라.\n` +
    `- 사용자가 뭘 하고 있었는지, 무슨 얘기를 했는지, 어떤 반응이었는지 위주로.\n` +
    `- 대화 기록에 없는 내용은 절대 지어내지 마라.\n` +
    `- (괄호) 로 표시된 시스템 기록은 맥락 참고용이니 그대로 옮기지 마라.\n` +
    `- 맨 앞에 "${stamp(startedAt)}에 시작" 을, 맨 끝에 "${stamp(endedAt)}에 종료" 를 한 줄씩 넣어라.\n` +
    `- 요약문만 출력하라. 머리말이나 설명은 붙이지 마라.\n\n` +
    `[대화 기록]\n${transcript}`;

  return callModel(prompt);
}

/** 여러 기억을 하나로 합친다. */
export async function summarizeMerge(
  length: "short" | "medium" | "long",
  memories: Memory[],
): Promise<string> {
  if (!memories.length) throw new Error("합칠 기억이 없습니다.");

  const body = memories
    .map((m, i) => `[${i + 1}]\n${m.text}`)
    .join("\n\n");

  const prompt =
    `아래는 여러 날에 걸친 기억 조각들이다. 하나로 합쳐서 다시 요약하라.\n\n` +
    `분량: ${SPEC[length]}\n\n` +
    `규칙:\n` +
    `- 반복되는 내용은 묶고, 시간 흐름이 드러나게 정리하라.\n` +
    `- 여러 날에 걸쳐 반복된 패턴이 있으면 그걸 명시하라.\n` +
    `- 없는 내용을 지어내지 마라.\n` +
    `- 요약문만 출력하라.\n\n` +
    body;

  return callModel(prompt);
}
