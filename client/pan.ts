/**
 * Mouse + keyboard panning for the canvas.
 *
 * Attaches capture-phase pointer listeners on the pixi canvas element so it
 * can intercept drags *before* InputHandler starts a stroke. Two triggers:
 *
 * - Middle mouse button (button === 1) drag — always pans, no modifier needed.
 * - Space-bar held + primary mouse button drag — matches Figma / Photoshop /
 *   Procreate ergonomics.
 *
 * While Space is held the cursor flips to `grab`; during an active drag it
 * flips to `grabbing`. Pointer capture keeps the drag alive even when the
 * user drags outside the canvas element.
 *
 * Touch-device panning is handled separately in `client/touch.ts` via
 * two-finger gesture. This module is desktop-only.
 */

type PanCallback = (dx: number, dy: number) => void;

export interface PanHandlerOptions {
  /** Override window — tests pass a stub. */
  window?: Window;
}

export class PanHandler {
  private isSpacePressed = false;
  private isPanning = false;
  private activePointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  /** Cursor value to restore when pan/space-hold ends. Captured once at
   *  construction so we don't clobber tool-specific cursors set elsewhere. */
  private readonly baseCursor: string;
  private readonly win: Window;

  constructor(
    private element: HTMLElement,
    private onPan: PanCallback,
    opts: PanHandlerOptions = {},
  ) {
    this.win = opts.window ?? globalThis.window;
    this.baseCursor = element.style.cursor;

    // Capture phase so this handler runs before InputHandler's bubble-phase
    // pointerdown listener — we can stop propagation and keep the stroke
    // engine out of the pan gesture entirely.
    element.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    element.addEventListener("pointermove", this.onPointerMove, { capture: true });
    element.addEventListener("pointerup", this.onPointerUp, { capture: true });
    element.addEventListener("pointercancel", this.onPointerCancel, { capture: true });
    // Block the browser's auto-scroll / middle-click context from intercepting.
    element.addEventListener("auxclick", this.onAuxClick);
    this.win.addEventListener("keydown", this.onKeyDown);
    this.win.addEventListener("keyup", this.onKeyUp);
    // If the tab loses focus mid-drag (alt-tab etc.) cancel cleanly.
    this.win.addEventListener("blur", this.onBlur);
  }

  private isTextInput(target: EventTarget | null): boolean {
    // Instanceof checks guarded so this runs under non-DOM test envs where
    // HTMLInputElement et al. are not defined on globalThis.
    if (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement) return true;
    if (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement)
      return true;
    if (typeof HTMLSelectElement !== "undefined" && target instanceof HTMLSelectElement)
      return true;
    if (
      typeof HTMLElement !== "undefined" &&
      target instanceof HTMLElement &&
      target.isContentEditable
    )
      return true;
    return false;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== "Space") return;
    if (this.isTextInput(e.target)) return;
    if (e.repeat) return;
    // Prevent browser default (page scroll) — the canvas container is
    // scrollable-looking and the browser will try to page-down on space.
    e.preventDefault();
    if (!this.isSpacePressed) {
      this.isSpacePressed = true;
      if (!this.isPanning) this.element.style.cursor = "grab";
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code !== "Space") return;
    if (!this.isSpacePressed) return;
    this.isSpacePressed = false;
    if (!this.isPanning) this.element.style.cursor = this.baseCursor;
  };

  private onBlur = (): void => {
    // Release anything stuck from the old focus; no way to see the keyup
    // event that would normally reset state.
    this.isSpacePressed = false;
    this.cancelPan();
  };

  private onAuxClick = (e: MouseEvent): void => {
    // Middle-click would otherwise open a new tab / trigger auto-scroll —
    // suppress for the canvas element.
    if (e.button === 1) e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    const isMiddle = e.button === 1;
    const isSpacePrimary = e.button === 0 && this.isSpacePressed;
    if (!isMiddle && !isSpacePrimary) return;

    e.preventDefault();
    // stopImmediatePropagation keeps InputHandler's bubble-phase listener
    // from starting a stroke on the same pointerdown.
    e.stopImmediatePropagation();

    this.isPanning = true;
    this.activePointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.element.style.cursor = "grabbing";
    // setPointerCapture may not exist on the test stub — guard.
    this.element.setPointerCapture?.(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPanning) return;
    if (e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Skip no-op deltas to avoid waking the compositor on every stationary
    // frame Pixi passes through.
    if (dx === 0 && dy === 0) return;
    this.onPan(dx, dy);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isPanning) return;
    if (e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.endPan(e.pointerId);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.isPanning) return;
    if (e.pointerId !== this.activePointerId) return;
    this.endPan(e.pointerId);
  };

  private endPan(pointerId: number): void {
    this.isPanning = false;
    this.activePointerId = null;
    this.element.releasePointerCapture?.(pointerId);
    this.element.style.cursor = this.isSpacePressed ? "grab" : this.baseCursor;
  }

  private cancelPan(): void {
    if (!this.isPanning) {
      // Still need to restore cursor if space-hold was active.
      if (!this.isSpacePressed) this.element.style.cursor = this.baseCursor;
      return;
    }
    const id = this.activePointerId;
    this.isPanning = false;
    this.activePointerId = null;
    if (id !== null) this.element.releasePointerCapture?.(id);
    this.element.style.cursor = this.baseCursor;
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.element.removeEventListener("pointermove", this.onPointerMove, { capture: true });
    this.element.removeEventListener("pointerup", this.onPointerUp, { capture: true });
    this.element.removeEventListener("pointercancel", this.onPointerCancel, { capture: true });
    this.element.removeEventListener("auxclick", this.onAuxClick);
    this.win.removeEventListener("keydown", this.onKeyDown);
    this.win.removeEventListener("keyup", this.onKeyUp);
    this.win.removeEventListener("blur", this.onBlur);
  }
}
