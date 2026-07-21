use serde::Serialize;
use specta::Type;

/// The single error type every command returns.
///
/// Two things make this worth a module of its own rather than `String`:
///
/// 1. It crosses the IPC boundary as a tagged union, so the generated TypeScript
///    is a discriminated union the frontend can exhaustively `switch` on. A
///    stringly-typed error would arrive as `unknown` and force the caller to
///    parse prose.
/// 2. Every variant carries a stable `key`, not a sentence. The Rust side never
///    decides what the user reads; the frontend maps the key to a translated
///    message. Putting user-facing English here would make the core
///    untranslatable and would break the moment the copy changed.
///
/// `detail` is for developers (logs, bug reports) and is never shown as-is.
#[derive(Debug, Serialize, Type, thiserror::Error)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Error {
    /// The caller sent something this command cannot work with.
    #[error("invalid input ({key}): {detail}")]
    InvalidInput { key: String, detail: String },

    /// Anything the caller cannot act on. Deliberately opaque across the
    /// boundary: internal failures leak paths and system detail if forwarded.
    #[error("internal ({key}): {detail}")]
    Internal { key: String, detail: String },
}

impl Error {
    pub fn invalid_input(key: &str, detail: impl Into<String>) -> Self {
        Self::InvalidInput { key: key.into(), detail: detail.into() }
    }

    pub fn internal(key: &str, detail: impl Into<String>) -> Self {
        Self::Internal { key: key.into(), detail: detail.into() }
    }
}

/// Every command signature is `Result<T, Error>`, so the generated bindings are
/// uniform and the frontend never has to ask which commands can fail.
pub type Result<T> = std::result::Result<T, Error>;
