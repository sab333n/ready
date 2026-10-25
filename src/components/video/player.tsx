"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Scene } from "@/lib/video/script";

// Plays a lesson as narrated slides: one clip per scene, on-screen points that
// appear as the narration reaches them, and captions. Scenes without a clip use
// the browser's own voice so a video always plays.
export function LessonPlayer({
  videoId,
  title,
  topic,
  scenes,
  audioScenes,
  onStarted,
  onFinished,
  endCard,
}: {
  videoId: string;
  title: string;
  topic: string;
  scenes: Scene[];
  audioScenes: number[];
  onStarted?: () => void;
  onFinished?: () => void;
  endCard?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 within the scene
  const [done, setDone] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const speech = useRef<{ start: number; length: number; timer?: number } | null>(null);
  const finishedOnce = useRef(false);

  const scene = scenes[index];
  const hasClip = audioScenes.includes(index);

  const stopSpeech = () => {
    if (speech.current?.timer) window.clearInterval(speech.current.timer);
    speech.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const next = useCallback(() => {
    stopSpeech();
    if (index + 1 < scenes.length) {
      setIndex(index + 1);
      setProgress(0);
    } else {
      setPlaying(false);
      setDone(true);
      if (!finishedOnce.current) {
        finishedOnce.current = true;
        onFinished?.();
      }
    }
  }, [index, scenes.length, onFinished]);

  // Start (or resume) the current scene whenever it changes while playing.
  useEffect(() => {
    if (!started || !playing || done) return;
    if (hasClip) {
      const el = audio.current;
      if (!el) return;
      el.play().catch(() => setPlaying(false));
      return () => el.pause();
    }
    // Browser voice: estimate progress from the length of the narration.
    if (typeof speechSynthesis === "undefined") {
      const t = setTimeout(next, 6000);
      return () => clearTimeout(t);
    }
    const u = new SpeechSynthesisUtterance(scene.narration);
    u.rate = 1;
    u.onend = () => next();
    const length = Math.max(4000, (scene.narration.split(/\s+/).length / 2.6) * 1000);
    speech.current = { start: Date.now(), length };
    speech.current.timer = window.setInterval(() => {
      if (speech.current) setProgress(Math.min(1, (Date.now() - speech.current.start) / speech.current.length));
    }, 200);
    window.speechSynthesis.speak(u);
    return stopSpeech;
  }, [started, playing, index, hasClip, done, next, scene.narration]);

  useEffect(() => stopSpeech, []);

  function play() {
    if (!started) onStarted?.();
    if (done) {
      setDone(false);
      setIndex(0);
      setProgress(0);
    }
    setStarted(true);
    setPlaying(true);
  }

  function jump(i: number) {
    stopSpeech();
    setDone(false);
    setIndex(i);
    setProgress(0);
  }

  const sentences = scene.narration.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [scene.narration];
  const caption = sentenceAt(sentences, progress);
  const total = scenes.length;
  const overall = (index + (done ? 1 : progress)) / total;

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-[#0e0e10] text-[#f2f0ea] shadow-[0_24px_60px_rgba(0,0,0,0.25)]">
      <div className="relative aspect-[4/3] w-full sm:aspect-video">
        <div
          className="absolute inset-0"
          aria-hidden
          style={{ background: "radial-gradient(ellipse at 15% 20%, rgba(224,49,60,.28), transparent 55%), radial-gradient(ellipse at 85% 90%, rgba(60,90,255,.22), transparent 55%)" }}
        />
        {hasClip && (
          <audio
            ref={audio}
            key={index}
            src={`/api/videos/${videoId}/audio/${index}`}
            preload="auto"
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration) setProgress(el.currentTime / el.duration);
            }}
            onEnded={next}
          />
        )}
        {!started ? (
          <button type="button" onClick={play} className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <span className="text-xs tracking-[0.2em] text-[#f2f0ea]/60 uppercase">{topic}</span>
            <span className="max-w-[80%] text-2xl font-semibold tracking-tight sm:text-4xl">{title}</span>
            <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#f2f0ea] px-5 py-2.5 text-sm font-semibold text-[#111]">▶ Play · {total} scenes</span>
          </button>
        ) : done ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">{endCard ?? <p className="text-xl font-semibold">That&apos;s the lesson.</p>}</div>
        ) : (
          <div className="absolute inset-0 flex flex-col justify-center gap-3 px-[7%] py-[6%] sm:gap-4">
            <p className="text-xs tracking-[0.2em] text-[#f2f0ea]/55 uppercase">
              {index + 1} / {total} · {topic}
            </p>
            <h2 className="text-xl leading-tight font-semibold tracking-tight sm:text-4xl">{scene.title}</h2>
            <ul className="flex flex-col gap-1.5 sm:gap-3">
              {scene.points.map((point, i) => (
                <li
                  key={point}
                  className="flex items-start gap-2.5 text-sm transition-all duration-700 sm:gap-3 sm:text-xl"
                  style={{ opacity: progress >= i / (scene.points.length + 0.5) ? 1 : 0, transform: `translateY(${progress >= i / (scene.points.length + 0.5) ? 0 : 8}px)` }}
                >
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#e0313c] sm:mt-2.5" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}
        {started && !done && (
          <p className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/80 to-transparent px-[7%] pt-8 pb-3 text-center text-base text-[#f2f0ea]/90 sm:block">
            {caption}
          </p>
        )}
      </div>
      {/* On phones the slide is too small to share with captions, so they sit underneath. */}
      {started && !done && <p className="min-h-[4.5rem] border-t border-white/10 px-4 py-2.5 text-sm text-[#f2f0ea]/90 sm:hidden">{caption}</p>}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => (playing ? setPlaying(false) : play())}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f2f0ea] text-sm font-bold text-[#111]"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="flex flex-1 items-center gap-1.5" role="group" aria-label="Scenes">
          {scenes.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jump(i)}
              title={s.title}
              aria-label={`Scene ${i + 1}: ${s.title}`}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f2f0ea]/20"
            >
              <span className="block h-full bg-[#f2f0ea]" style={{ width: `${i < index || done ? 100 : i === index ? progress * 100 : 0}%` }} />
            </button>
          ))}
        </div>
        <span className="w-10 text-right text-xs text-[#f2f0ea]/60 tabular-nums">{Math.round(overall * 100)}%</span>
      </div>
    </div>
  );
}

/** The caption sentence for this point in the scene, weighting sentences by length. */
function sentenceAt(sentences: string[], progress: number) {
  const total = sentences.reduce((n, s) => n + s.length, 0) || 1;
  let acc = 0;
  for (const s of sentences) {
    acc += s.length;
    if (progress <= acc / total) return s;
  }
  return sentences.at(-1) ?? "";
}
