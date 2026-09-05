// 모델 파라미터. 설정 > Parameters 에서 바꾸며, 다음 호출부터 바로 적용된다.

export type Params = {
  temperature: number;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  maxOutputTokens: number;
  historyLimit: number; // 대화 기록을 몇 턴까지 들고 갈지
  screenAwareness: "off" | "onAsk" | "always";
};

const KEY = "clippy.params.v1";

export const DEFAULT_PARAMS: Params = {
  temperature: 1.3,
  thinkingLevel: "low",
  maxOutputTokens: 2000,
  historyLimit: 40,
  screenAwareness: "onAsk",
};

export function loadParams(): Params {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PARAMS };
    return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

export function saveParams(p: Params) {
  localStorage.setItem(KEY, JSON.stringify(p));
}
