import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#141413" }}>
        <div style={{ fontSize: 112, fontWeight: 600, color: "#e0313c", letterSpacing: "-0.06em", marginTop: -14 }}>r</div>
      </div>
    ),
    size,
  );
}
