import { afterEach, describe, expect, it } from "vitest";
import { installNativeWindowControls } from "./nativeWindow";

let remove: (() => void) | undefined;
afterEach(() => {
  remove?.();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("native window controls", () => {
  it("suppresses browser context actions but keeps edit and selection menus", () => {
    remove = installNativeWindowControls(window);
    const input = document.createElement("input");
    const label = document.createElement("span");
    label.textContent = "Selectable diagnostic";
    document.body.append(input, label);
    const openMenu = (element: Element) =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    expect(openMenu(label)).toBe(false);
    expect(openMenu(input)).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(label);
    window.getSelection()?.addRange(range);
    expect(openMenu(label)).toBe(true);
  });

  it("blocks reload and browser print without overriding normal edit keys", () => {
    remove = installNativeWindowControls(window);
    const key = (key: string, init: KeyboardEventInit = {}) =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    expect(key("r", { ctrlKey: true })).toBe(false);
    expect(key("R", { metaKey: true, shiftKey: true })).toBe(false);
    expect(key("p", { ctrlKey: true })).toBe(false);
    expect(key("F5")).toBe(false);
    expect(key("c", { ctrlKey: true })).toBe(true);
    expect(key("r")).toBe(true);
    remove();
    expect(key("r", { ctrlKey: true })).toBe(true);
  });
});
