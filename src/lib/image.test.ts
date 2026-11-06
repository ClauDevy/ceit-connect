import { describe, expect, it } from "vitest";
import { clampCropOffset, fitWidthZoom, getCropDrawPlan, minimumContainZoom } from "./image";

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

  it("leaves the offset alone until sizes are known", () => {
    expect(clampCropOffset({ x: 7, y: 8 }, null, frame, 1)).toEqual({ x: 7, y: 8 })
  })
})

describe("fitWidthZoom", () => {
  it("makes the image as wide as the frame", () => {
    expect(fitWidthZoom({ width: 640, height: 360 }, { width: 320, height: 180 }, 0.25)).toBe(0.5)
  })

  it("stays inside the allowed zoom range", () => {
    expect(fitWidthZoom({ width: 640, height: 360 }, { width: 320, height: 180 }, 0.75)).toBe(0.75)
    expect(fitWidthZoom({ width: 10, height: 10 }, { width: 320, height: 180 }, 0.5)).toBe(3)
  })
})
