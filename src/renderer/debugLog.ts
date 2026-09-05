// 모델에 실제로 뭘 보냈는지 들여다보는 로그.
// 설정 > Debug 탭에서 본다. 튜닝할 때만 쓰는 물건.

export type DebugEntry = {
  id: number;
  at: number;
  kind: "판정" | "발화" | "관찰" | "오류";
  title: string;
  detail: string;
};

const MAX = 60;
let seq = 0;
const entries: DebugEntry[] = [];
const listeners = new Set<() => void>();

export function logDebug(
  kind: DebugEntry["kind"],
  title: string,
  detail: string,
) {
  entries.unshift({ id: ++seq, at: Date.now(), kind, title, detail });
  if (entries.length > MAX) entries.length = MAX;
  listeners.forEach((fn) => fn());
}

export function getDebugEntries(): DebugEntry[] {
  return entries;
}

export function clearDebug() {
  entries.length = 0;
  listeners.forEach((fn) => fn());
}

export function subscribeDebug(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
