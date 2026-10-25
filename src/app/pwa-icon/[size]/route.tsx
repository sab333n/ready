import { ImageResponse } from "next/og";

// The home-screen icon: the red "r" from the front page on the app's dark background.
export async function GET(_: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size: raw } = await ctx.params;
  const size = Math.min(512, Math.max(48, Number(raw) || 192));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#141413" }}>
        <div style={{ fontSize: size * 0.62, fontWeight: 600, color: "#e0313c", letterSpacing: "-0.06em", marginTop: -size * 0.08 }}>r</div>
      </div>
    ),
    { width: size, height: size },
  );
}
