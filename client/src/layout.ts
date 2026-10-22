// Approved desktop layout in CSS pixels (decisions D-026, D-027).
// style.css hard-codes the same numbers for the DOM; verifyLayout() in
// main.ts measures the real elements at runtime and warns if they drift.
export const LAYOUT = {
  container: { width: 960, height: 640 },
  hud: { width: 240, height: 640 },
  gameplay: { width: 720, height: 640 },
} as const;
