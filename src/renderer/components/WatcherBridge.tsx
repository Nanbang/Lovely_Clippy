import { useEffect, useRef } from "react";

import { useChat } from "../contexts/ChatContext";
import { useBubbleView } from "../contexts/BubbleViewContext";
import { greet, speakUnprompted, summoned, setCurrentScreen } from "../gemini";
import { runStream, isBusy } from "../streamRunner";

/**
 * 항상 살아 있는 컴포넌트.
 * 채팅 화면이 내려가 있어도(설정 탭을 보는 중이거나 창을 닫아둬도)
 * watcher 신호를 놓치지 않는다.
 */
export function WatcherBridge() {
  const {
    addMessage,
    setAnimationKey,
    setStatus,
    setIsChatWindowOpen,
  } = useChat();
  const { setCurrentView } = useBubbleView();

  const greeted = useRef(false);

  const handlers = { setStatus, setAnimationKey, addMessage };

  // 앱 켜면 첫인사. 저장된 기억을 읽고 클리피가 직접 지어낸다.
  //
  // 주의: 개발 모드의 StrictMode 는 이 효과를 두 번 돌린다.
  // 정리 함수에서 타이머를 지우면 첫 번째가 취소되고 두 번째는 ref 에 막혀서
  // 인사가 영영 안 나간다. 그래서 타이머도 정리 함수도 쓰지 않는다.
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    runStream(greet(), handlers);
  }, []);

  // watcher 신호
  useEffect(() => {
    const api = (window as any).clippyWatcher;
    if (!api) {
      console.warn("clippyWatcher 없음 — preload 확인 필요");
      return;
    }

    api.onObservation((payload: any) => {
      console.info("[관찰]", payload.event, payload.label);
      if (isBusy()) return;

      // 귀찮게 굴어야 하므로 대화창을 열고 채팅 화면으로 되돌린다
      setIsChatWindowOpen(true);
      setCurrentView("chat");

      // 단축키로 불려 나온 경우와 스스로 튀어나온 경우를 구분한다
      const gen = payload.forced
        ? summoned(payload.text)
        : speakUnprompted(payload.text);

      runStream(gen, handlers);
    });

    api.onState?.((payload: any) => {
      setCurrentScreen(payload?.summary || null);
    });

    return () => {
      api.offObservation?.();
      api.offState?.();
    };
  }, [setIsChatWindowOpen, setCurrentView]);

  return null;
}
