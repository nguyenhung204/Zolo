import {
  Observable,
  animationFrameScheduler,
  scheduled,
  merge,
  timer,
  EMPTY,
  filter,
  takeUntil,
  finalize,
  mergeMap,
  map,
  tap,
} from "rxjs";
import type { Subscription } from "rxjs";

/** Emits once on the next animation frame then completes. */
export function rAF$(): Observable<0> {
  return scheduled([0 as const], animationFrameScheduler);
}

/** Emits whenever any of the given elements change size, never completes. */
export function fromResizeObserver(
  ...elements: (Element | null | undefined)[]
): Observable<void> {
  return new Observable((sub) => {
    const ro = new ResizeObserver(() => sub.next());
    elements.filter(Boolean).forEach((el) => ro.observe(el!));
    return () => ro.disconnect();
  });
}

/**
 * Produces a stream that calls `onScroll` on each tick (rAF, double-rAF,
 * 120 ms, 360 ms, 720 ms) while `shouldContinue()` is true, then finalizes at
 * 820 ms by calling `onFinalize`.
 */
export function createBottomScrollStream({
  shouldContinue,
  onScroll,
  onFinalize,
}: {
  shouldContinue: () => boolean;
  onScroll: () => void;
  onFinalize: () => void;
}) {
  return merge(
    rAF$(),
    rAF$().pipe(mergeMap(() => rAF$())),
    timer(120),
    timer(360),
    timer(720),
  ).pipe(
    filter(shouldContinue),
    takeUntil(timer(820)),
    finalize(onFinalize),
    tap(() => onScroll()),
  );
}

/**
 * Produces a stream for multi-pass jump-to-message scrolling.
 * Emits: 0 (rAF), 1 (100 ms), 2 (320 ms), 3 (520 ms).
 */
export function createJumpScrollStream() {
  return merge(
    rAF$().pipe(map(() => 0 as const)),
    timer(100).pipe(map(() => 1 as const)),
    timer(320).pipe(map(() => 2 as const)),
    timer(520).pipe(map(() => 3 as const)),
  );
}

/**
 * Produces a stream for history restore — fires on every rAF tick and on every
 * ResizeObserver tick for the given element, until 600 ms have elapsed.
 */
export function createHistoryRestoreStream(el: Element | null) {
  const resizes$ = el ? fromResizeObserver(el, el.firstElementChild ?? undefined) : EMPTY;
  return merge(rAF$(), resizes$).pipe(takeUntil(timer(600)));
}
