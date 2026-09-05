import { useEffect, useState } from "react";

import { clippyApi } from "../clippyApi";
import {
  DebugEntry,
  clearDebug,
  getDebugEntries,
  subscribeDebug,
} from "../debugLog";

/**
 * 이 채팅창은 window.open 으로 만든 창이라 origin 이 불투명하다.
 * 그래서 navigator.clipboard 가 막힌다. 메인 프로세스의 클립보드를 쓴다.
 */
function copyText(text: string) {
  try {
    clippyApi.clipboardWrite({ text });
  } catch (e) {
    console.error("클립보드 실패:", e);
  }
}

const COLORS: Record<DebugEntry["kind"], string> = {
  판정: "#000080",
  발화: "#006000",
  관찰: "#804000",
  오류: "#a00000",
};

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-block",
          width: 90,
          height: 10,
          border: "1px inset #888",
          background: "#fff",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${pct}%`,
            height: "100%",
            background: pct >= 100 ? "#008000" : "#000080",
          }}
        />
      </span>
      <span style={{ minWidth: 34, textAlign: "right" }}>{pct}%</span>
    </span>
  );
}

// 마지막 실시간 값을 컴포넌트 밖에 보관한다.
// 탭을 떠나면 패널은 사라지지만 watcher 는 계속 신호를 보내므로,
// 여기 받아뒀다가 다시 열 때 곧바로 그려준다.
let latestLive: any = null;
const liveSubs = new Set<() => void>();
let liveHooked = false;

function ensureLiveHook() {
  if (liveHooked) return;
  const api = (window as any).clippyWatcher;
  if (!api?.onLive) return;
  liveHooked = true;
  api.onLive((p: any) => {
    latestLive = p;
    liveSubs.forEach((fn) => fn());
  });
}

function LivePanel() {
  const [, bump] = useState(0);
  const live = latestLive;

  useEffect(() => {
    ensureLiveHook();
    const fn = () => bump((n) => n + 1);
    liveSubs.add(fn);
    return () => {
      liveSubs.delete(fn);
    };
  }, []);

  // 신호가 끊긴 지 오래되면 알려준다
  const stale = live ? Date.now() - live.at > 8000 : false;

  if (!live)
    return (
      <fieldset>
        <legend>watcher 실시간</legend>
        <div style={{ fontSize: "0.9em" }}>
          아직 신호를 받지 못했습니다. 3초 안에 들어와야 정상입니다.
        </div>
      </fieldset>
    );

  const r = live.raw;

  const rows: [string, number, number, string][] = r
    ? [
        ["화면 고정", r.stareMin, r.stareNeed, `${r.stareMin}분 / ${r.stareNeed}분`],
        ["사이트 체류", r.siteMin, r.siteNeed, `${r.siteMin}분 / ${r.siteNeed}분`],
        [`${r.unit} 개수`, r.items, r.itemsNeed, `${r.items}개 / ${r.itemsNeed}개`],
        ["오늘 재방문", r.visits, r.visitsNeed, `${r.visits}번 / ${r.visitsNeed}번`],
        ["4분간 전환", r.sw4, r.sw4Need, `${r.sw4}회 / ${r.sw4Need}회`],
      ]
    : [];

  return (
    <fieldset>
      <legend>
        watcher 실시간 {live.fast ? "· 테스트 모드" : "· 실사용 모드"}
        {stale && " · ⚠ 신호 끊김"}
      </legend>

      {stale && (
        <div style={{ color: "#a00000", fontSize: "0.9em", marginBottom: 6 }}>
          마지막 신호가 {Math.round((Date.now() - live.at) / 1000)}초 전입니다.
          watcher 가 멈췄을 수 있습니다. 아래 값은 그때 기준입니다.
        </div>
      )}

      {r ? (
        <>
          <div style={{ marginBottom: 6 }}>
            <b>{r.label}</b>
            {r.detail && r.detail !== r.label && (
              <div style={{ color: "#444" }}>{r.detail}</div>
            )}
            <div style={{ color: "#666" }}>{r.exe}</div>
          </div>

          <table style={{ borderCollapse: "collapse", fontSize: "0.9em" }}>
            <tbody>
              {rows.map(([name, v, need, text]) => (
                <tr key={name}>
                  <td style={{ paddingRight: 8, whiteSpace: "nowrap" }}>{name}</td>
                  <td style={{ paddingRight: 8, whiteSpace: "nowrap" }}>{text}</td>
                  <td>
                    <Bar value={v} max={need} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {r.night && (
            <div style={{ marginTop: 4, color: "#800080" }}>
              새벽 보정 적용 중 (점수 ×1.6)
            </div>
          )}
        </>
      ) : (
        <div>화면 정보 없음</div>
      )}

      <div style={{ marginTop: 8, fontSize: "0.9em" }}>
        <b>트리거 점수</b>
        {live.cands.length === 0 ? (
          <div style={{ color: "#666" }}>
            조건을 채운 트리거 없음 — 압력이 쌓이지 않습니다
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {live.cands.map((c: any, i: number) => (
                <tr key={c.ev}>
                  <td style={{ paddingRight: 8 }}>{c.ev}</td>
                  <td style={{ paddingRight: 8 }}>{c.score.toFixed(2)}</td>
                  <td>{i === 0 ? "← 최고" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: "0.9em" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>
            압력 {live.pressure} / {live.threshold}
          </span>
          <Bar value={live.pressure} max={live.threshold} />
        </div>
        {live.gapLeft > 0 && (
          <div style={{ color: "#666" }}>
            최소 간격까지 {live.gapLeft}초 남음 (그전엔 안 나옴)
          </div>
        )}
      </div>
    </fieldset>
  );
}

export function SettingsDebug() {
  const [, force] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [copied, setCopied] = useState<string>("");

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => subscribeDebug(() => force((n) => n + 1)), []);

  const entries = getDebugEntries();

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      <LivePanel />

      <div className="field-row" style={{ gap: 6 }}>
        <button onClick={() => clearDebug()}>비우기</button>
        <button
          onClick={() => {
            const all = entries
              .map(
                (e) =>
                  `[${new Date(e.at).toLocaleTimeString("ko-KR")}] [${e.kind}] ${e.title}\n${e.detail}`,
              )
              .join("\n\n" + "-".repeat(40) + "\n\n");
            copyText(all);
            setCopied("전체");
          }}
        >
          전체 복사
        </button>
        <span style={{ fontSize: "0.9em" }}>
          {copied ? `${copied} 복사됨` : `최근 ${entries.length}건`}
        </span>
      </div>

      <div
        style={{
          border: "1px inset #888",
          background: "#fff",
          height: 240,
          overflowY: "auto",
          fontSize: "0.9em",
        }}
      >
        {entries.length === 0 && (
          <div style={{ padding: 8, color: "#666" }}>
            아직 기록이 없습니다. 클리피와 대화하거나 트리거가 터지면 여기 쌓입니다.
          </div>
        )}

        {entries.map((e) => {
          const open = openId === e.id;
          return (
            <div key={e.id} style={{ borderBottom: "1px solid #ddd" }}>
              <div
                onClick={() => setOpenId(open ? null : e.id)}
                style={{ padding: "4px 6px", cursor: "pointer" }}
              >
                <span style={{ color: "#666" }}>
                  {new Date(e.at).toLocaleTimeString("ko-KR")}
                </span>{" "}
                <b style={{ color: COLORS[e.kind] }}>[{e.kind}]</b> {e.title}
              </div>
              {open && (
                <div>
                  <div style={{ padding: "2px 6px" }}>
                    <button
                      onClick={() => {
                        copyText(e.detail);
                        setCopied("항목");
                      }}
                    >
                      이 항목 복사
                    </button>
                  </div>
                  <pre
                    className="debug-selectable"
                    style={{
                      margin: 0,
                      padding: "6px 8px",
                      background: "#f4f4f4",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 260,
                      overflowY: "auto",
                      userSelect: "text",
                      WebkitUserSelect: "text",
                      cursor: "text",
                    }}
                  >
                    {e.detail}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: "0.9em" }}>
        항목을 누르면 실제로 모델에 보낸 내용이 펼쳐집니다. 펼친 내용은 드래그해서
        선택할 수 있습니다.
      </div>
    </div>
  );
}
