import { useEffect, useState } from "react";

import { Message } from "./Message";
import { ChatInput } from "./ChatInput";
import { useChat } from "../contexts/ChatContext";
import { sendMessage } from "../gemini";
import {
  runStream,
  subscribeStream,
  getStreamingText,
  isBusy,
} from "../streamRunner";

export type ChatProps = {
  style?: React.CSSProperties;
};

export function Chat({ style }: ChatProps) {
  const { setAnimationKey, setStatus, status, messages, addMessage } =
    useChat();
  const [streamingMessageContent, setStreamingMessageContent] =
    useState<string>(getStreamingText());

  // 스트리밍 텍스트는 컴포넌트 밖(streamRunner)에 있다.
  // 설정 탭에 갔다 와도 진행 중이던 문장이 이어져 보인다.
  useEffect(
    () => subscribeStream(() => setStreamingMessageContent(getStreamingText())),
    [],
  );

  const handleAbortMessage = () => {
    // 제미나이 스트림 중단은 아직 미구현
  };

  const handleSendMessage = async (message: string) => {
    if (status !== "idle" || isBusy()) return;

    await addMessage({
      id: crypto.randomUUID(),
      content: message,
      sender: "user",
      createdAt: Date.now(),
    });

    await runStream(sendMessage(message), {
      setStatus,
      setAnimationKey,
      addMessage,
    });
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
