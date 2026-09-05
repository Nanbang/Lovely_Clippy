import { useEffect, useState, useCallback, useRef } from "react";

import { ANIMATIONS, Animation } from "../clippy-animations";
import {
  EMPTY_ANIMATION,
  getRandomIdleAnimation,
} from "../clippy-animation-helpers";
import { useChat } from "../contexts/ChatContext";
import { log } from "../logging";
import { useDebugState } from "../contexts/DebugContext";

const WAIT_TIME = 6000;
const CLICK_SLOP = 4; // 이만큼 안 움직였으면 드래그가 아니라 클릭

export function Clippy() {
  const {
    animationKey,
    status,
    setStatus,
    setIsChatWindowOpen,
    isChatWindowOpen,
  } = useChat();
  const { enableDragDebug } = useDebugState();
  const [animation, setAnimation] = useState<Animation>(EMPTY_ANIMATION);
  const [animationTimeoutId, setAnimationTimeoutId] = useState<
    number | undefined
  >(undefined);

  const drag = useRef({ active: false, lastX: 0, lastY: 0, moved: 0 });

  // 앱 켜지면 대화창을 열어둔다.
  // 채팅 컴포넌트가 붙어 있어야 watcher 신호를 받을 수 있다.
  useEffect(() => {
    setIsChatWindowOpen(true);
  }, []);

  const playAnimation = useCallback((key: string) => {
    if (ANIMATIONS[key]) {
      log(`Playing animation`, { key });

      if (animationTimeoutId) {
        window.clearTimeout(animationTimeoutId);
      }

      setAnimation(ANIMATIONS[key]);
      setAnimationTimeoutId(
        window.setTimeout(() => {
          setAnimation(ANIMATIONS.Default);
        }, ANIMATIONS[key].length + 200),
      );
    } else {
      log(`Animation not found`, { key });
    }
  }, []);

  // ── 드래그 & 클릭 ────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;

    const dx = e.screenX - drag.current.lastX;
    const dy = e.screenY - drag.current.lastY;
    if (dx === 0 && dy === 0) return;

    drag.current.lastX = e.screenX;
    drag.current.lastY = e.screenY;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);

    (window as any).clippyWatcher?.moveBy?.(dx, dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const wasClick = drag.current.moved < CLICK_SLOP;
    drag.current.active = false;

    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 놓였으면 무시 */
    }

    if (wasClick) {
      setIsChatWindowOpen(!isChatWindowOpen);
    }
  };

  useEffect(() => {
    const playRandomIdleAnimation = () => {
      if (status !== "idle") return;

      const randomIdleAnimation = getRandomIdleAnimation(animation);
      setAnimation(randomIdleAnimation);

      setAnimationTimeoutId(
        window.setTimeout(() => {
          setAnimation(ANIMATIONS.Default);
          setAnimationTimeoutId(
            window.setTimeout(playRandomIdleAnimation, WAIT_TIME),
          );
        }, randomIdleAnimation.length),
      );
    };

    if (status === "welcome" && animation === EMPTY_ANIMATION) {
      setAnimation(ANIMATIONS.Show);
      setTimeout(() => {
        setStatus("idle");
      }, ANIMATIONS.Show.length + 200);
    } else if (status === "idle") {
      if (!animationTimeoutId) {
        playRandomIdleAnimation();
      }
    }

    return () => {
      if (animationTimeoutId) {
        window.clearTimeout(animationTimeoutId);
      }
    };
  }, [status]);

  useEffect(() => {
    log(`New animation key`, { animationKey });
    playAnimation(animationKey);
  }, [animationKey, playAnimation]);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: "relative",
        cursor: drag.current.active ? "grabbing" : "grab",
        touchAction: "none",
        backgroundColor: enableDragDebug
          ? "rgba(0,0,255,0.3)"
          : "transparent",
        lineHeight: 0,
      }}
      title="끌어서 옮기기 · 클릭해서 대화창 열기"
    >
      <img
        className="app-no-select"
        src={animation.src}
        draggable={false}
        alt="Clippy"
      />
    </div>
  );
}
