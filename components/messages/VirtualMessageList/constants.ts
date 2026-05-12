/** Milliseconds gap between same-sender messages that breaks a visual group. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

/** Pixel threshold from the bottom to consider the user "at bottom". */
export const BOTTOM_THRESHOLD_PX = 80;

/**
 * Pixels from the top (and viewport multiplier) that trigger a history fetch
 * while scrolling backward — fires early so content loads before the user
 * reaches the top.
 */
export const HISTORY_FETCH_THRESHOLD_PX = 2500;
export const HISTORY_FETCH_VIEWPORT_MULTIPLIER = 3;

/** Page size when loading newer messages in JUMPED mode. */
export const AFTER_FETCH_LIMIT = 30;

/** Pixel threshold from the bottom to trigger "load more after" in JUMPED mode. */
export const LOAD_AFTER_THRESHOLD_PX = 200;
