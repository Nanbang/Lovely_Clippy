import { useEffect, useMemo, useState } from "react";

import {
  Card,
  DEFAULT_CARDS,
  loadCards,
  saveCards,
  getActiveId,
  setActiveId,
  estimateTokens,
} from "../cards";

export function SettingsPersona() {
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [activeId, setActive] = useState<string>("ko-casual");
  const [draft, setDraft] = useState<Card | null>(null);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    const loaded = loadCards();
    const id = getActiveId();
    setCards(loaded);
    setActive(id);
    setDraft(loaded[id] ? { ...loaded[id] } : null);
  }, []);

  const dirty = useMemo(() => {
    if (!draft) return false;
    const orig = cards[draft.id];
    if (!orig) return true;
    return (
      orig.name !== draft.name ||
      orig.text !== draft.text
    );
  }, [draft, cards]);

  const tokens = draft ? estimateTokens(draft.text) : 0;
  const empty = !draft || !draft.text.trim();

  const switchCard = (id: string) => {
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 버리고 이동할까요?")) {
      return;
    }
    setActive(id);
    setActiveId(id);
    setDraft(cards[id] ? { ...cards[id] } : null);
    setNote(`'${cards[id]?.name || id}' 카드를 사용합니다.`);
  };

  const save = () => {
    if (!draft) return;
    const next = { ...cards, [draft.id]: draft };
    setCards(next);
    saveCards(next);
    setActiveId(draft.id);
    setNote(
      empty
        ? "저장했지만 내용이 비어 있습니다. 클리피가 오류를 뱉습니다."
        : "저장했습니다. 다음 발화부터 적용됩니다.",
    );
  };

  const revert = () => {
    if (!draft) return;
    setDraft({ ...cards[draft.id] });
    setNote("편집 내용을 되돌렸습니다.");
  };

  const resetToDefault = () => {
    if (!draft) return;
    const def = DEFAULT_CARDS[draft.id];
    if (!def) return;
    if (!confirm("이 카드를 기본값으로 되돌릴까요? 편집한 내용이 사라집니다.")) {
      return;
    }
    // 불러오기만 하면 저장을 잊는다. 바로 저장까지 한다.
    const next = { ...cards, [def.id]: { ...def } };
    setDraft({ ...def });
    setCards(next);
    saveCards(next);
    setNote("기본값으로 되돌리고 저장했습니다. 바로 적용됩니다.");
  };

  if (!draft) {
    return (
      <div style={{ padding: 12 }}>
        <p style={{ color: "red" }}>
          카드를 불러올 수 없습니다. 설정을 닫았다 다시 열어보세요.
        </p>
      </div>
    );
  }

  const box: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
  };

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="field-row" style={{ gap: 6 }}>
        <label htmlFor="cardSelect" style={{ whiteSpace: "nowrap" }}>
          카드
        </label>
        <select
          id="cardSelect"
          value={activeId}
          onChange={(e) => switchCard(e.target.value)}
          style={{ flex: 1 }}
        >
          {Object.values(cards).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.id}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend>이름</legend>
        <input
          type="text"
          style={box}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </fieldset>

      <fieldset>
        <legend>성격 (Description)</legend>
        <textarea
          style={{ ...box, height: 260, resize: "vertical" }}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          spellCheck={false}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontSize: "0.9em",
          }}
        >
          <span style={{ color: empty ? "red" : "inherit" }}>
            {empty ? "⚠ 비어 있음 — 클리피가 오류를 뱉습니다" : ""}
          </span>
          <span>Tokens: ~{tokens}</span>
        </div>
      </fieldset>

      <div className="field-row" style={{ gap: 6 }}>
        <button onClick={save} disabled={!dirty}>
          저장
        </button>
        <button onClick={revert} disabled={!dirty}>
          되돌리기
        </button>
        <button onClick={resetToDefault}>기본값으로 되돌리기(즉시 저장)</button>
      </div>

      {note && <div style={{ fontSize: "0.9em" }}>{note}</div>}
    </div>
  );
}
