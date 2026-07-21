// Public API of @repo/client - the only surface apps may import.
export type { AppProps, MountOptions } from "./app";
export { App, mountApp } from "./app";
// Design-system primitives, for apps that compose their own screens.
export type { ButtonProps } from "./components/button";
export { Button } from "./components/button";
export { cn } from "./lib/cn";
