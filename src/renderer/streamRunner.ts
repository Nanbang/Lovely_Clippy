// 스트리밍을 화면 컴포넌트 밖에서 돌린다.
// 설정 화면을 보고 있거나 대화창을 닫아둬도 클리피가 말할 수 있어야 하기 때문.

import { ANIMATION_KEYS_BRACKETS } from "./clippy-animation-helpers";

export type StreamHandlers = {
  setStatus: (s: any) => void;
  setAnimationKey: (k: string) => void;
  addMessage: (m: any) => void;
};

let busy = false;
let streamingText = "";
const subscribers = new Set<() => void>();

export const isBusy = () => busy;
export const getStreamingText = () => streamingText;

export function subscribeStream(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function setStreamingText(text: string) {
  streamingText = text;
  subscribers.forEach((fn) => fn());
}

/**
 * 응답 맨 앞의 [애니메이션이름] 을 떼어내고 본문만 남긴다.
 * 목록에 없는 이름을 지어내는 경우도 잘라낸다.
 */
export function filterMessageContent(content: string): {
  text: string;
  animationKey: string;
} {
  let text = content;
  let animationKey = "";

  if (content === "[") {
    text = "";
  } else if (/^\[[A-Za-z]*$/m.test(content)) {
    text = content.replace(/^\[[A-Za-z]*$/m, "").trim();
  } else {
    let matched = false;
    for (const key of ANIMATION_KEYS_BRACKETS) {
      if (content.startsWith(key)) {
        animationKey = key.slice(1, -1);
        text = content.slice(key.length).trim();
        matched = true;
        break;
      }
    }

    if (!matched) {
      const stray = content.match(/^\[[A-Za-z_][A-Za-z0-9_]*\]\s*/);
      if (stray) {
        console.warn("알 수 없는 애니메이션 이름:", stray[0].trim());
        text = content.slice(stray[0].length).trim();
      }
    }
  }

  // 모델이 한 응답에 대사를 여러 덩어리로 쓰면서 태그를 또 붙이는 경우가 있다.
  // 맨 앞 것만 애니메이션으로 쓰고, 나머지는 화면에 안 보이게 지운다.
  text = stripInlineTags(text);

  return { text, animationKey };
}

/** 본문 어디에 있든 [애니메이션이름] 형태를 지운다 */
function stripInlineTags(text: string): string {
  return text
    .replace(/\[[A-Za-z_][A-Za-z0-9_]*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t]+/, ""))
    .join("\n")
    .trim();
}

// 모델이 여기서부터 딴 사람 대사를 쓰기 시작했다는 신호들.
// stopSequences 로 대부분 막히지만 새어 나온 것도 잘라낸다.
const CUT_MARKERS = [
  "<past>",
  "<now>",
  "<want>",
  "\n사용자:",
  "\n클리피:",
  "[관찰 데이터]",
  "[SYSTEM",
  "<div",
  "</div",
  "<br",
];

function cutRunaway(text: string): string {
  let out = text;
  for (const m of CUT_MARKERS) {
    const i = out.indexOf(m);
    if (i >= 0) out = out.slice(0, i);
  }
  return out.trim();
}

export async function runStream(
  gen: AsyncGenerator<string>,
  h: StreamHandlers,
): Promise<void> {
  if (busy) return;
  busy = true;

  setStreamingText("");
  h.setStatus("thinking");

  let full = "";
  let filtered = "";
  let gotAnimation = false;

  try {
    for await (const chunk of gen) {
      if (full === "") h.setStatus("responding");

      if (!gotAnimation) {
        const result = filterMessageContent(full + chunk);
        filtered = result.text;
        full += chunk;
        if (result.animationKey) {
          h.setAnimationKey(result.animationKey);
          gotAnimation = true;
        }
      } else {
        filtered += chunk;
      }

      // 첫 태그를 찾은 뒤로는 filterMessageContent 를 안 거치므로
      // 여기서 매번 태그를 걷어내야 두 번째, 세 번째 태그도 잡힌다.
      //
      // 화면에 보여줄 때만 잘라낸다. 루프를 break 하면 안 된다.
      // 제너레이터가 중간에 닫히면 gemini 쪽에서 속마음을 뽑고
      // 대화 기록에 답변을 넣는 코드가 통째로 실행되지 않는다.
      setStreamingText(cutRunaway(stripInlineTags(filtered)));
    }

    filtered = cutRunaway(stripInlineTags(filtered));

    if (filtered.trim()) {
      h.addMessage({
        id: crypto.randomUUID(),
        content: filtered,
        sender: "clippy",
        createdAt: Date.now(),
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    setStreamingText("");
    h.setStatus("idle");
    busy = false;
  }
}
