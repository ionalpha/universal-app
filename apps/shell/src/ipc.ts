import { commands, type Error as IpcErrorPayload } from "./bindings";

// The generated bindings are the contract; this is the ergonomics layer on top.
// App code imports `ipc`, never `bindings` and never `invoke("string")` — that
// is the whole point of generating the boundary rather than hand-writing it.

/**
 * A failure that crossed the Rust boundary, carrying the taxonomy with it.
 *
 * `key` is a stable identifier for translation, never prose: the Rust core does
 * not decide what the user reads. `detail` is developer-facing and belongs in
 * logs and bug reports, not in the UI.
 */
export class IpcError extends Error {
  readonly kind: IpcErrorPayload["kind"];
  readonly key: string;
  readonly detail: string;

  constructor(payload: IpcErrorPayload) {
    // `message` is for developers and stack traces. Anything user-visible is
    // produced by translating `key`.
    super(`${payload.kind}: ${payload.key} (${payload.detail})`);
    this.name = "IpcError";
    this.kind = payload.kind;
    this.key = payload.key;
    this.detail = payload.detail;
  }
}

/**
 * Turns the generated `{ status: "ok" | "error" }` result into a normal
 * rejection.
 *
 * Both shapes are defensible; this picks throwing so a native call behaves like
 * every other async call in the app and cannot be ignored by forgetting to
 * check `.status`. The type survives the conversion, so callers can still
 * discriminate on `kind` in a catch block.
 */
async function unwrap<T>(
  call: Promise<{ status: "ok"; data: T } | { status: "error"; error: IpcErrorPayload }>,
): Promise<T> {
  const result = await call;
  if (result.status === "error") throw new IpcError(result.error);
  return result.data;
}

export const ipc = {
  greet: (name: string) => unwrap(commands.greet(name)),
  hostInfo: () => unwrap(commands.hostInfo()),
  openExternal: (url: string) => unwrap(commands.openExternal(url)),
};
