import { describe, expect, it } from "vitest"
import { isNavActive, navForRole } from "./nav"

const hrefs = (items: ReturnType<typeof navForRole>["all"]) =>
  items.map((item) => item.href)

describe("role navigation", () => {
  it("keeps the complete Admin navigation inventory", () => {
    const nav = navForRole("Admin")

    expect(hrefs(nav.all)).toEqual([
      "/home",
      "/workspace",
      "/archives",
      "/dashboard",
      "/activity-log",
      "/users",
      "/settings",
    ])
    expect(hrefs(nav.pinned)).toEqual([
      "/home",
      "/workspace",
      "/dashboard",
      "/settings",
    ])
    expect(hrefs(nav.more)).toEqual(["/archives", "/activity-log", "/users"])
  })

  it("keeps the complete Co-Admin navigation inventory", () => {
    const nav = navForRole("Co-Admin")

    expect(hrefs(nav.all)).toEqual([
      "/home",
      "/workspace",
      "/archives",
      "/dashboard",
      "/settings",
    ])
    expect(hrefs(nav.pinned)).toEqual([
      "/home",
      "/workspace",
      "/dashboard",
      "/settings",
    ])
    expect(hrefs(nav.more)).toEqual(["/archives"])
  })

  it("keeps the complete Member navigation inventory", () => {
    const nav = navForRole("Member")

    expect(hrefs(nav.all)).toEqual([
      "/home",
      "/workspace",
      "/archives",
      "/settings",
    ])
    expect(hrefs(nav.pinned)).toEqual(["/home", "/workspace", "/settings"])
    expect(hrefs(nav.more)).toEqual(["/archives"])
  })

  it("matches exact and nested routes without matching sibling prefixes", () => {
    expect(isNavActive("/home", "/home")).toBe(true)
    expect(isNavActive("/events/event-1", "/events")).toBe(true)
    expect(isNavActive("/homepage", "/home")).toBe(false)
    expect(isNavActive(null, "/home")).toBe(false)
  })
})
