// Local, disconnected visual smoke test. No real token or game connection is used.
// Start Vite on 127.0.0.1:4173, then run: node test/visualSmoke.mjs
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const executable =
  process.env.XYZW_BROWSER ||
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const output =
  process.env.XYZW_SCREENSHOTS || path.join(tmpdir(), "xyzw-visual-smoke");
const base = "http://127.0.0.1:4173";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitPort(profile) {
  for (let i = 0; i < 100; i++) {
    try {
      return Number(
        (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      );
    } catch {
      await wait(100);
    }
  }
  throw new Error("无法启动无头浏览器，请设置 XYZW_BROWSER");
}

class Client {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.id = 0;
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error.message));
      else pending.resolve(data.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.socket.close();
  }
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "xyzw-visual-profile-"));
  await mkdir(output, { recursive: true });
  const browser = spawn(
    executable,
    [
      "--headless",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    const port = await waitPort(profile);
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    const client = new Client(
      targets.find((item) => item.type === "page").webSocketDebuggerUrl,
    );
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const pages = [
      ["dashboard", "/admin/dashboard", ".dashboard-page"],
      ["daily", "/admin/game-features?daily=tasks", ".daily-workspace"],
      ["batch", "/admin/batch-daily-tasks", ".batch-daily-tasks"],
      [
        "features",
        "/admin/game-features?reminder=dream",
        ".game-status-container",
      ],
    ];
    const problems = [];
    for (const theme of ["light", "dark"]) {
      for (const width of [360, 390, 768]) {
        await client.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const [name, route, selector] of pages) {
          const setup = `localStorage.setItem('theme', ${JSON.stringify(theme)}); localStorage.setItem('gameTokens', JSON.stringify([{id:'visual-only',name:'测试账号名称很长'.repeat(8),server:'测试服务器',token:'visual-invalid-token',wsUrl:'ws://127.0.0.1:9'}])); localStorage.setItem('selectedTokenId','visual-only'); window.WebSocket = class { static OPEN = 1; constructor(){ throw new Error('visual fixture: no game connection'); } };`;
          const added = await client.send(
            "Page.addScriptToEvaluateOnNewDocument",
            { source: setup },
          );
          await client.send("Page.navigate", { url: `${base}${route}` });
          let ready = false;
          for (let i = 0; i < 100; i++) {
            await wait(100);
            const check = await client.send("Runtime.evaluate", {
              expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
              returnByValue: true,
            });
            if (check.result.value) {
              ready = true;
              break;
            }
          }
          await wait(300);
          const metrics = await client.send("Runtime.evaluate", {
            expression:
              "({width:innerWidth, scrollWidth:document.documentElement.scrollWidth, height:Math.max(document.documentElement.scrollHeight,innerHeight), path:location.pathname})",
            returnByValue: true,
          });
          const size = metrics.result.value;
          if (!ready || size.scrollWidth > size.width + 1)
            problems.push(
              `${theme} ${width} ${name}: ${!ready ? `未找到 ${selector} (${size.path})` : `横向溢出 ${size.scrollWidth - size.width}px`}`,
            );
          const shot = await client.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: {
              x: 0,
              y: 0,
              width,
              height: Math.min(size.height, 10000),
              scale: 1,
            },
          });
          await writeFile(
            path.join(output, `${theme}-${width}-${name}.png`),
            Buffer.from(shot.data, "base64"),
          );
          await client.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: added.identifier,
          });
          console.log(
            `${theme} ${width} ${name}: ${ready ? "已截图" : "页面未就绪"}`,
          );
        }
      }
    }
    client.close();
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    }
    console.log(`截图保存于 ${output}`);
  } finally {
    browser.kill("SIGTERM");
    await wait(300);
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
