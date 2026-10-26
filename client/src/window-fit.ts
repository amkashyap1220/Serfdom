import { LAYOUT } from "./layout";

/*
 * Window size (D-159): the whole 1200×800 game box shrinks to fit a smaller
 * window, keeping its shape, and never grows past 1200×800 (the user,
 * 2026-10-26): a bigger window gets plain margins. Everyone sees the same
 * world whatever their screen. Below 900×600 (75%) it stops shrinking and
 * a notice asks for a bigger window.
 */

/** The smallest supported window, as a share of the game box. */
export const MIN_SCALE = 0.75;
export const MIN_WINDOW = {
  width: LAYOUT.container.width * MIN_SCALE,
  height: LAYOUT.container.height * MIN_SCALE,
};

export interface Fit {
  /** How much the game box is scaled (1 = 1200×800 CSS pixels). */
  scale: number;
  /** Where its top-left corner goes, in window pixels (the margins). */
  left: number;
  top: number;
  /** The window is below the supported minimum. */
  tooSmall: boolean;
}

/** The fit for a window of this many CSS pixels. Pure, so it is unit-tested. */
export function fitWindow(width: number, height: number): Fit {
  const { width: w, height: h } = LAYOUT.container;
  const tooSmall = width < MIN_WINDOW.width || height < MIN_WINDOW.height;
  const scale = Math.max(MIN_SCALE, Math.min(1, width / w, height / h));
  return {
    scale,
    // Centred when it fits; pinned to the corner when the window is too small.
    left: Math.max(0, Math.floor((width - w * scale) / 2)),
    top: Math.max(0, Math.floor((height - h * scale) / 2)),
    tooSmall,
  };
}

/**
 * Applies the fit to the page now and on every resize. `onFit` runs after
 * each change (the game re-measures its canvas, so the mouse aims true).
 */
export function fitGameToWindow(
  container: HTMLElement,
  notice: HTMLElement,
  onFit: (fit: Fit) => void,
): () => Fit {
  let current = fitWindow(window.innerWidth, window.innerHeight);
  const apply = () => {
    current = fitWindow(window.innerWidth, window.innerHeight);
    container.style.transform = `scale(${current.scale})`;
    container.style.left = `${current.left}px`;
    container.style.top = `${current.top}px`;
    // The floating tooltip (outside the box) scales with it.
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(current.scale),
    );
    notice.hidden = !current.tooSmall;
    onFit(current);
  };
  window.addEventListener("resize", apply);
  apply();
  return () => current;
}
