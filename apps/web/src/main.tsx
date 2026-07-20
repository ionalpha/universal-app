import { mountApp } from "@repo/client";
import "./index.css";

mountApp({
  platform: "web",
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787",
});
