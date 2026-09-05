import { app, BrowserWindow } from "electron";
import { fork, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

let child: ChildProcess | null = null;

/**
 * watcher-child.mjs 를 별도 Node 프로세스로 띄운다.
 * get-windows 가 ESM 전용 네이티브 모듈이라 메인에 직접 번들하면 깨지므로
 * 자식 프로세스로 분리했다.
 */
export function startWatcher() {
  const root = app.getAppPath();
  const script = path.join(root, "watcher-child.mjs");

  if (!fs.existsSync(script)) {
    console.warn(`[watcher] 스크립트를 찾을 수 없음: ${script}`);
    return;
  }

  child = fork(script, [], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  console.info(`[watcher] 시작됨 (pid ${child.pid})`);

  child.stdout?.on("data", (d) => process.stdout.write(`[watcher] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[watcher] ${d}`));

  child.on("message", (msg: any) => {
    if (!msg) return;

    if (msg.type === "live") {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("clippy-live", msg);
      }
      return;
    }

    if (msg.type === "state") {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("clippy-state", msg);
      }
      return;
    }

    if (msg.type !== "observation") return;

    console.info(`[watcher] ${msg.event} · ${msg.label} (${msg.score})`);

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("clippy-observation", msg);
    }
  });

  child.on("exit", (code) => {
    console.warn(`[watcher] 종료됨 (code ${code})`);
    child = null;
  });
}

/** 강제 발화 (디버그용) */
export function forceObservation() {
  child?.send({ type: "force" });
}

export function stopWatcher() {
  child?.kill();
  child = null;
}

app.on("before-quit", stopWatcher);
