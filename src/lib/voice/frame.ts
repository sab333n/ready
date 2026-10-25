// One JPEG of whatever the teacher has on: camera, screen, board, diagram.
// Pictures are sent to the live students. They are not treated as speech.

export function composeFrame(sources: CanvasImageSource[], width = 1280, height = 720): string | null {
  const live = sources.filter(Boolean);
  if (live.length === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (live.length === 1) draw(ctx, live[0], 0, 0, width, height);
  else if (live.length === 2) {
    draw(ctx, live[0], 0, 0, width / 2, height);
    draw(ctx, live[1], width / 2, 0, width / 2, height);
  } else {
    draw(ctx, live[0], 0, 0, width, height / 2);
    const rest = live.slice(1, 3);
    rest.forEach((source, index) => draw(ctx, source, (width / rest.length) * index, height / 2, width / rest.length, height / 2));
  }
  const url = canvas.toDataURL("image/jpeg", 0.55);
  return url.split(",")[1] ?? null;
}

function draw(ctx: CanvasRenderingContext2D, source: CanvasImageSource, x: number, y: number, w: number, h: number) {
  try {
    ctx.drawImage(source, x, y, w, h);
  } catch {
    /* a video element that isn't ready yet */
  }
}
