// Native WebViews can expose browser-only actions (reload, print, save page).
// Keep normal editing and selection behavior; a browser preview stays a browser.
export function installNativeWindowControls(host: Window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    const target = event.target;
    const textEditing =
      target instanceof Element &&
      target.closest(
        'input, textarea, [contenteditable]:not([contenteditable="false"])',
      );
    if (!textEditing && !host.getSelection()?.toString())
      event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (
      key === "f5" ||
      ((event.ctrlKey || event.metaKey) && ["r", "p"].includes(key))
    ) {
      event.preventDefault();
    }
  };
  host.document.addEventListener("contextmenu", onContextMenu);
  host.document.addEventListener("keydown", onKeyDown, true);
  return () => {
    host.document.removeEventListener("contextmenu", onContextMenu);
    host.document.removeEventListener("keydown", onKeyDown, true);
  };
}
