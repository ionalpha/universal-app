import { mountApp } from "@repo/client";
import "./index.css";

// Same shared frontend as web — only the platform tag and native shell differ.
mountApp({
  platform: "desktop",
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787",
});
