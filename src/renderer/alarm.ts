// 리마인더 알람. 소리는 끌 때까지 반복되고, 해당 말풍선만 빨갛게 점멸한다.

import { SOUNDS } from "./clippy-sounds";

const ALARM_SOUND = "6";
const REPEAT_MS = 1800;

let activeMessageId: string | null = null;
let timer: number | null = null;
const subs = new Set<() => void>();

export function isAlarming(id?: string): boolean {
  if (!activeMessageId) return false;
  return id ? activeMessageId === id : true;
}

export function subscribeAlarm(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function notify() {
  subs.forEach((fn) => fn());
}

function ring() {
  const src = SOUNDS[ALARM_SOUND];
  if (!src) return;

  // 알람은 설정 음량을 따르지 않는다. 항상 최대.
  // 두 번 겹쳐서 울려야 평소 효과음보다 확실히 들린다.
  for (const delay of [0, 120]) {
    window.setTimeout(() => {
      const a = new Audio(src);
      a.volume = 1;
      a.play().catch(() => {});
    }, delay);
  }
}

/** 이 메시지에 알람을 건다. 끌 때까지 계속 울린다. */
export function startAlarm(messageId: string) {
  stopAlarm();
  activeMessageId = messageId;
  ring();
  timer = window.setInterval(ring, REPEAT_MS);
  notify();
}

export function stopAlarm() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (activeMessageId) {
    activeMessageId = null;
    notify();
  }
}
