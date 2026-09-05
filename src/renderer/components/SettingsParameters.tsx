import { useEffect, useState } from "react";

import { DEFAULT_PARAMS, Params, loadParams, saveParams } from "../params";
import { resetHistory } from "../gemini";

export function SettingsParameters() {
  const [p, setP] = useState<Params>(DEFAULT_PARAMS);
  const [note, setNote] = useState("");

  useEffect(() => {
    setP(loadParams());
  }, []);

  const update = (patch: Partial<Params>) => {
    const next = { ...p, ...patch };
    setP(next);
    saveParams(next);
    setNote("저장했습니다. 다음 발화부터 적용됩니다.");
  };

  const box: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
  };

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
      <fieldset>
        <legend>Temperature — {p.temperature.toFixed(2)}</legend>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={p.temperature}
          style={{ width: "100%" }}
          onChange={(e) => update({ temperature: Number(e.target.value) })}
        />
        <div style={{ fontSize: "0.9em" }}>
          낮으면 안정적이고 뻔해집니다. 높으면 엉뚱해지지만 헛소리도 늘어납니다.
          클리피는 1.2~1.5 정도가 무난합니다.
        </div>
      </fieldset>

      <fieldset>
        <legend>Thinking level</legend>
        <select
          style={box}
          value={p.thinkingLevel}
          onChange={(e) => update({ thinkingLevel: e.target.value as any })}
        >
          <option value="minimal">minimal — 가장 빠름</option>
          <option value="low">low — 권장</option>
          <option value="medium">medium</option>
          <option value="high">high — 느리고 비쌈</option>
        </select>
        <div style={{ marginTop: 4, fontSize: "0.9em" }}>
          한 줄짜리 농담에는 깊은 사고가 필요 없습니다. 높이면 응답이 느려지고
          사고 토큰이 출력 요금으로 청구됩니다.
        </div>
      </fieldset>

      <fieldset>
        <legend>최대 출력 토큰</legend>
        <input
          type="number"
          style={box}
          min={100}
          max={8000}
          step={100}
          value={p.maxOutputTokens}
          onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })}
        />
      </fieldset>

      <fieldset>
        <legend>화면 인지</legend>
        <select
          style={box}
          value={p.screenAwareness}
          onChange={(e) => update({ screenAwareness: e.target.value as any })}
        >
          <option value="off">끔 — 대화 중엔 화면을 모름</option>
          <option value="onAsk">물어볼 때만 (권장)</option>
          <option value="always">항상 — 화면 얘기를 자주 함</option>
        </select>
        <div style={{ marginTop: 4, fontSize: "0.9em" }}>
          먼저 튀어나올 때는 어느 설정이든 화면을 봅니다. 이건 네가 말을 걸었을
          때 이야기입니다. '항상'으로 두면 매 답변마다 창 제목을 들먹입니다.
        </div>
      </fieldset>

      <fieldset>
        <legend>대화 기억 — 최근 {p.historyLimit}턴</legend>
        <input
          type="range"
          min={10}
          max={200}
          step={10}
          value={p.historyLimit}
          style={{ width: "100%" }}
          onChange={(e) => update({ historyLimit: Number(e.target.value) })}
        />
        <div style={{ fontSize: "0.9em" }}>
          매 호출마다 이만큼을 다시 보냅니다. 늘리면 더 잘 기억하지만 비용도
          같이 늘어납니다. 컴퓨터를 끄면 어차피 사라집니다.
        </div>
      </fieldset>

      <fieldset>
        <legend>대화 초기화</legend>
        <button
          onClick={() => {
            if (!confirm("지금까지의 대화를 지울까요? 클리피가 오늘 일을 잊습니다."))
              return;
            resetHistory();
            setNote("대화 기록을 비웠습니다.");
          }}
        >
          지금 대화 지우기
        </button>
        <div style={{ marginTop: 4, fontSize: "0.9em" }}>
          말투가 이상하게 굳었을 때 씁니다. 화면 얘기만 반복하는 경우 특히
          효과가 있습니다.
        </div>
      </fieldset>

      <div className="field-row">
        <button
          onClick={() => {
            setP(DEFAULT_PARAMS);
            saveParams(DEFAULT_PARAMS);
            setNote("기본값으로 되돌렸습니다.");
          }}
        >
          Reset
        </button>
      </div>

      {note && <div style={{ fontSize: "0.9em" }}>{note}</div>}

      <div style={{ fontSize: "0.9em", marginTop: 4 }}>
        발화 빈도와 트리거 조건은 아직 프로젝트 폴더의 config.json 에서 고칩니다.
        나중에 이 탭으로 옮길 예정입니다.
      </div>
    </div>
  );
}
