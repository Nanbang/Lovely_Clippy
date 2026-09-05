// 세션 요약 저장소.
// 대화를 끝낼 때 요약을 만들어 저장하고, 다음에 앱을 켜면 시스템 프롬프트에 들어간다.

export type MemoryLength = "short" | "medium" | "long" | "merged";

export type Memory = {
  id: string;
  createdAt: number;   // 저장한 시각
  startedAt: number;   // 이 세션이 시작된 시각
  endedAt: number;     // 이 세션이 끝난 시각
  length: MemoryLength;
  text: string;
  sourceIds?: string[]; // 머지로 만들어진 경우 원본들
};

const KEY = "clippy.memories.v1";
const MAX_PROMPT_CHARS = 4000;

export function loadMemories(): Memory[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Memory[];
    return Array.isArray(list) ? list.sort((a, b) => a.endedAt - b.endedAt) : [];
  } catch (e) {
    console.error("기억 로드 실패:", e);
    return [];
  }
}

function persist(list: Memory[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function addMemory(m: Omit<Memory, "id" | "createdAt">): Memory {
  const mem: Memory = {
    ...m,
    id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };
  const list = loadMemories();
  list.push(mem);
  persist(list);
  return mem;
}

export function updateMemory(id: string, patch: Partial<Memory>) {
  const list = loadMemories().map((m) => (m.id === id ? { ...m, ...patch } : m));
  persist(list);
}

export function deleteMemories(ids: string[]) {
  persist(loadMemories().filter((m) => !ids.includes(m.id)));
}

/** 여러 기억을 하나로 합친다. 원본은 지운다. */
export function mergeMemories(ids: string[], text: string): Memory {
  const list = loadMemories();
  const sources = list.filter((m) => ids.includes(m.id));
  if (!sources.length) throw new Error("합칠 기억이 없습니다.");

  const merged: Memory = {
    id: `mem-${Date.now().toString(36)}-merged`,
    createdAt: Date.now(),
    startedAt: Math.min(...sources.map((m) => m.startedAt)),
    endedAt: Math.max(...sources.map((m) => m.endedAt)),
    length: "merged",
    text,
    sourceIds: ids,
  };

  persist([...list.filter((m) => !ids.includes(m.id)), merged]);
  return merged;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** 목록에 들어갈 짧은 표기. 좁은 칸에 한 줄로 들어가야 한다. */
export function formatRange(m: Memory): string {
  const s = new Date(m.startedAt);
  const e = new Date(m.endedAt);
  const sameDay = s.toDateString() === e.toDateString();
  const day = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  const hm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

  if (!sameDay) return `${day(s)} ~ ${day(e)}`;
  return `${day(s)} ${hm(s)}-${hm(e)}`;
}

/** 펼쳤을 때 보여줄 자세한 표기 */
export function formatRangeLong(m: Memory): string {
  const f = (t: number) =>
    new Date(t).toLocaleString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  return `${f(m.startedAt)} ~ ${f(m.endedAt)}`;
}

/** 시스템 프롬프트에 붙일 블록. 너무 길면 오래된 것부터 잘라낸다. */
export function buildMemoryBlock(): string {
  const list = loadMemories();
  if (!list.length) return "";

  const picked: Memory[] = [];
  let total = 0;

  for (let i = list.length - 1; i >= 0; i--) {
    const line = `- ${formatRange(list[i])}: ${list[i].text}`;
    if (total + line.length > MAX_PROMPT_CHARS) break;
    total += line.length;
    picked.unshift(list[i]);
  }

  const lines = picked.map((m) => `- ${formatRange(m)}\n  ${m.text}`);

  return (
    `\n\n## 이 사람과 지낸 기록\n` +
    `예전 세션에서 있었던 일이다. 오늘 일이 아니다.\n` +
    `이걸 그대로 읊지 마라. 아는 사이라는 게 태도에 묻어나면 그걸로 충분하다.\n\n` +
    lines.join("\n")
  );
}
