// 애니메이션에 맞춰 원본 효과음을 재생한다.
//
// 우리 앱은 APNG 를 통째로 재생해서 지금이 몇 번째 프레임인지 모른다.
// 그래서 애니메이션이 시작한 시각을 기준으로 타이머를 걸어 소리를 낸다.
// 원본 프레임 duration 합계와 우리 APNG 의 length 가 같은 값이라 맞아떨어진다.

import { SOUNDS, SOUND_CUES } from "./clippy-sounds";

const SETTINGS_KEY = "clippy.sound.v1";

export type SoundSettings = {
  enabled: boolean;
  volume: number; // 0 ~ 1
};

const DEFAULTS: SoundSettings = { enabled: true, volume: 0.5 };

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSoundSettings(s: SoundSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// 같은 소리를 반복 재생할 때마다 Audio 를 새로 만들면 끊긴다.
// 미리 만들어두고 currentTime 만 되감아 쓴다.
const cache = new Map<string, HTMLAudioElement>();

function get(id: string): HTMLAudioElement | null {
  const src = SOUNDS[id];
  if (!src) return null;

  let a = cache.get(id);
  if (!a) {
    a = new Audio(src);
    a.preload = "auto";
    cache.set(id, a);
  }
  return a;
}

let timers: number[] = [];

function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
}

function playOne(id: string, volume: number) {
  const base = get(id);
  if (!base) return;

  // 겹쳐 나야 하는 경우가 있어서 복제본으로 재생한다
  const a = base.cloneNode(true) as HTMLAudioElement;
  a.volume = volume;
  a.play().catch(() => {
    /* 자동재생 차단 등은 무시 */
  });
}

/**
 * 애니메이션 하나에 붙은 효과음을 전부 예약한다.
 * 새 애니메이션이 시작되면 이전 예약은 취소된다.
 */
export function playAnimationSounds(animationKey: string) {
  clearTimers();

  const s = loadSoundSettings();
  if (!s.enabled) return;

  const cues = SOUND_CUES[animationKey];
  if (!cues) return;

  for (const [at, id] of cues) {
    if (at <= 0) {
      playOne(id, s.volume);
    } else {
      timers.push(window.setTimeout(() => playOne(id, s.volume), at));
    }
  }
}

/** 설정 화면에서 소리를 미리 들어보기 */
export function previewSound(id = "15") {
  const s = loadSoundSettings();
  playOne(id, s.volume);
}

export function stopAllSounds() {
  clearTimers();
}

/** 이 애니메이션에 소리가 붙어 있는지 */
export function hasSound(animationKey: string): boolean {
  return !!SOUND_CUES[animationKey];
}

export function listSoundedAnimations(): string[] {
  return Object.keys(SOUND_CUES).sort();
}
