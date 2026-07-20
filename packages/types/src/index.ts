/**
 * Shared domain types used across web, desktop, mobile and the API.
 * Framework-agnostic: no React, no Node, no browser globals.
 */

export interface HealthStatus {
  status: "ok";
  ts: number;
}

export type Platform = "web" | "desktop" | "ios" | "android";
