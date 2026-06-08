import { describe, it, expect, vi } from "vitest";
import { buildStaleFallback } from "./lib-exports.mjs";

// Minimal fake DOM — the builder only uses createElement, setAttribute,
// textContent, style.cssText, appendChild, addEventListener, and remove().
// Keeps the test dependency-free (no jsdom), matching the repo convention.
function makeEl(tag) {
  const listeners = {};
  return {
    tag,
    id: "",
    type: "",
    textContent: "",
    attributes: {},
    style: { cssText: "" },
    children: [],
    removed: false,
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn); },
    dispatch(evt) { (listeners[evt] || []).forEach((fn) => fn()); },
    remove() { this.removed = true; },
  };
}

const makeDoc = () => ({ createElement: (tag) => makeEl(tag) });
const findChild = (root, pred) => root.children.find(pred);

describe("buildStaleFallback", () => {
  it("builds an alert banner that says the message was not sent and the tab needs reloading", () => {
    const root = buildStaleFallback(makeDoc(), () => {});
    expect(root.id).toBe("toneguard-stale-fallback");
    expect(root.getAttribute("role")).toBe("alert");
    const text = root.children.map((c) => c.textContent).join(" ");
    expect(text).toMatch(/reload this tab/i);
    expect(text).toMatch(/not sent/i);
  });

  it("invokes the reload callback when Reload is clicked", () => {
    const onReload = vi.fn();
    const root = buildStaleFallback(makeDoc(), onReload);
    const reload = findChild(root, (c) => c.textContent === "Reload");
    expect(reload).toBeTruthy();
    reload.dispatch("click");
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("removes itself when dismissed", () => {
    const root = buildStaleFallback(makeDoc(), () => {});
    const dismiss = findChild(root, (c) => c.getAttribute("aria-label") === "Dismiss");
    expect(dismiss).toBeTruthy();
    dismiss.dispatch("click");
    expect(root.removed).toBe(true);
  });

  it("does not throw when no reload callback is provided", () => {
    const root = buildStaleFallback(makeDoc());
    const reload = findChild(root, (c) => c.textContent === "Reload");
    expect(() => reload.dispatch("click")).not.toThrow();
  });
});
