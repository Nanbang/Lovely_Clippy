// 메모와 리마인더. 둘은 같은 것이고, 시각이 붙었느냐만 다르다.
//
// 저장은 사용자가 시킬 때만 한다. 클리피가 알아서 적지 않는다.
// 평소 프롬프트에는 개수만 들어가고, 물어보면 전체가 들어간다.

export type Note = {
  id: string;
  text: string;
  createdAt: number;
  remindAt?: number; // 있으면 리마인더, 없으면 그냥 메모
  reminded?: boolean; // 이미 알렸는지
  done?: boolean;
};

const KEY = "clippy.notes.v1";

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Note[];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error("메모 로드 실패:", e);
    return [];
  }
}

function persist(list: Note[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** 살아 있는 것만. 완료된 건 뺀다. */
export function activeNotes(): Note[] {
  return loadNotes()
    .filter((n) => !n.done)
    .sort((a, b) => {
      // 시각이 붙은 것이 위로, 그중 임박한 순
      if (a.remindAt && b.remindAt) return a.remindAt - b.remindAt;
      if (a.remindAt) return -1;
      if (b.remindAt) return 1;
      return b.createdAt - a.createdAt;
    });
}

// 비밀로 남겨야 할 것들. 프롬프트에 들어가면 매 발화마다 밖으로 나간다.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bAIza[0-9A-Za-z_-]{20,}/, "구글 API 키"],
  [/\bsk-[0-9A-Za-z_-]{20,}/, "API 키"],
  [/\bgh[pousr]_[0-9A-Za-z]{20,}/, "깃허브 토큰"],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, "슬랙 토큰"],
  [/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, "카드번호로 보이는 숫자"],
  [/\b\d{6}[- ]?[1-4]\d{6}\b/, "주민번호로 보이는 숫자"],
  [/[A-Za-z0-9_\-.]{32,}/, "긴 무작위 문자열 (키나 토큰일 수 있음)"],
];

/** 저장하면 안 되는 내용인지. 문제가 있으면 이유를 돌려준다. */
export function checkSecret(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

export function addNote(text: string, remindAt?: number): Note | string {
  const clean = text.trim();
  if (!clean) return "내용이 비어 있습니다.";

  const secret = checkSecret(clean);
  if (secret) return `${secret} 가 들어 있어 저장하지 않았습니다.`;

  const note: Note = {
    id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    text: clean,
    createdAt: Date.now(),
    ...(remindAt ? { remindAt } : {}),
  };

  persist([...loadNotes(), note]);
  return note;
}

export function updateNote(id: string, patch: Partial<Note>) {
  persist(loadNotes().map((n) => (n.id === id ? { ...n, ...patch } : n)));
}

export function deleteNote(id: string) {
  persist(loadNotes().filter((n) => n.id !== id));
}

export function completeNote(id: string) {
  updateNote(id, { done: true });
}

/** 지금 알려야 할 리마인더. 아직 안 알린 것만. */
export function dueReminders(): Note[] {
  const now = Date.now();
  return activeNotes().filter(
    (n) => n.remindAt && !n.reminded && n.remindAt <= now,
  );
}

export function markReminded(id: string) {
  updateNote(id, { reminded: true });
}

function when(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `오늘 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 프롬프트용 — 전체 목록 */
export function buildNotesBlock(): string {
  const list = activeNotes();
  if (!list.length) return "";

  const lines = list.map((n, i) => {
    const mark = n.remindAt ? ` (알림: ${when(n.remindAt)})` : "";
    return `[${i + 1}] ${n.text}${mark}`;
  });

  return (
    `\n\n## 적어둔 것\n` +
    `사용자가 적어달라고 한 것들이다.\n` +
    `물어봤을 때 읊어주고, 필요하면 하나씩 짚어라. 전부 나열하지는 마라.\n\n` +
    lines.join("\n")
  );
}

/** 프롬프트용 — 개수만. 평소엔 이것만 들어간다. */
export function buildNotesCount(): string {
  const list = activeNotes();
  if (!list.length) return "";

  const due = list.filter((n) => n.remindAt).length;
  const extra = due ? `, 그중 ${due}개는 시각이 정해져 있다` : "";

  return (
    `\n\n(적어둔 메모가 ${list.length}개 있다${extra}. ` +
    `내용은 지금 안 보인다. 물어보면 그때 확인한다. ` +
    `괜히 먼저 꺼내지 마라.)`
  );
}

/** 대략 몇 글자를 차지하는지 */
export function notesCharCount(): number {
  return buildNotesBlock().length;
}
