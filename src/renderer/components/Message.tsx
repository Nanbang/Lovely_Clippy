import Markdown from "react-markdown";
import questionIcon from "../images/icons/question.png";
import defaultClippy from "../images/animations/Default.png";
import { useEffect, useState } from "react";
import { MessageRecord } from "../../types/interfaces";
import { isAlarming, subscribeAlarm } from "../alarm";

export interface Message extends MessageRecord {
  id: string;
  content?: string;
  children?: React.ReactNode;
  createdAt: number;
  sender: "user" | "clippy";
}

export function Message({ message }: { message: Message }) {
  const [, bump] = useState(0);
  const [blink, setBlink] = useState(true);

  useEffect(() => subscribeAlarm(() => bump((n) => n + 1)), []);

  const alarming = isAlarming(message.id);

  useEffect(() => {
    if (!alarming) return;
    const t = setInterval(() => setBlink((b) => !b), 550);
    return () => clearInterval(t);
  }, [alarming]);

  // 알람이 걸린 말풍선만 빨갛게 점멸한다. 나머지는 그대로.
  const alarmStyle: React.CSSProperties = alarming
    ? {
        border: `2px solid ${blink ? "#d00000" : "#ffb0b0"}`,
        background: blink ? "#ffecec" : "#fff6f6",
        padding: "4px 6px",
        marginBottom: 4,
      }
    : {};

  return (
    <div
      className="message"
      style={{ display: "flex", alignItems: "flex-start", ...alarmStyle }}
    >
      <img
        src={message.sender === "user" ? questionIcon : defaultClippy}
        alt={`${message.sender === "user" ? "You" : "Clippy"}`}
        style={{ width: "24px", height: "24px", marginRight: "8px" }}
      />
      <div className="message-content">
        {message.children ? (
          message.children
        ) : (
          <Markdown
            components={{
              a: ({ node, ...props }) => (
                <a target="_blank" rel="noopener noreferrer" {...props} />
              ),
            }}
          >
            {message.content}
          </Markdown>
        )}
      </div>
    </div>
  );
}
