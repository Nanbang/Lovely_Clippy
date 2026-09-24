// 슬립 모드.
//
// 자리를 비웠는데 계속 말을 걸면 스팸이 된다.
// 실제 입력이 끊겼거나, 말을 걸었는데 연달아 씹히면 입을 다문다.

const IDLE_MINUTES = 8;
const IGNORE_LIMIT = 3;

let idleSeconds = 0;
let unanswered = 0;
let manualSleep = false;
const subs = new Set<() => void>();

export function subscribeSleep(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function notify() {
  subs.forEach((fn) => fn());
}

export function setIdleSeconds(s: number) {
  const wasAsleep = isAsleep();
  idleSeconds = s;
  if (wasAsleep !== isAsleep()) notify();
}

/** 클리피가 먼저 말을 걸었을 때 */
export function noteUnanswered() {
  unanswered += 1;
  notify();
}

/** 사용자가 입을 열었을 때 — 전부 초기화 */
export function noteUserSpoke() {
  unanswered = 0;
  idleSeconds = 0;
  manualSleep = false;
  notify();
}

export function isAsleep(): boolean {
  if (manualSleep) return true;
  if (idleSeconds >= IDLE_MINUTES * 60) return true;
  if (unanswered >= IGNORE_LIMIT) return true;
  return false;
}

export function sleepReason(): string {
  if (manualSleep) return "직접 재움";
  if (idleSeconds >= IDLE_MINUTES * 60)
    return `자리 비움 (${Math.round(idleSeconds / 60)}분째 입력 없음)`;
  if (unanswered >= IGNORE_LIMIT) return `${unanswered}번 연속 무응답`;
  return "";
}

export function sleepStatus() {
  return {
    asleep: isAsleep(),
    idleSeconds,
    unanswered,
    idleLimit: IDLE_MINUTES * 60,
    ignoreLimit: IGNORE_LIMIT,
    reason: sleepReason(),
  };
}

export function toggleManualSleep() {
  manualSleep = !manualSleep;
  notify();
}
