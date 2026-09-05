import { useState, useEffect, useRef, useCallback } from "react";

import { Message } from "./Message";
import { ChatInput } from "./ChatInput";
import { ANIMATION_KEYS_BRACKETS } from "../clippy-animation-helpers";
import { useChat } from "../contexts/ChatContext";
import { sendMessage, greet, speakUnprompted } from "../gemini";

export type ChatProps = {
  style?: React.CSSProperties;
};

export function Chat({ style }: ChatProps) {
  const { setAnimationKey, setStatus, status, messages, addMessage } =
    useChat();
  const [streamingMessageContent, setStreamingMessageContent] =
    useState<string>("");
  const greetedRef = useRef(false);
  const busyRef = useRef(false);

  /**
   * 스트림 하나를 받아서 화면에 흘리고 메시지로 저장한다.
   * 사용자 발언 / 첫인사 / 트리거 발화 모두 이걸 거친다.
   */
  const runStream = useCallback(
    async (gen: AsyncGenerator<string>) => {
      if (busyRef.current) return;
      busyRef.current = true;

      setStreamingMessageContent("");
      setStatus("thinking");

      let full = "";
      let filtered = "";
      let gotAnimation = false;

      try {
        for await (const chunk of gen) {
          if (full === "") setStatus("responding");

          if (!gotAnimation) {
            const result = filterMessageContent(full + chunk);
            filtered = result.text;
            full += chunk;
            if (result.animationKey) {
              setAnimationKey(result.animationKey);
              gotAnimation = true;
            }
          } else {
            filtered += chunk;
          }

          setStreamingMessageContent(filtered);
        }

        if (filtered.trim()) {
          addMessage({
            id: crypto.randomUUID(),
            content: filtered,
            sender: "clippy",
            createdAt: Date.now(),
          });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setStreamingMessageContent("");
        setStatus("idle");
        busyRef.current = false;
      }
    },
    [addMessage, setAnimationKey, setStatus],
  );

  // 앱 켜면 클리피가 먼저 인사
  useEffect(() => {
    if (greetedRef.current || messages.length > 0) return;
    greetedRef.current = true;
    runStream(greet());
  }, []);

  // watcher 가 상황을 감지하면 클리피가 먼저 말을 건다
  useEffect(() => {
    const api = (window as any).clippyWatcher;
    if (!api) {
      console.warn("clippyWatcher 없음 — preload 확인 필요");
      return;
    }

    api.onObservation((payload: any) => {
      console.info("[관찰]", payload.event, payload.label);
      if (busyRef.current) return; // 말하는 중이면 건너뜀
      runStream(speakUnprompted(payload.text));
    });

    return () => api.offObservation?.();
  }, [runStream]);

  const handleAbortMessage = () => {
    // 제미나이 스트림 중단은 아직 미구현
  };

  const handleSendMessage = async (message: string) => {
    if (status !== "idle") return;

    await addMessage({
      id: crypto.randomUUID(),
      content: message,
      sender: "user",
      createdAt: Date.now(),
    });

    await runStream(sendMessage(message));
  };

  return (
    <div style={style} className="chat-container">
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
      {status === "responding" && (
        <Message
          message={{
            id: "streaming",
            content: streamingMessageContent,
            sender: "clippy",
            createdAt: Date.now(),
          }}
        />
      )}
      <ChatInput onSend={handleSendMessage} onAbort={handleAbortMessage} />
    </div>
  );
}

/**
 * 응답 맨 앞의 [애니메이션이름] 을 떼어내고 본문만 남긴다.
 *
 * @param content - The content of the message
 * @returns The text and animation key
 */
function filterMessageContent(content: string): {
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
    // Check for animation keys in brackets
    for (const key of ANIMATION_KEYS_BRACKETS) {
      if (content.startsWith(key)) {
        animationKey = key.slice(1, -1);
        text = content.slice(key.length).trim();
        break;
      }
    }
  }

  return { text, animationKey };
}
