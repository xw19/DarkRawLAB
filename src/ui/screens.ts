// Minimal screen router. The app is three full-screen views; exactly one is
// visible at a time. Each `<section>` carries `data-screen="<name>"`, and we
// toggle the `hidden` attribute.

export type ScreenName = "start" | "editor" | "export";

export function showScreen(name: ScreenName): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-screen]")) {
    section.hidden = section.dataset.screen !== name;
  }
}
