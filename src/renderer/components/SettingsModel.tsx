import { useEffect, useState } from "react";

import {
  Connection,
  GEMINI_MODELS,
  loadConnections,
  saveConnections,
  getActiveConnectionId,
  setActiveConnectionId,
} from "../connections";

export function SettingsModel() {
  const [list, setList] = useState<Connection[]>([]);
  const [activeId, setActive] = useState("default");
  const [note, setNote] = useState("");

  useEffect(() => {
    setList(loadConnections());
    setActive(getActiveConnectionId());
  }, []);

  const current = list.find((c) => c.id === activeId) || list[0];

  const update = (patch: Partial<Connection>) => {
    if (!current) return;
    const next = list.map((c) => (c.id === current.id ? { ...c, ...patch } : c));
    setList(next);
    saveConnections(next);
  };

  const pick = (id: string) => {
    setActive(id);
    setActiveConnectionId(id);
    setNote("이 연결을 사용합니다.");
  };

  const add = () => {
    const id = `conn-${Date.now().toString(36)}`;
    const next = [
      ...list,
      {
        id,
        label: "새 연결",
        provider: "gemini" as const,
        apiKey: "",
        model: "gemini-3-flash-preview",
      },
    ];
    setList(next);
    saveConnections(next);
    pick(id);
  };

  const remove = () => {
    if (!current || list.length <= 1) {
      setNote("마지막 연결은 지울 수 없습니다.");
      return;
    }
    if (!confirm(`'${current.label}' 연결을 지울까요?`)) return;
    const next = list.filter((c) => c.id !== current.id);
    setList(next);
    saveConnections(next);
    pick(next[0].id);
  };

  if (!current) return <div style={{ padding: 12 }}>연결을 불러오는 중…</div>;

  const box: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
  };

  const masked = current.apiKey
    ? `${current.apiKey.slice(0, 6)}…${current.apiKey.slice(-4)} (${current.apiKey.length}자)`
    : "없음";

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="field-row" style={{ gap: 6 }}>
        <label style={{ whiteSpace: "nowrap" }}>연결</label>
        <select
          value={activeId}
          onChange={(e) => pick(e.target.value)}
          style={{ flex: 1 }}
        >
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} · {c.provider}
            </option>
          ))}
        </select>
        <button onClick={add}>추가</button>
        <button onClick={remove}>삭제</button>
      </div>

      <fieldset>
        <legend>이름</legend>
        <input
          type="text"
          style={box}
          value={current.label}
          onChange={(e) => update({ label: e.target.value })}
        />
      </fieldset>

      <fieldset>
        <legend>제공자</legend>
        <select
          style={box}
          value={current.provider}
          onChange={(e) => update({ provider: e.target.value as any })}
        >
          <option value="gemini">Google Gemini</option>
          <option value="openclaw">OpenClaw 게이트웨이 (미구현)</option>
        </select>
        {current.provider === "openclaw" && (
          <div style={{ marginTop: 6, color: "red", fontSize: "0.9em" }}>
            아직 연결되지 않습니다. 자리만 잡아둔 항목입니다.
          </div>
        )}
      </fieldset>

      {current.provider === "openclaw" ? (
        <fieldset>
          <legend>게이트웨이 주소</legend>
          <input
            type="text"
            style={box}
            placeholder="http://localhost:8080"
            value={current.baseUrl || ""}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </fieldset>
      ) : (
        <>
          <fieldset>
            <legend>모델</legend>
            <input
              type="text"
              style={box}
              list="geminiModels"
              value={current.model}
              onChange={(e) => update({ model: e.target.value })}
            />
            <datalist id="geminiModels">
              {GEMINI_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div style={{ marginTop: 4, fontSize: "0.9em" }}>
              플래시 계열이 빠르고 쌉니다. 목록에 없는 이름도 직접 적을 수 있습니다.
            </div>
          </fieldset>

          <fieldset>
            <legend>API 키</legend>
            <input
              type="password"
              style={box}
              placeholder="AIza… 또는 AQ.…"
              value={current.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <div style={{ marginTop: 4, fontSize: "0.9em" }}>
              현재: {masked}
            </div>
            <div style={{ marginTop: 2, fontSize: "0.9em" }}>
              비워두면 .env 의 VITE_GEMINI_API_KEY 를 쓰지 않고 오류를 냅니다.
            </div>
          </fieldset>
        </>
      )}

      {note && <div style={{ fontSize: "0.9em" }}>{note}</div>}
      <div style={{ fontSize: "0.9em" }}>
        변경은 즉시 저장되며 다음 발화부터 적용됩니다.
      </div>
    </div>
  );
}
