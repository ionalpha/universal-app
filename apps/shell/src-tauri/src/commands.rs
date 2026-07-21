use crate::error::{Error, Result};
use serde::Serialize;
use specta::Type;

/// What the shell knows about the machine it is running on.
///
/// A struct rather than loose return values: adding a field here shows up in
/// the generated TypeScript as a field, whereas widening a tuple silently
/// renumbers every call site.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    /// `windows`, `macos`, `linux`, `ios` or `android`.
    pub os: String,
    /// `x86_64`, `aarch64`, ...
    pub arch: String,
    /// The shell's own version, so a bug report can name the build.
    pub app_version: String,
}

/// Sample command, kept because it is the smallest thing that exercises the
/// whole path: typed argument in, `Result` out, generated binding, typed error.
#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::invalid_input("greet.emptyName", "name was empty or whitespace"));
    }
    Ok(format!("Hello, {name}! The Universal App shell is running."))
}

/// Real capability rather than another toy: the frontend is shared across web,
/// desktop and mobile, so "which host am I on" is the first thing it actually
/// needs from the native side.
#[tauri::command]
#[specta::specta]
pub fn host_info(app: tauri::AppHandle) -> Result<HostInfo> {
    let _ = &app;
    Ok(HostInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: app.package_info().version.to_string(),
    })
}

/// Opens a URL in the user's real browser rather than inside the webview.
///
/// Carries its weight here because it is the one command with a genuine failure
/// path on both sides of the boundary: a caller can pass something that is not
/// an external URL (their bug, actionable, `InvalidInput`), and the OS handoff
/// can fail (not their bug, opaque, `Internal`). Without it the error taxonomy
/// would be speculative.
#[tauri::command]
#[specta::specta]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<()> {
    // Scheme-checked in the core, not the frontend. A renderer-side check is
    // advisory, since anything that can call the command can skip the check;
    // this is the boundary, so it is where the rule has to hold. Refusing
    // anything but http(s) keeps `file://` and custom-scheme handlers out of
    // reach of a compromised frontend.
    let allowed = url.starts_with("https://") || url.starts_with("http://");
    if !allowed {
        return Err(Error::invalid_input(
            "openExternal.unsupportedScheme",
            format!("only http(s) URLs may be opened externally, got: {url}"),
        ));
    }

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<&str>)
        .map_err(|e| Error::internal("openExternal.failed", e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_rejects_blank_names() {
        let err = greet("   ").unwrap_err();
        // The frontend switches on `kind` and translates `key`, so both are
        // part of the contract, not incidental.
        assert!(matches!(err, Error::InvalidInput { ref key, .. } if key == "greet.emptyName"));
    }

    #[test]
    fn greet_trims_before_answering() {
        assert!(greet("  Ada  ").unwrap().starts_with("Hello, Ada!"));
    }
}
