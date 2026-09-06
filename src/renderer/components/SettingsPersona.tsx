import { useEffect, useMemo, useState } from "react";

import {
  ComboPiece,
  Piece,
  PieceSet,
  composeEmotionBlock,
  loadEmotions,
  loadPieces,
  resetPieces,
  savePieces,
  setEmotions,
} from "../emotions";
import {
  Card,
  DEFAULT_CARDS,
  loadCards,
  saveCards,
  getActiveId,
  setActiveId,
  estimateTokens,
} from "../cards";

function EmotionEditor() {
  const [set, setSet] = useState<PieceSet | null>(null);
  const [a, setA] = useState(3);
  const [s, setS] = useState(0);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSet(loadPieces());
    const e = loadEmotions();
    setA(e.attachment);
    setS(e.sulk);
  }, []);

  if (!set) return <div style={{ padding: 8 }}>불러오는 중…</div>;

  const box: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
  };

  const editPiece = (kind: "sulk" | "attach", id: string, text: string) => {
    setSet({
      ...set,
      [kind]: set[kind].map((x: Piece) => (x.id === id ? { ...x, text } : x)),
    });
    setDirty(true);
  };

  const editCombo = (id: string, text: string) => {
    setSet({
      ...set,
      combo: set.combo.map((x: ComboPiece) => (x.id === id ? { ...x, text } : x)),
    });
    setDirty(true);
  };

  const preview = composeEmotionBlock(a, s);

  const pieceRows = (kind: "sulk" | "attach") =>
    set[kind].map((piece: Piece) => {
      const value = kind === "sulk" ? s : a;
      const sorted = [...set[kind]].sort((x, y) => y.min - x.min);
      const active = (sorted.find((x) => value >= x.min) || sorted[sorted.length - 1])?.id;
      const on = active === piece.id;

      return (
        <fieldset key={piece.id} style={{ marginBottom: 6 }}>
          <legend style={{ fontWeight: on ? "bold" : "normal" }}>
            {on ? "▶ " : ""}
            {piece.label}
          </legend>
          <textarea
            style={{ ...box, height: 70, resize: "vertical" }}
            value={piece.text}
            spellCheck={false}
            onChange={(ev) => editPiece(kind, piece.id, ev.target.value)}
          />
        </fieldset>
      );
    });

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
      <fieldset>
        <legend>지금 감정 (움직이면 실제로 적용됩니다)</legend>

        <div style={{ marginBottom: 4 }}>애착 {a.toFixed(1)} / 10</div>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={a}
          style={{ width: "100%" }}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            setA(v);
            setEmotions(v, s);
          }}
        />

        <div style={{ margin: "6px 0 4px" }}>삐짐 {s.toFixed(1)} / 10</div>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={s}
          style={{ width: "100%" }}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            setS(v);
            setEmotions(a, v);
          }}
        />
      </fieldset>

      <fieldset>
        <legend>지금 값으로 조립된 결과</legend>
        <pre
          style={{
            margin: 0,
            padding: 6,
            background: "#fff",
            border: "1px inset #888",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 220,
            overflowY: "auto",
            fontSize: "0.9em",
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
        >
          {preview}
        </pre>
        <div style={{ marginTop: 4, fontSize: "0.9em" }}>
          슬라이더를 움직이면 어느 조각이 걸리는지 바로 보입니다.
          현재 적용 중인 조각은 아래에서 ▶ 로 표시됩니다.
        </div>
      </fieldset>

      <div>
        <b>삐짐 조각</b>
        {pieceRows("sulk")}
      </div>

      <div>
        <b>애착 조각</b>
        {pieceRows("attach")}
      </div>

      <div>
        <b>조합 조각</b>
        {set.combo.map((c: ComboPiece) => (
          <fieldset key={c.id} style={{ marginBottom: 6 }}>
            <legend>{c.label}</legend>
            <textarea
              style={{ ...box, height: 70, resize: "vertical" }}
              value={c.text}
              spellCheck={false}
              onChange={(ev) => editCombo(c.id, ev.target.value)}
            />
          </fieldset>
        ))}
      </div>

      <div className="field-row" style={{ gap: 6 }}>
        <button
          disabled={!dirty}
          onClick={() => {
            savePieces(set);
            setDirty(false);
            setNote("저장했습니다. 다음 발화부터 적용됩니다.");
          }}
        >
          저장
        </button>
        <button
          onClick={() => {
            if (!confirm("감정 문구를 전부 기본값으로 되돌릴까요?")) return;
            resetPieces();
            setSet(loadPieces());
            setDirty(false);
            setNote("기본값으로 되돌렸습니다.");
          }}
        >
          기본값
        </button>
      </div>

      {note && <div style={{ fontSize: "0.9em" }}>{note}</div>}
    </div>
  );
}

export function SettingsPersona() {
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [activeId, setActive] = useState<string>("ko-casual");
  const [draft, setDraft] = useState<Card | null>(null);
  const [note, setNote] = useState<string>("");
  const [tab, setTab] = useState<"card" | "emotion">("card");

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
        <button
          disabled={tab === "card"}
          onClick={() => setTab("card")}
        >
          성격 카드
        </button>
        <button
          disabled={tab === "emotion"}
          onClick={() => setTab("emotion")}
        >
          감정
        </button>
      </div>

      {tab === "emotion" && <EmotionEditor />}

      {tab === "card" && (
      <>
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
      </>
      )}
    </div>
  );
}
