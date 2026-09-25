import { ImageResponse } from "next/og";

import { LEARNER_PALETTE } from "@dp/ui/palette";

import { OG_IMAGE_ALT } from "@/lib/seo/metadata";
import { SITE } from "@/lib/seo/site";

/**
 * The share card: what a link to the site looks like in a chat or a feed.
 *
 * Rendered here rather than kept as a PNG so it can never fall behind the
 * copy or the palette. The card says what the page says — the German first,
 * the English underneath — in the theme's own colours, read from the same
 * source the manifest reads.
 */
export const alt = OG_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const { ground, panel, edge, copy, brand } = LEARNER_PALETTE.dark;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 72,
          background: ground,
          color: copy,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: brand,
            }}
          />
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{SITE.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 108, fontWeight: 700, lineHeight: 0.95, letterSpacing: -3 }}>
            Sprich einfach los.
          </div>
          <div style={{ fontSize: 44, color: brand }}>Just start talking.</div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${edge}`,
            paddingTop: 28,
            fontSize: 28,
            opacity: 0.8,
          }}
        >
          <div>An AI conversation partner for learning German, from your first word to B1.</div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 999,
              background: panel,
              border: `2px solid ${edge}`,
              fontSize: 24,
            }}
          >
            Free to start
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
