import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRANCE_DURATION_MS,
  ENTRANCE_EASING,
  ENTRANCE_ITEM_LIMIT,
  ENTRANCE_STAGGER_ITEM_LIMIT,
  ENTRANCE_STAGGER_MS,
  INTERACTION_DURATION_MS,
  PROGRESS_DURATION_MS,
  capturedPrefixIsStable,
  createEntranceCapture,
  getEntranceClassName,
  getEntranceDelayMs,
  selectEntranceIds,
  settleEntranceCapture,
} from "./motion";

const items = (count: number, prefix = "item") =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }));
const getId = (item: { id: string }) => item.id;

describe("motion entrance policy", () => {
  it("pins the approved timing and first-20 limit", () => {
    expect(ENTRANCE_DURATION_MS).toBe(300);
    expect(ENTRANCE_EASING).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(ENTRANCE_ITEM_LIMIT).toBe(20);
    expect(ENTRANCE_STAGGER_ITEM_LIMIT).toBe(8);
    expect(ENTRANCE_STAGGER_MS).toBe(40);
    expect(INTERACTION_DURATION_MS).toBe(220);
    expect(PROGRESS_DURATION_MS).toBe(700);
  });

  it("keeps the compiled source contracts for entrance and pressed movement", () => {
    const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const button = readFileSync(
      resolve(process.cwd(), "src/components/ui/button.tsx"),
      "utf8",
    );

    expect(globals).toContain(`--motion-enter-duration: ${ENTRANCE_DURATION_MS}ms`);
    expect(globals).toContain(`--motion-enter-easing: ${ENTRANCE_EASING}`);
    expect(globals).toContain(
      "animation: cc-route-enter var(--motion-enter-duration) var(--motion-enter-easing) backwards",
    );
    expect(globals).toContain("transform: translateY(10px)");
    expect(globals).toContain(".motion-list-delay-7 { animation-delay: 280ms; }");
    expect(button).toContain("motion-button-interaction");
    expect(globals).toContain('.motion-button-interaction:not(:disabled):not([aria-disabled="true"]):hover { translate: 0 -1px; }');
    expect(globals).toContain('.motion-button-interaction:not(:disabled):not([aria-disabled="true"]):active { translate: 0 0; scale: 0.97; }');
  });

  it("caps the 40ms stagger at item eight while retaining the first-20 limit", () => {
    expect(Array.from({ length: 20 }, (_, index) => getEntranceDelayMs(index))).toEqual([
      0, 40, 80, 120, 160, 200, 240, 280,
      280, 280, 280, 280, 280, 280, 280, 280, 280, 280, 280, 280,
    ]);
    const capture = createEntranceCapture({
      initialItems: items(21),
      getId,
      waitForSuccessfulData: false,
    });
    expect(getEntranceClassName(capture, "item-8")).toContain("motion-list-delay-7");
    expect(getEntranceClassName(capture, "item-20")).toContain("motion-list-delay-7");
    expect(getEntranceClassName(capture, "item-21")).toBeUndefined();
  });

  it("keeps progress motion mount-only, final-state-first, and timer-free", () => {
    const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const bar = readFileSync(resolve(process.cwd(), "src/components/events/home-event-progress.tsx"), "utf8");
    const ring = readFileSync(resolve(process.cwd(), "src/components/events/event-board-progress-ring.tsx"), "utf8");

    expect(globals).toContain("--motion-progress-duration: 700ms");
    expect(globals).toContain("animation: cc-progress-fill var(--motion-progress-duration) ease-out backwards");
    expect(globals).toContain("animation: cc-progress-ring var(--motion-progress-duration) ease-out backwards");
    expect(bar).toContain('className="motion-progress-fill');
    expect(bar).toContain('style={{ width: `${progress.percentage}%` }}');
    expect(ring).toContain('className="motion-progress-ring');
    expect(ring).toContain("strokeDashoffset={getProgressRingDashOffset(boundedPercentage)}");
    expect(`${bar}\n${ring}`).not.toMatch(/setTimeout|requestAnimationFrame/);
    expect(`${bar}\n${ring}`).not.toMatch(/useEffect|useState|key=/);
  });

  it("transitions Tailwind v4's individual scale property for Base UI popups", () => {
    for (const file of ["dialog.tsx", "alert-dialog.tsx", "dropdown-menu.tsx", "select.tsx"]) {
      const source = readFileSync(
        resolve(process.cwd(), `src/components/ui/${file}`),
        "utf8",
      );
      expect(source).toContain("transition-[opacity,scale]");
      expect(source).toContain("data-[starting-style]:scale-[0.94]");
    }
  });

  it.each([0, 1, 19, 20, 21])("selects the initial boundary for %i items", (count) => {
    expect(selectEntranceIds(items(count), getId).size).toBe(Math.min(count, 20));
  });

  it("uses one counter across an already flattened grouped list", () => {
    const flattened = [...items(12, "active"), ...items(12, "draft")];
    const ids = selectEntranceIds(flattened, getId);

    expect(ids.has("active-12")).toBe(true);
    expect(ids.has("draft-8")).toBe(true);
    expect(ids.has("draft-9")).toBe(false);
  });

  it("captures the first successful non-placeholder client render once", () => {
    const waiting = createEntranceCapture({
      getId,
      waitForSuccessfulData: true,
    });
    const placeholder = settleEntranceCapture({
      capture: waiting,
      items: items(3, "placeholder"),
      settled: true,
      error: null,
      isPlaceholderData: true,
      getId,
    });
    const captured = settleEntranceCapture({
      capture: placeholder,
      items: items(21, "real"),
      settled: true,
      error: null,
      isPlaceholderData: false,
      getId,
    });
    const laterPage = settleEntranceCapture({
      capture: captured,
      items: items(40, "later"),
      settled: true,
      error: null,
      isPlaceholderData: false,
      getId,
    });

    expect(placeholder.phase).toBe("waiting");
    expect(captured.phase).toBe("playing");
    expect(captured.ids.has("real-20")).toBe(true);
    expect(captured.ids.has("real-21")).toBe(false);
    expect(laterPage).toBe(captured);
  });

  it("disarms a playing capture when filtering or sorting changes its prefix", () => {
    const capture = createEntranceCapture({
      initialItems: items(20),
      getId,
      waitForSuccessfulData: false,
    });

    expect(capturedPrefixIsStable(capture, items(25), getId)).toBe(true);
    expect(capturedPrefixIsStable(capture, items(19), getId)).toBe(false);
    expect(
      capturedPrefixIsStable(capture, [...items(20)].reverse(), getId),
    ).toBe(false);
  });

  it("never arms after an initial error and retry", () => {
    const waiting = createEntranceCapture({
      getId,
      waitForSuccessfulData: true,
    });
    const failed = settleEntranceCapture({
      capture: waiting,
      items: [],
      settled: true,
      error: new Error("initial failure"),
      isPlaceholderData: false,
      getId,
    });
    const retried = settleEntranceCapture({
      capture: failed,
      items: items(5, "retry"),
      settled: true,
      error: null,
      isPlaceholderData: false,
      getId,
    });

    expect(failed.phase).toBe("done");
    expect(retried).toBe(failed);
    expect(retried.ids.size).toBe(0);
  });
});
