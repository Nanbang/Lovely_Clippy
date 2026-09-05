import { ipcMain, BrowserWindow, globalShortcut, app } from "electron";
import { forceObservation } from "./watcher-host";

// 클리피 창을 마우스로 끌어 옮기기.
// CSS app-region 대신 직접 좌표를 옮긴다. 그래야 드래그와 클릭을 구분할 수 있다.
ipcMain.on("clippy-move-by", (event, delta: { dx: number; dy: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + delta.dx), Math.round(y + delta.dy));
});

// 저장 창의 종료 버튼
ipcMain.on("clippy-quit", () => {
  console.info("[종료] 사용자가 저장 창에서 종료를 눌렀습니다.");
  app.quit();
});

// 강제 소환 단축키.
// 전역이라 앱이 최소화돼 있거나 게임 중이어도 먹는다.
const SUMMON_ACCELERATOR = "Control+Alt+Q";

app.on("ready", () => {
  const ok = globalShortcut.register(SUMMON_ACCELERATOR, () => {
    console.info(`[단축키] ${SUMMON_ACCELERATOR} — 강제 소환`);
    forceObservation();
  });

  if (!ok) {
    console.warn(
      `[단축키] ${SUMMON_ACCELERATOR} 등록 실패 — 다른 프로그램이 이미 쓰고 있습니다.`,
    );
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
