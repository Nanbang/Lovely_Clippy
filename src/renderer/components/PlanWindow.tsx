import { useState } from "react";

import { Note, activeNotes, completeNote, deleteNote } from "../notes";
import { BubbleWindowBottomBar } from "./BubbleWindowBottomBar";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export type PlanWindowProps = { onClose: () => void };

export function PlanWindow({ onClose }: PlanWindowProps) {
  const [mode, setMode] = useState<"day" | "month">("day");
  const [cursor, setCursor] = useState(new Date());
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  // 시각이 붙은 것만. 시각 없는 메모는 여기 들어올 이유가 없다.
  const timed: Note[] = activeNotes().filter((n) => !!n.remindAt);

  const onDay = (d: Date) =>
    timed.filter((n) => sameDay(new Date(n.remindAt!), d));

  const shift = (days: number) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + days);
    setCursor(d);
  };

  const shiftMonth = (months: number) => {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + months);
    setCursor(d);
  };

  // ── 하루 보기 ──────────────────────────────
  const dayView = () => {
    const now = new Date();
    const isToday = sameDay(cursor, now);
    const items = onDay(cursor);

    return (
      <div
        style={{
          border: "1px inset #888",
          background: "#fff",
          flex: 1,
          overflowY: "auto",
          fontSize: "0.9em",
        }}
      >
        {Array.from({ length: 24 }, (_, h) => {
          const here = items.filter(
            (n) => new Date(n.remindAt!).getHours() === h,
          );
          const currentHour = isToday && now.getHours() === h;

          return (
            <div
              key={h}
              style={{
                display: "flex",
                borderBottom: "1px solid #e0e0e0",
                background: currentHour ? "#ffffcc" : undefined,
                minHeight: 22,
              }}
            >
              <div
                style={{
                  width: 42,
                  padding: "3px 4px",
                  borderRight: "1px solid #c0c0c0",
                  color: "#555",
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {String(h).padStart(2, "0")}
              </div>

              <div style={{ flex: 1, padding: "2px 4px" }}>
                {here.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "#000080",
                      color: "#fff",
                      padding: "1px 4px",
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>
                      {String(new Date(n.remindAt!).getMinutes()).padStart(2, "0")}분
                    </span>
                    <span style={{ flex: 1 }}>{n.text}</span>
                    <button
                      style={{ minWidth: 20, minHeight: 15, padding: 0 }}
                      title="완료"
                      onClick={(e) => {
                        e.stopPropagation();
                        completeNote(n.id);
                        refresh();
                      }}
                    >
                      ✓
                    </button>
                    <button
                      style={{ minWidth: 20, minHeight: 15, padding: 0 }}
                      title="삭제"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(n.id);
                        refresh();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── 달력 보기 ──────────────────────────────
  const monthView = () => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = first.getDay();
    const days = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0,
    ).getDate();
    const today = new Date();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < start; i++) cells.push(null);
    for (let d = 1; d <= days; d++)
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <div style={{ border: "1px inset #888", background: "#fff", flex: 1 }}>
        <div style={{ display: "flex" }}>
          {DOW.map((d, i) => (
            <div
              key={d}
              style={{
                flex: 1,
                textAlign: "center",
                padding: 2,
                fontSize: "0.85em",
                background: "#c0c0c0",
                color: i === 0 ? "#a00000" : i === 6 ? "#000080" : "#000",
                borderRight: "1px solid #808080",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <div key={row} style={{ display: "flex" }}>
            {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
              const items = d ? onDay(d) : [];
              const isToday = d && sameDay(d, today);
              const isCursor = d && sameDay(d, cursor);

              return (
                <div
                  key={i}
                  onClick={() => {
                    if (!d) return;
                    setCursor(d);
                    setMode("day");
                  }}
                  style={{
                    flex: 1,
                    minHeight: 46,
                    padding: 2,
                    borderRight: "1px solid #e0e0e0",
                    borderBottom: "1px solid #e0e0e0",
                    cursor: d ? "pointer" : "default",
                    background: isCursor
                      ? "#000080"
                      : isToday
                        ? "#ffffcc"
                        : undefined,
                    color: isCursor ? "#fff" : undefined,
                    fontSize: "0.85em",
                    overflow: "hidden",
                  }}
                >
                  {d && <div>{d.getDate()}</div>}
                  {items.slice(0, 2).map((n) => (
                    <div
                      key={n.id}
                      style={{
                        fontSize: "0.85em",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: isCursor ? "#cfcfff" : "#000080",
                      }}
                    >
                      • {n.text}
                    </div>
                  ))}
                  {items.length > 2 && (
                    <div style={{ fontSize: "0.85em", color: "#666" }}>
                      +{items.length - 2}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const title =
    mode === "day"
      ? `${cursor.getFullYear()}. ${cursor.getMonth() + 1}. ${cursor.getDate()} (${DOW[cursor.getDay()]})`
      : `${cursor.getFullYear()}. ${cursor.getMonth() + 1}`;

  return (
    <>
      <div
        style={{
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          height: "calc(100% - 40px)",
        }}
      >
        <div className="field-row" style={{ gap: 4 }}>
          <button onClick={() => (mode === "day" ? shift(-1) : shiftMonth(-1))}>
            ◀
          </button>
          <span style={{ flex: 1, textAlign: "center", fontWeight: "bold" }}>
            {title}
          </span>
          <button onClick={() => (mode === "day" ? shift(1) : shiftMonth(1))}>
            ▶
          </button>
          <button onClick={() => setCursor(new Date())}>오늘</button>
        </div>

        <div className="field-row" style={{ gap: 4 }}>
          <button disabled={mode === "day"} onClick={() => setMode("day")}>
            시간표
          </button>
          <button disabled={mode === "month"} onClick={() => setMode("month")}>
            달력
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: "0.85em", color: "#555" }}>
            예정 {timed.length}개
          </span>
        </div>

        {mode === "day" ? dayView() : monthView()}

        <div style={{ fontSize: "0.85em", color: "#555" }}>
          {mode === "day"
            ? "클리피에게 말하면 여기에 생깁니다. 시각 없는 메모는 Save 창에 있습니다."
            : "날짜를 누르면 그날 시간표로 넘어갑니다."}
        </div>
      </div>

      <BubbleWindowBottomBar>
        <button onClick={onClose}>대화로 돌아가기</button>
      </BubbleWindowBottomBar>
    </>
  );
}
