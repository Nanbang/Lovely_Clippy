// 모델 연결 관리. API 키를 여러 개 저장해두고 갈아끼운다.
// OpenClaw 게이트웨이도 나중에 여기에 붙일 자리를 만들어 뒀다.

export type Provider = "gemini" | "openclaw";

export type Connection = {
  id: string;
  label: string;
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string; // OpenClaw 게이트웨이 주소 (지금은 미사용)
};

const KEY = "clippy.connections.v1";
const ACTIVE = "clippy.activeConnection.v1";

export const GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3-pro-preview",
];

function seed(): Connection[] {
  const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || "";
  return [
    {
      id: "default",
      label: "제미나이 (기본)",
      provider: "gemini",
      apiKey: envKey,
      model: "gemini-3-flash-preview",
    },
  ];
}

export function loadConnections(): Connection[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const s = seed();
      localStorage.setItem(KEY, JSON.stringify(s));
      return s;
    }
    const parsed = JSON.parse(raw) as Connection[];
    return Array.isArray(parsed) && parsed.length ? parsed : seed();
  } catch (e) {
    console.error("연결 목록 로드 실패:", e);
    return seed();
  }
}

export function saveConnections(list: Connection[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getActiveConnectionId(): string {
  return localStorage.getItem(ACTIVE) || "default";
}

export function setActiveConnectionId(id: string) {
  localStorage.setItem(ACTIVE, id);
}

export function getActiveConnection(): Connection | null {
  const list = loadConnections();
  return list.find((c) => c.id === getActiveConnectionId()) || list[0] || null;
}

/** 쓸 수 있는 상태인지. 문제가 있으면 사람이 읽을 메시지를 돌려준다. */
export function checkConnection(): string | null {
  const c = getActiveConnection();
  if (!c) return "선택된 연결이 없습니다. 설정 > Model 에서 추가하세요.";
  if (c.provider === "openclaw")
    return "OpenClaw 연결은 아직 구현되지 않았습니다. 설정 > Model 에서 제미나이를 고르세요.";
  if (!c.apiKey.trim())
    return `연결 '${c.label}' 에 API 키가 없습니다. 설정 > Model 에서 입력하세요.`;
  if (!c.model.trim())
    return `연결 '${c.label}' 에 모델 이름이 없습니다.`;
  return null;
}
