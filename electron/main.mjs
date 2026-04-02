/**
 * Electron main process for ReThink.
 *
 * Embeds the production HTTP server directly in this process (no child
 * process spawning) so it works correctly inside a packaged asar.
 */

import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 5133;
const WINDOW_ICON = path.join(ROOT, "build", "icons", "generated", "app-256.png");

let mainWindow = null;
let httpServer = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

async function startEmbeddedServer() {
  process.env.PORT = String(PORT);

  const serverPath = pathToFileURL(path.join(ROOT, "server.mjs")).href;
  const serverModule = await import(serverPath);
  httpServer = await serverModule.startServer(PORT);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "ReThink — AI 方案评审助手",
    icon: WINDOW_ICON,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await startEmbeddedServer();
  } catch (err) {
    console.error("Failed to start embedded server:", err);
    app.quit();
    return;
  }

  // Give the server a moment to bind
  await new Promise((r) => setTimeout(r, 300));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (httpServer?.listening) {
    httpServer.close();
    httpServer = null;
  }
});
