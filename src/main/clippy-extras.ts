import { ipcMain, BrowserWindow } from "electron";

// 클리피 창을 마우스로 끌어 옮기기.
// CSS app-region 대신 직접 좌표를 옮긴다. 그래야 드래그와 클릭을 구분할 수 있다.
ipcMain.on("clippy-move-by", (event, delta: { dx: number; dy: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + delta.dx), Math.round(y + delta.dy));
});
