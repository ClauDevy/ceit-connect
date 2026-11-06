import { describe, expect, it } from "vitest";
import { clampCropOffset, fitCoverZoom, getCropDrawPlan, minimumContainZoom } from "./image";

describe("minimumContainZoom", () => {
  it("zooms a landscape image out until its full width fits", () => {
    expect(
      minimumContainZoom(
        { width: 480, height: 240 },
        { width: 240, height: 240 },
      ),
    ).toBe(0.5);
  });

  it("zooms a portrait image out until its full height fits", () => {
    expect(
      minimumContainZoom(
        { width: 240, height: 480 },
        { width: 240, height: 240 },
      ),
    ).toBe(0.5);
  });

  it("contains a square image using either equal ratio", () => {
    expect(
      minimumContainZoom(
        { width: 480, height: 480 },
        { width: 240, height: 240 },
      ),
    ).toBe(0.5);
  });

  it("does not enlarge a small image to calculate the minimum", () => {
    expect(
      minimumContainZoom(
        { width: 200, height: 200 },
        { width: 240, height: 240 },
      ),
    ).toBe(1);
  });

  it.each([
    ["wide", { width: 1600, height: 600 }, 0.2],
    ["tall", { width: 600, height: 1600 }, 0.1125],
  ])("contains the whole %s banner image in a 16:9 frame", (_, media, expected) => {
    expect(minimumContainZoom(media, { width: 320, height: 180 })).toBe(
      expected,
    );
  });
});

describe("getCropDrawPlan", () => {
  it("caps a huge zoomed-out canvas and scales the picture and padding together", () => {
    const plan = getCropDrawPlan(
      { width: 8000, height: 8000 },
      { x: -16000, y: -16000, width: 40000, height: 40000 },
    )
    expect(plan.output).toEqual({ width: 4096, height: 4096 })
    expect(plan.source).toEqual({ x: 0, y: 0, width: 8000, height: 8000 })
    expect(plan.destination!.x).toBeCloseTo(1638.4)
    expect(plan.destination!.width).toBeCloseTo(819.2)
  })

  it("places an image without distortion inside a larger square crop", () => {
    expect(
      getCropDrawPlan(
        { width: 100, height: 50 },
        { x: -25, y: -50, width: 150, height: 150 },
      ),
    ).toEqual({
      output: { width: 150, height: 150 },
      source: { x: 0, y: 0, width: 100, height: 50 },
      destination: { x: 25, y: 50, width: 100, height: 50 },
    });
  });

  it("places a tall image without distortion in a transparent 16:9 crop", () => {
    expect(
      getCropDrawPlan(
        { width: 90, height: 160 },
        { x: -115, y: 0, width: 320, height: 180 },
      ),
    ).toEqual({
      output: { width: 320, height: 180 },
      source: { x: 0, y: 0, width: 90, height: 160 },
      destination: { x: 115, y: 0, width: 90, height: 160 },
    });
  });
});

describe("clampCropOffset", () => {
  const frame = { width: 320, height: 180 }

  it("keeps the frame inside a zoomed-in image", () => {
    const media = { width: 640, height: 360 }
    expect(clampCropOffset({ x: 999, y: -999 }, media, frame, 1)).toEqual({ x: 160, y: -90 })
    expect(clampCropOffset({ x: 10, y: 5 }, media, frame, 1)).toEqual({ x: 10, y: 5 })
  })

  it("keeps a smaller-than-frame image centred", () => {
    const media = { width: 160, height: 90 }
    expect(clampCropOffset({ x: 50, y: 50 }, media, frame, 1)).toEqual({ x: 0, y: 0 })
  })

  it("lets a zoomed-out image move freely but never out of the frame", () => {
    const media = { width: 160, height: 90 }
    expect(clampCropOffset({ x: 50, y: 0 }, media, frame, 1, "free")).toEqual({ x: 50, y: 0 })
    expect(clampCropOffset({ x: 9999, y: 0 }, media, frame, 1, "free").x).toBe(160)
  })

  it("scales the limits with zoom in both modes", () => {
    const media = { width: 640, height: 360 }
    // Inside: zoomed in gives more room, zoomed exactly to the frame gives none.
    expect(clampCropOffset({ x: 9999, y: -9999 }, media, frame, 2)).toEqual({ x: 480, y: -270 })
    const exact = clampCropOffset({ x: 9999, y: -9999 }, media, frame, 0.5)
    expect(Math.abs(exact.x)).toBe(0)
    expect(Math.abs(exact.y)).toBe(0)
    // Free: the allowed travel grows and shrinks with the zoomed image size.
    const small = { width: 160, height: 90 }
    expect(clampCropOffset({ x: 9999, y: -9999 }, small, frame, 2, "free")).toEqual({ x: 240, y: -135 })
    expect(clampCropOffset({ x: 9999, y: -9999 }, small, frame, 0.5, "free")).toEqual({ x: 120, y: -67.5 })
  })

  it("leaves the offset alone until sizes are known", () => {
    expect(clampCropOffset({ x: 7, y: 8 }, null, frame, 1)).toEqual({ x: 7, y: 8 })
  })
})

describe("fitCoverZoom", () => {
  it("covers the frame when the picture is wider than the frame shape", () => {
    // Landscape picture, square frame: height decides, so no blank band above or below.
    expect(fitCoverZoom({ width: 400, height: 200 }, { width: 200, height: 200 }, 0.2, 3)).toBe(1)
  })


  it("makes a same-shaped image as wide as the frame", () => {
    expect(fitCoverZoom({ width: 640, height: 360 }, { width: 320, height: 180 }, 0.25)).toBe(0.5)
  })

  it("stays inside the allowed zoom range", () => {
    expect(fitCoverZoom({ width: 640, height: 360 }, { width: 320, height: 180 }, 0.75)).toBe(0.75)
    expect(fitCoverZoom({ width: 10, height: 10 }, { width: 320, height: 180 }, 0.5)).toBe(3)
  })
})
