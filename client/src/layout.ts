// Approved desktop layout in CSS pixels (D-131; was 960×640 under D-026, D-027).
// style.css hard-codes the same numbers for the DOM; verifyLayout() in
// main.ts measures the real elements at runtime and warns if they drift.
export const LAYOUT = {
  container: { width: 1200, height: 800 },
  hud: { width: 240, height: 800 },
  gameplay: { width: 960, height: 800 },
} as const;
