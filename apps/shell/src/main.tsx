import { mountApp } from "@repo/client";
import "./index.css";
import { ipc } from "./ipc";

// Same shared frontend as web — only the platform tag and native shell differ.
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

// One Tauri app hosts desktop, iOS and Android, so the tag has to come from the
// running host. Hardcoding "desktop" made the mobile builds describe themselves
// wrongly, which is the kind of thing that goes unnoticed until someone reads a
// bug report from a phone claiming to be a desktop.
const PLATFORM_BY_OS: Record<string, string> = {
  ios: "ios",
  android: "android",
  macos: "desktop (macOS)",
  windows: "desktop (Windows)",
  linux: "desktop (Linux)",
};

ipc
  .hostInfo()
  .then((info) => mountApp({ platform: PLATFORM_BY_OS[info.os] ?? info.os, apiUrl }))
  // The window must still open if the native call fails: a wrong platform label
  // is a much smaller problem than a blank screen.
  .catch(() => mountApp({ platform: "desktop", apiUrl }));
