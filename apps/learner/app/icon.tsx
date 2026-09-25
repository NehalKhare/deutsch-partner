import { ImageResponse } from "next/og";

import { LEARNER_PALETTE } from "@dp/ui/palette";

/**
 * The app icon at the size a manifest and a search result want. A brand
 * circle on the ground colour, the same mark the share card opens with.
 */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  const { ground, brand, onAccent } = LEARNER_PALETTE.dark;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: ground,
          borderRadius: 96,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 360,
            height: 360,
            borderRadius: 180,
            background: brand,
            color: onAccent,
            fontSize: 220,
            fontWeight: 700,
            fontFamily: "sans-serif",
          }}
        >
          D
        </div>
      </div>
    ),
    { ...size },
  );
}
