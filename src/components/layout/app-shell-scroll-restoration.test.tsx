// @vitest-environment happy-dom

import * as React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/home",
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { AppShellScrollArea } from "@/components/layout/app-shell-scroll-restoration";

function setRoute(pathname: string, search = "") {
  navigation.pathname = pathname;
  navigation.search = search;
  window.history.replaceState({}, "", `${pathname}${search ? `?${search}` : ""}`);
}

function setSize(element: HTMLElement, scrollHeight: number, clientHeight = 600) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
}

function renderArea() {
  return render(
    <AppShellScrollArea>
      <main>Page content</main>
    </AppShellScrollArea>,
  );
}

function getScrollArea(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-app-shell-scroll-area]")!;
}

async function saveUserScroll(element: HTMLElement, top: number) {
  fireEvent.wheel(element);
  element.scrollTop = top;
  fireEvent.scroll(element);
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function dispatchPop(destination: string) {
  window.history.replaceState({}, "", destination);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

beforeEach(() => {
  navigation.pathname = "/home";
  navigation.search = "";
  window.history.replaceState({}, "", "/home");
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppShell scroll restoration", () => {
  it("restores a saved pathname-and-search position after Back or Forward", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 700);

    setRoute("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;

    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Home</main></AppShellScrollArea>);

    expect(area.scrollTop).toBe(700);
  });

  it("records a Home Back before an earlier router listener commits Home", async () => {
    let view: ReturnType<typeof renderArea>;
    const commitHomeLikeNext = () => {
      navigation.pathname = "/home";
      view.rerender(<AppShellScrollArea><main>Home committed by router</main></AppShellScrollArea>);
    };
    window.addEventListener("popstate", commitHomeLikeNext);

    try {
      view = renderArea();
      const area = getScrollArea(view.container);
      setSize(area, 2_000);
      await saveUserScroll(area, 800);

      setRoute("/events/event-1");
      view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
      area.scrollTop = 0;

      dispatchPop("/home");

      expect(area.scrollTop).toBe(800);
    } finally {
      window.removeEventListener("popstate", commitHomeLikeNext);
    }
  });

  it("restores Back when the native query uses percent-encoded spaces", async () => {
    setRoute("/home", "filter=active%20events");
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 720);

    setRoute("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;

    navigation.pathname = "/home";
    navigation.search = "filter=active%20events";
    dispatchPop("/home?filter=active%20events");
    view.rerender(<AppShellScrollArea><main>Filtered Home</main></AppShellScrollArea>);

    expect(area.scrollTop).toBe(720);
  });

  it("clears a stale position when Home is reached by normal navigation", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 800);

    setRoute("/events/event-1");
    view.rerender(<AppShellScrollArea><main>First event</main></AppShellScrollArea>);
    area.scrollTop = 0;

    setRoute("/home");
    view.rerender(<AppShellScrollArea><main>Fresh Home</main></AppShellScrollArea>);
    expect(area.scrollTop).toBe(0);

    setRoute("/events/event-2");
    view.rerender(<AppShellScrollArea><main>Second event</main></AppShellScrollArea>);
    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Back to Home</main></AppShellScrollArea>);

    expect(area.scrollTop).toBe(0);
  });

  it("waits for Home content to become tall enough", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 900);
    vi.useFakeTimers();

    navigation.pathname = "/events/event-1";
    dispatchPop("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;
    setSize(area, 700);

    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Loading Home</main></AppShellScrollArea>);
    expect(area.scrollTop).toBe(0);

    setSize(area, 1_800);
    await act(async () => vi.advanceTimersByTime(50));
    expect(area.scrollTop).toBe(900);
  });

  it("does not restore on normal link navigation", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 650);
    area.scrollTop = 0;

    setRoute("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;
    setRoute("/home");
    view.rerender(<AppShellScrollArea><main>Linked Home</main></AppShellScrollArea>);

    expect(area.scrollTop).toBe(0);
  });

  it("ignores a same-path modal or guard popstate", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 500);
    area.scrollTop = 120;

    window.history.replaceState({ __ceitConnectModal: { id: "modal-1", version: 1 } }, "", "/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
    view.rerender(<AppShellScrollArea><main>Same Home</main></AppShellScrollArea>);

    expect(area.scrollTop).toBe(120);
  });

  it("cancels a pending restore when the user scrolls first", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 800);
    vi.useFakeTimers();

    navigation.pathname = "/events/event-1";
    dispatchPop("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;
    setSize(area, 700);

    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Loading Home</main></AppShellScrollArea>);
    fireEvent.wheel(area);
    area.scrollTop = 40;
    fireEvent.scroll(area);
    setSize(area, 2_000);
    await act(async () => vi.advanceTimersByTime(2_100));

    expect(area.scrollTop).toBe(40);
  });

  it("does nothing when storage is empty or invalid", () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    area.scrollTop = 110;

    navigation.pathname = "/events/event-1";
    dispatchPop("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Home</main></AppShellScrollArea>);
    expect(area.scrollTop).toBe(110);

    window.sessionStorage.setItem("ceit-connect:app-shell-scroll:v1", "not-json");
    dispatchPop("/events/event-2");
    navigation.pathname = "/events/event-2";
    view.rerender(<AppShellScrollArea><main>Other event</main></AppShellScrollArea>);
    expect(area.scrollTop).toBe(110);
  });

  it("does not move when the destination stays permanently shorter", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 800);
    vi.useFakeTimers();

    navigation.pathname = "/events/event-1";
    dispatchPop("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;
    setSize(area, 700);
    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Short Home</main></AppShellScrollArea>);

    await act(async () => vi.advanceTimersByTime(2_100));
    expect(area.scrollTop).toBe(0);
  });

  it("does not overwrite Home with a short page clamp before Back", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 800);

    setRoute("/events/event-1");
    navigation.pathname = "/events/event-1";
    view.rerender(<AppShellScrollArea><main>Short event</main></AppShellScrollArea>);
    setSize(area, 600);
    area.scrollTop = 0;
    fireEvent.scroll(area);

    navigation.pathname = "/home";
    dispatchPop("/home");
    setSize(area, 2_000);
    view.rerender(<AppShellScrollArea><main>Home</main></AppShellScrollArea>);

    expect(area.scrollTop).toBe(800);
  });

  it("does not carry departing-page scroll intent into a delayed Back restore", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 800);

    setRoute("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    vi.useFakeTimers();
    fireEvent.wheel(area);
    area.scrollTop = 300;
    fireEvent.scroll(area);

    setSize(area, 700);
    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Loading Home</main></AppShellScrollArea>);
    area.scrollTop = 0;
    fireEvent.scroll(area);

    setSize(area, 2_000);
    await act(async () => vi.advanceTimersByTime(50));

    expect(area.scrollTop).toBe(800);
    const stored = JSON.parse(
      window.sessionStorage.getItem("ceit-connect:app-shell-scroll:v1")!,
    ) as { entries: Array<{ key: string; top: number }> };
    expect(stored.entries).toContainEqual({ key: "/home", top: 800 });
  });

  it("keeps only the 50 most recently scrolled page positions", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);

    for (let index = 0; index < 51; index += 1) {
      setRoute(`/page-${index}`);
      navigation.pathname = `/page-${index}`;
      view.rerender(<AppShellScrollArea><main>Page {index}</main></AppShellScrollArea>);
      await saveUserScroll(area, index + 1);
    }

    const stored = JSON.parse(
      window.sessionStorage.getItem("ceit-connect:app-shell-scroll:v1")!,
    ) as { entries: Array<{ key: string }> };
    expect(stored.entries).toHaveLength(50);
    expect(stored.entries[0]?.key).toBe("/page-1");
    expect(stored.entries.at(-1)?.key).toBe("/page-50");
  });

  it("saves a touch drag that continues after the initial session expires", async () => {
    vi.useFakeTimers();
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);

    fireEvent.touchStart(area);
    await act(async () => vi.advanceTimersByTime(201));
    fireEvent.touchMove(area);
    area.scrollTop = 640;
    fireEvent.scroll(area);
    await act(async () => vi.advanceTimersByTime(20));

    const stored = JSON.parse(
      window.sessionStorage.getItem("ceit-connect:app-shell-scroll:v1")!,
    ) as { entries: Array<{ key: string; top: number }> };
    expect(stored.entries).toContainEqual({ key: "/home", top: 640 });
  });

  it("cleans up a pending retry when unmounted", async () => {
    const view = renderArea();
    const area = getScrollArea(view.container);
    setSize(area, 2_000);
    await saveUserScroll(area, 750);
    vi.useFakeTimers();
    navigation.pathname = "/events/event-1";
    dispatchPop("/events/event-1");
    view.rerender(<AppShellScrollArea><main>Event</main></AppShellScrollArea>);
    area.scrollTop = 0;
    setSize(area, 700);
    navigation.pathname = "/home";
    dispatchPop("/home");
    view.rerender(<AppShellScrollArea><main>Loading Home</main></AppShellScrollArea>);

    view.unmount();
    setSize(area, 2_000);
    await act(async () => vi.advanceTimersByTime(2_100));
    expect(area.scrollTop).toBe(0);
  });
});
