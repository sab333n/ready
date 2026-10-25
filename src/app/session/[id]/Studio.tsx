"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { useVoiceClass } from "./useVoiceClass";

type Voice = ReturnType<typeof useVoiceClass>;

export function Studio({ voice }: { voice: Voice }) {
  const camera = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLVideoElement>(null);
  const board = useRef<HTMLCanvasElement>(null);
  const diagram = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    voice.bind({ camera: camera.current, screen: screen.current, board: board.current, diagram: diagram.current });
  });

  useEffect(() => {
    const canvas = diagram.current;
    if (!canvas || !voice.diagram) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    img.src = `data:${voice.diagram.mime};base64,${voice.diagram.base64}`;
  }, [voice.diagram]);

  usePen(board, voice.boardOn, true);
  usePen(diagram, Boolean(voice.diagram), false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tool on={voice.cameraOn} label="Camera" click={() => void voice.toggleCamera()} />
        <Tool on={voice.screenOn} label="Screen" click={() => void voice.toggleScreen()} />
        <Tool on={voice.boardOn} label="Board" click={() => voice.toggleBoard()} />
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Language
          <select
            aria-label="Class language"
            className="rounded-full border border-border bg-card px-2 py-1 text-sm text-foreground"
            value={voice.language}
            onChange={(event) => voice.setClassLanguage(event.target.value as Voice["language"])}
          >
            {voice.languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
      </div>
      {voice.tip && <p className="text-sm text-gold">{voice.tip}</p>}
      <video ref={camera} className={voice.cameraOn ? "max-h-40 rounded-xl bg-black" : "hidden"} muted playsInline />
      <video ref={screen} className={voice.screenOn ? "max-h-40 rounded-xl bg-black" : "hidden"} muted playsInline />
      <canvas ref={board} width={960} height={540} className={voice.boardOn ? "w-full touch-none rounded-xl border border-border bg-white" : "hidden"} aria-label="Whiteboard" />
      {voice.diagram && (
        <div className="rounded-xl border border-border bg-card p-2">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>They can see this diagram.</span>
            <button type="button" className="rounded-full border border-border px-3 py-1" onClick={() => voice.closeDiagram()}>
              Close
            </button>
          </div>
          <canvas ref={diagram} width={960} height={540} className="w-full touch-none rounded-xl bg-white" aria-label="Diagram" />
        </div>
      )}
    </div>
  );
}

function Tool({ on, label, click }: { on: boolean; label: string; click: () => void }) {
  return (
    <button type="button" onClick={click} className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-gold text-gold" : "border-border"}`}>
      {label}
    </button>
  );
}

const inked = new WeakSet<HTMLCanvasElement>();

function usePen(canvas: RefObject<HTMLCanvasElement | null>, enabled: boolean, fill: boolean) {
  useEffect(() => {
    const el = canvas.current;
    if (!el || !enabled) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    if (fill && !inked.has(el)) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, el.width, el.height);
      inked.add(el);
    }
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    let drawing = false;
    const point = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: ((event.clientX - rect.left) / rect.width) * el.width, y: ((event.clientY - rect.top) / rect.height) * el.height };
    };
    const down = (event: PointerEvent) => {
      drawing = true;
      const at = point(event);
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
    };
    const move = (event: PointerEvent) => {
      if (!drawing) return;
      const at = point(event);
      ctx.lineTo(at.x, at.y);
      ctx.stroke();
    };
    const up = () => {
      drawing = false;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [canvas, enabled, fill]);
}
