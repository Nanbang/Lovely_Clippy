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

  return { text, animationKey };
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

      setStreamingText(filtered);
    }

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
