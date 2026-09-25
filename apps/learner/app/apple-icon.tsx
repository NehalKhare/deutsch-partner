import { ImageResponse } from "next/og";

import { LEARNER_PALETTE } from "@dp/ui/palette";

/** The home-screen icon on iOS. Square: iOS rounds the corners itself. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 128,
            height: 128,
            borderRadius: 64,
            background: brand,
            color: onAccent,
            fontSize: 80,
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
