import { useEffect, useState } from "react";

import {
  Memory,
  addMemory,
  deleteMemories,
  formatRange,
  formatRangeLong,
  loadMemories,
  mergeMemories,
  updateMemory,
} from "../memories";
import { summarizeMerge, summarizeSession } from "../summarize";
import { resetHistory } from "../gemini";
import { BubbleWindowBottomBar } from "./BubbleWindowBottomBar";

type Len = "short" | "medium" | "long";

const LEN_LABEL: Record<Len, string> = {
  short: "짧게",
  medium: "중간",
  long: "길게",
};

export type SaveDialogProps = {
  onClose: () => void;
  sessionStartedAt: number;
};

export function SaveDialog({ onClose, sessionStartedAt }: SaveDialogProps) {
  const [list, setList] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [endedAt] = useState(Date.now());

  useEffect(() => setList(loadMemories()), []);

  const refresh = () => {
    setList(loadMemories());
    setChecked(new Set());
  };

  const toggle = (id: string) => {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  };

  const generate = async (len: Len) => {
    setBusy(LEN_LABEL[len]);
    setNote("");
    try {
      const text = mergeMode
        ? await summarizeMerge(len, list.filter((m) => checked.has(m.id)))
        : await summarizeSession(len, sessionStartedAt, endedAt);
      setDraft(text);
      setNote("확인하고 고친 다음 저장을 누르세요.");
    } catch (e: any) {
      setNote(`실패: ${e?.message || e}`);
    } finally {
      setBusy("");
    }
  };

  const save = () => {
    if (!draft.trim()) {
      setNote("내용이 비어 있습니다.");
      return;
    }

    if (mergeMode) {
      mergeMemories([...checked], draft.trim());
      setNote("합쳐서 저장했습니다. 원본은 정리되었습니다.");
      setMergeMode(false);
    } else {
      addMemory({
        startedAt: sessionStartedAt,
        endedAt,
        length: "medium",
        text: draft.trim(),
      });
      setNote("저장했습니다. 다음에 앱을 켜면 클리피가 기억합니다.");
    }

    setDraft("");
    refresh();
  };

  const removeChecked = () => {
    if (!checked.size) return;
    if (!confirm(`${checked.size}개를 지울까요? 되돌릴 수 없습니다.`)) return;
    deleteMemories([...checked]);
    refresh();
    setNote("지웠습니다.");
  };

  const box: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
  };

  return (
    <>
      <div
        style={{
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          height: "calc(100% - 40px)",
          overflowY: "auto",
        }}
      >
        {/* 위: 요약 만들기 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <fieldset style={{ display: "flex", flexDirection: "column" }}>
            <legend>
              {mergeMode ? `${checked.size}개 합치기` : "이번 대화 요약"}
            </legend>

            <div className="field-row" style={{ gap: 4, marginBottom: 6 }}>
              {(["short", "medium", "long"] as Len[]).map((l) => (
                <button key={l} onClick={() => generate(l)} disabled={!!busy}>
                  {LEN_LABEL[l]}
                </button>
              ))}
              {busy && <span style={{ fontSize: "0.9em" }}>{busy} 생성 중…</span>}
            </div>

            <textarea
              style={{ ...box, height: 170, resize: "vertical" }}
              value={draft}
              placeholder={
                mergeMode
                  ? "오른쪽에서 고른 기억들을 합칩니다. 위 버튼을 누르세요."
                  : "위 버튼을 눌러 이번 대화를 요약하세요. 직접 써도 됩니다."
              }
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />

            <div className="field-row" style={{ gap: 4, marginTop: 6 }}>
              <button onClick={save} disabled={!draft.trim()}>
                저장
              </button>
              {mergeMode && (
                <button onClick={() => { setMergeMode(false); setDraft(""); }}>
                  합치기 취소
                </button>
              )}
            </div>
          </fieldset>
        </div>

        {/* 아래: 저장된 기억 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <fieldset style={{ display: "flex", flexDirection: "column" }}>
            <legend>저장된 기억 {list.length}</legend>

            <div
              style={{
                border: "1px inset #888",
                background: "#fff",
                height: 150,
                overflowY: "auto",
                fontSize: "0.9em",
              }}
            >
              {list.length === 0 && (
                <div style={{ padding: 6, color: "#666" }}>아직 없음</div>
              )}

              {[...list].reverse().map((m) => (
                <div key={m.id} style={{ borderBottom: "1px solid #ddd" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "4px 4px",
                    }}
                  >
                    {/* 98.css 는 체크박스를 숨기고 바로 옆 label 에 그림을 그린다.
                        그래서 input + label 을 반드시 짝으로 둬야 보인다. */}
                    <input
                      type="checkbox"
                      id={`chk-${m.id}`}
                      checked={checked.has(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    <label
                      htmlFor={`chk-${m.id}`}
                      style={{ flex: 1, whiteSpace: "nowrap" }}
                    >
                      {formatRange(m)}
                      {m.length === "merged" && " 🔗"}
                    </label>
                    <button
                      style={{ minWidth: 20, minHeight: 16, padding: 0 }}
                      title="펼치기"
                      onClick={() => setOpenId(openId === m.id ? null : m.id)}
                    >
                      {openId === m.id ? "▲" : "▼"}
                    </button>
                  </div>

                  {openId === m.id && (
                    <div style={{ padding: "0 4px 4px" }}>
                      <div style={{ color: "#555", marginBottom: 3 }}>
                        {formatRangeLong(m)}
                      </div>
                      <textarea
                        style={{
                          ...box,
                          height: 140,
                          fontSize: "0.95em",
                          resize: "vertical",
                        }}
                        value={m.text}
                        onChange={(e) => {
                          updateMemory(m.id, { text: e.target.value });
                          setList(loadMemories());
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="field-row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
              <button
                disabled={checked.size < 2 || mergeMode}
                onClick={() => { setMergeMode(true); setDraft(""); setNote("왼쪽에서 분량을 골라 합치세요."); }}
              >
                합치기
              </button>
              <button disabled={!checked.size} onClick={removeChecked}>
                삭제
              </button>
            </div>
          </fieldset>
        </div>
      </div>

      {note && (
        <div style={{ padding: "0 8px", fontSize: "0.9em" }}>{note}</div>
      )}

      <BubbleWindowBottomBar>
        <button
          onClick={() => {
            if (!confirm("지금 대화를 비우고 새로 시작할까요? 저장하지 않은 내용은 사라집니다.")) return;
            resetHistory();
            setNote("대화를 비웠습니다.");
          }}
        >
          대화 비우기
        </button>
        <button
          onClick={() => {
            if (!confirm("클리피를 종료할까요?")) return;
            (window as any).clippyWatcher?.quit?.();
          }}
        >
          종료
        </button>
        <button onClick={onClose}>대화로 돌아가기</button>
      </BubbleWindowBottomBar>
    </>
  );
}
