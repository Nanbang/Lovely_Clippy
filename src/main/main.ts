import { shouldQuit } from "./squirrel-startup";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (shouldQuit) {
  app.quit();
}

import { app, BrowserWindow } from "electron";
import { loadElectronLlm } from "@electron/llm";
import { setupIpcListeners } from "./ipc";
import { createMainWindow, setupWindowListener } from "./windows";
import { getModelManager } from "./models";
import { setupAutoUpdater } from "./update";
import { setupAppMenu } from "./menu";
import { startWatcher } from "./watcher-host";
import "./clippy-extras";

async function onReady() {
  console.info(`Welcome to Clippy v${app.getVersion()}`);

  await setupAutoUpdater();
  // 로컬 LLM 은 쓰지 않는다. 제미나이를 직접 부른다.
  // 모델 파일이 없는 컴퓨터에서는 여기서 오래 멈추고,
  // 있어도 메모리와 시작 시간만 잡아먹는다.
  // await loadLlm();
  setupAppMenu();
  setupIpcListeners();
  setupWindowListener();
  await createMainWindow();
  startWatcher();
}

// 안 쓰지만 나중에 되돌릴 수 있게 남겨둔다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function loadLlm() {
  await loadElectronLlm({
    getModelPath: (modelAlias: string) => {
      console.info(
        `Loading model ${modelAlias} from ${getModelManager().getModelByName(modelAlias)?.path}`,
      );
      return getModelManager().getModelByName(modelAlias)?.path;
    },
  });
}

app.on("ready", onReady);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
