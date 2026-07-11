// Reusable slide-in drawer — a content-agnostic overlay panel.
//
// Opens from the right (a `side` seam is here for a future left variant), floats
// above the content with a dim backdrop, and is driven by both a toggle button
// (call `toggle()`/`open()`/`close()` from your own control) and touch/pointer
// swipes: drag in from the edge to open, drag the handle to close, tap the
// backdrop to close. Built on Pointer Events so touch and mouse share one path,
// consistent with the crop overlay and zoom controller.
//
// The panel + backdrop mount into `host` (use a screen container so the drawer
// hides with it). The edge swipe-to-open hotspot mounts into `edgeHost` (default
// `host`) — pass a smaller, positioned region (e.g. the canvas stage) to keep
// the hotspot away from other edge controls like sliders. Fill `drawer.content`
// with whatever the menu should contain.

export interface DrawerOptions {
  /** Which edge to dock to. Only "right" is wired today. */
  side?: "right" | "left";
  /** Heading shown in the drawer header. */
  title?: string;
  /** Panel width as a CSS length. Default `min(320px, 85vw)`. */
  width?: string;
  /**
   * Element the swipe-to-open hotspot is mounted in. Defaults to `host`. Pass a
   * positioned sub-region to limit where an edge swipe starts. Must be
   * `position: relative` (or otherwise positioned).
   */
  edgeHost?: HTMLElement;
}

/** Fraction of the panel width past which a release snaps to the new state. */
const SNAP_FRACTION = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class Drawer {
  /** Fill this with the drawer's contents. */
  readonly content: HTMLElement;
  /** Fired whenever the open state changes (after a snap or button toggle). */
  onOpenChange?: (open: boolean) => void;

  private readonly panel: HTMLElement;
  private readonly scrim: HTMLElement;
  private readonly edge: HTMLElement;
  private opened = false;
  private width = 1; // measured panel width in px, for drag math
  private drag: {
    mode: "open" | "close";
    startX: number;
    pointerId: number;
    target: HTMLElement;
  } | null = null;

  constructor(host: HTMLElement, opts: DrawerOptions = {}) {
    // side is accepted for API completeness; the current CSS docks right.
    void (opts.side ?? "right");

    this.scrim = document.createElement("div");
    this.scrim.className = "drawer-scrim";
    this.scrim.addEventListener("click", () => this.close());

    this.panel = document.createElement("div");
    this.panel.className = "drawer-panel";
    if (opts.width) this.panel.style.setProperty("--drawer-width", opts.width);

    // Grab strip on the panel's outer edge, for swipe-to-close.
    const handle = document.createElement("div");
    handle.className = "drawer-handle";

    const header = document.createElement("div");
    header.className = "drawer-header";
    const title = document.createElement("h2");
    title.className = "drawer-title";
    title.textContent = opts.title ?? "";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "drawer-close";
    closeBtn.setAttribute("aria-label", "Close menu");
    closeBtn.textContent = "×"; // ×
    closeBtn.addEventListener("click", () => this.close());
    header.append(title, closeBtn);

    this.content = document.createElement("div");
    this.content.className = "drawer-content";

    this.panel.append(handle, header, this.content);

    this.edge = document.createElement("div");
    this.edge.className = "drawer-edge";

    host.append(this.scrim, this.panel);
    (opts.edgeHost ?? host).append(this.edge);

    // Swipe-to-open from the edge; swipe-to-close from the handle. Both use the
    // same drag math, differing only in their starting (base) position.
    this.bindDrag(this.edge, "open");
    this.bindDrag(handle, "close");
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.opened);
  }

  /** Apply open state via classes; idempotent so it also resets a drag. */
  private setOpen(open: boolean): void {
    const changed = open !== this.opened;
    this.opened = open;
    this.panel.classList.toggle("open", open);
    this.scrim.classList.toggle("open", open);
    // Drop any inline drag styles so the CSS transition drives the snap.
    this.panel.style.transform = "";
    this.scrim.style.opacity = "";
    if (changed) this.onOpenChange?.(open);
  }

  private bindDrag(target: HTMLElement, mode: "open" | "close"): void {
    target.addEventListener("pointerdown", (e) => this.onDown(e, mode, target));
    target.addEventListener("pointermove", (e) => this.onMove(e));
    target.addEventListener("pointerup", (e) => this.onUp(e));
    target.addEventListener("pointercancel", (e) => this.onUp(e));
  }

  private onDown(e: PointerEvent, mode: "open" | "close", target: HTMLElement): void {
    // Open-swipe only when closed; close-swipe only when open.
    if ((mode === "open") === this.opened) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the stage's zoom/pan also grab this
    this.width = this.panel.getBoundingClientRect().width || 1;
    target.setPointerCapture(e.pointerId);
    this.drag = { mode, startX: e.clientX, pointerId: e.pointerId, target };
    this.panel.classList.add("dragging");
    this.scrim.classList.add("dragging", "open"); // show backdrop while dragging
  }

  /** Panel offset in px for the current pointer: 0 = fully open, width = closed. */
  private offsetFor(clientX: number): number {
    const dx = clientX - (this.drag as { startX: number }).startX;
    // Opening starts closed (base = width) and drags left (dx < 0) toward 0;
    // closing starts open (base = 0) and drags right (dx > 0) toward width.
    const base = this.drag!.mode === "open" ? this.width : 0;
    return clamp(base + dx, 0, this.width);
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const p = this.offsetFor(e.clientX);
    this.panel.style.transform = `translateX(${p}px)`;
    this.scrim.style.opacity = String(1 - p / this.width);
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = this.offsetFor(e.clientX);
    d.target.releasePointerCapture(e.pointerId);
    this.panel.classList.remove("dragging");
    this.scrim.classList.remove("dragging");
    this.drag = null;
    // Snap to whichever state the panel is closer to.
    this.setOpen(p < this.width * SNAP_FRACTION);
  }
}
