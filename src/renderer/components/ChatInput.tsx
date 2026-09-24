import { useState, useEffect, useRef, useCallback } from "react";
import { useChat } from "../contexts/ChatContext";
import { checkConnection } from "../connections";
import { checkActiveCard } from "../cards";
export type ChatInputProps = {
  onSend: (message: string) => void;
  onAbort: () => void;
};

export function ChatInput({ onSend, onAbort }: ChatInputProps) {
  const { status } = useChat();
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 원본 앱은 로컬 모델이 로딩돼야 입력창을 열어줬다.
  // 우리는 그 모델을 안 쓰므로 그 값은 영원히 false 다.
  // 대신 우리 쪽 준비 상태(연결 + 성격 카드)를 본다.
  const problem = checkConnection() || checkActiveCard();
  const ready = !problem;

  const handleSend = useCallback(() => {
    const trimmedMessage = message.trim();

    if (trimmedMessage) {
      onSend(trimmedMessage);
      setMessage("");
    }
  }, [message, onSend]);

  const handleAbort = useCallback(() => {
    setMessage("");
    onAbort();
  }, [onAbort]);

  const handleSendOrAbort = useCallback(() => {
    if (status === "responding") {
      handleAbort();
    } else {
      handleSend();
    }
  }, [status, handleSend, handleAbort]);

  const buttonStyle: React.CSSProperties = {
    alignSelf: "flex-end",
    height: "23px",
  };

  useEffect(() => {
    if (ready && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [ready]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const trimmedMessage = message.trim();

      if (trimmedMessage) {
        onSend(trimmedMessage);
        setMessage("");
      }

      e.preventDefault();
      e.stopPropagation();
    }
  };

  const placeholder = ready
    ? "메시지를 입력하고 Enter"
    : problem || "준비 중...";

  return (
    <div style={{ display: "flex", alignItems: "flex-end" }}>
      <textarea
        rows={1}
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={!ready}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          flex: 1,
          marginRight: "8px",
          resize: "vertical",
          minHeight: "23px",
          width: 80,
        }}
      />
      <button
        disabled={!ready}
        style={buttonStyle}
        onClick={handleSendOrAbort}
      >
        {status === "responding" ? "Abort" : "Send"}
      </button>
    </div>
  );
}
