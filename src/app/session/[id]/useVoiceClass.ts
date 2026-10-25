"use client";

// Live classroom in the browser, in the style of a Dasko class.
//   ears:   the mic is 16 kHz PCM, fanned out to every student. They hear the
//           teacher and answer on their own. A loudness detector cuts them off
//           when the teacher talks over them.
//   brain:  the server still records what was said, and a YOUR TURN note can
//           make one student say a planted mistake.
//   voices: one Gemini Live session per AI student, on a short-lived token.
//           Only one student is heard at a time. Naming them makes them next.
import { useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { base64ToBytes, downsamplePcm16Base64, pcm16ToFloat32, rms, sampleRateOf, OUTPUT_SAMPLE_RATE } from "@/lib/voice/audio";
import { BargeInDetector } from "@/lib/voice/barge-in";
import { composeFrame } from "@/lib/voice/frame";
import { classLine, interruptedLine, yourTurn } from "@/lib/voice/messages";
import { CLASS_LANGUAGES, isDiagramRequest, languageCue, languageNote, type ClassLanguage } from "@/lib/voice/studio";

const SPEECH_LANG: Record<ClassLanguage, string> = {
  English: "en-US",
  Spanish: "es-ES",
  French: "fr-FR",
  German: "de-DE",
  Portuguese: "pt-BR",
  Hindi: "hi-IN",
  Arabic: "ar-SA",
  "Simplified Chinese": "zh-CN",
};
import { coachTipAction, drawDiagramAction, personaSaidAction, sayAction, setModeAction, voiceSeatsAction } from "../actions";
import type { LessonView } from "../view";

const UTTERANCE_GAP_MS = 1100; // silence that ends the learner's turn
const IDLE_MS = 120_000; // then a 30 s "still there?" countdown
const IDLE_COUNTDOWN_S = 30;
const BLACKOUT_MS = 1500; // ignore the mic right after a session opens
const SPEECH_RMS = 0.02; // loud enough to count as the teacher talking
const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } };

function permissionMessage(err: unknown, device: "microphone" | "camera" | "screen") {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return `Allow the ${device} for this site in the browser bar, then try again.`;
  }
  return err instanceof Error ? err.message : `Couldn't use the ${device}.`;
}

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

type Turn = { persona: string; text: string; interrupted: boolean; done: boolean };

export function useVoiceClass({ view, onView, onError }: { view: LessonView; onView: (v: LessonView) => void; onError: (e: string | null) => void }) {
  const [on, setOn] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [live, setLive] = useState<{ persona: string; text: string } | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [idle, setIdle] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [boardOn, setBoardOn] = useState(false);
  const [language, setLanguage] = useState<ClassLanguage>("English");
  const [tip, setTip] = useState<string | null>(null);
  const [diagram, setDiagram] = useState<{ base64: string; mime: string } | null>(null);

  const r = useRef({
    sessions: new Map<string, Session>(),
    names: new Map<string, string>(),
    playCtx: null as AudioContext | null,
    micCtx: null as AudioContext | null,
    mic: null as MediaStream | null,
    processor: null as ScriptProcessorNode | null,
    sources: [] as AudioBufferSourceNode[],
    playEnd: 0,
    turn: null as Turn | null,
    active: null as string | null,
    addressed: null as string | null,
    openedAt: 0,
    recognition: null as Recognition | null,
    utterance: "",
    teacherSpeaking: false,
    bargedIn: false,
    gapTimer: 0 as ReturnType<typeof setTimeout> | 0,
    meter: 0 as ReturnType<typeof setInterval> | 0,
    idleTimer: 0 as ReturnType<typeof setInterval> | 0,
    lastActivity: 0,
    on: false,
    surfaces: { camera: null as HTMLVideoElement | null, screen: null as HTMLVideoElement | null, board: null as HTMLCanvasElement | null, diagram: null as HTMLCanvasElement | null },
    cameraStream: null as MediaStream | null,
    screenStream: null as MediaStream | null,
    cameraOn: false,
    screenOn: false,
    boardOn: false,
    language: "English" as ClassLanguage,
    frameTimer: 0 as ReturnType<typeof setInterval> | 0,
    teacherTurns: 0,
    diagram: null as { base64: string; mime: string } | null,
    preparedMic: null as Promise<MediaStream> | null,
    hear: false,
    holdMic: false,
    wasLoud: false,
    quietSince: 0,
    replyWait: 0 as ReturnType<typeof setTimeout> | 0,
    nextListener: null as string | null,
  });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const playing = () => {
    const ctx = r.current.playCtx;
    return Boolean(ctx && ctx.currentTime < r.current.playEnd);
  };

  function send(persona: string, text: string, turnComplete: boolean) {
    try {
      r.current.sessions.get(persona)?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete });
    } catch (err) {
      console.error("voice send failed", err);
    }
  }

  function bind(next: { camera?: HTMLVideoElement | null; screen?: HTMLVideoElement | null; board?: HTMLCanvasElement | null; diagram?: HTMLCanvasElement | null }) {
    Object.assign(r.current.surfaces, next);
  }

  function pushPicture(b64: string, mime: string) {
    if (!r.current.on || Date.now() - r.current.openedAt < BLACKOUT_MS) return;
    for (const session of r.current.sessions.values()) {
      try {
        session.sendRealtimeInput({ video: { data: b64, mimeType: mime } });
      } catch {
        /* a seat that already closed */
      }
    }
  }

  function pushNote(text: string) {
    for (const session of r.current.sessions.values()) {
      try {
        session.sendRealtimeInput({ text });
      } catch {
        /* a seat that already closed */
      }
    }
  }

  function seeing() {
    return r.current.cameraOn || r.current.screenOn || r.current.boardOn || Boolean(r.current.diagram);
  }

  /** One frame of the board, camera, screen, or diagram. Skipped while a student is answering so the picture does not cancel their turn. */
  function flushFrame() {
    if (r.current.turn) return;
    const box = r.current.surfaces;
    const sources: CanvasImageSource[] = [];
    if (r.current.cameraOn && box.camera && box.camera.readyState >= 2) sources.push(box.camera);
    if (r.current.screenOn && box.screen && box.screen.readyState >= 2) sources.push(box.screen);
    if (r.current.boardOn && box.board) sources.push(box.board);
    if (r.current.diagram && box.diagram) sources.push(box.diagram);
    const shot = composeFrame(sources);
    if (shot) pushPicture(shot, "image/jpeg");
  }

  function ensureFrames() {
    if (r.current.frameTimer) return;
    r.current.frameTimer = setInterval(flushFrame, 1200);
  }

  function applyLanguage(next: ClassLanguage) {
    if (r.current.language === next) return;
    r.current.language = next;
    setLanguage(next);
    pushNote(languageNote(next));
    setStatus(`Class language is ${next}.`);
  }

  async function requestDiagram(teacherText: string, speaker: string) {
    setStatus("Drawing that…");
    const image = await drawDiagramAction(viewRef.current.id, teacherText);
    if (!r.current.on) return;
    if (image.error || !image.base64) {
      onError(image.error ?? "Couldn't draw that.");
      setStatus("Listening. Keep teaching.");
      return;
    }
    const mime = image.mime ?? "image/png";
    r.current.diagram = { base64: image.base64, mime };
    setDiagram(r.current.diagram);
    pushPicture(image.base64, mime);
    ensureFrames();
    speak(speaker, teacherText, "You just sketched this on the board. The picture is in front of you. Say one short line that you drew it, then ask one short question about what it shows.");
  }

  async function toggleCamera() {
    try {
    if (r.current.cameraStream) {
      r.current.cameraStream.getTracks().forEach((track) => track.stop());
      r.current.cameraStream = null;
      r.current.cameraOn = false;
      if (r.current.surfaces.camera) r.current.surfaces.camera.srcObject = null;
      setCameraOn(false);
      return;
    }
    const video = r.current.surfaces.camera;
    if (!video) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    video.srcObject = stream;
    await video.play();
    r.current.cameraStream = stream;
    r.current.cameraOn = true;
    setCameraOn(true);
    ensureFrames();
    } catch (err) {
      onError(permissionMessage(err, "camera"));
    }
  }

  async function toggleScreen() {
    try {
    if (r.current.screenStream) {
      r.current.screenStream.getTracks().forEach((track) => track.stop());
      r.current.screenStream = null;
      r.current.screenOn = false;
      if (r.current.surfaces.screen) r.current.surfaces.screen.srcObject = null;
      setScreenOn(false);
      return;
    }
    const video = r.current.surfaces.screen;
    if (!video) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      r.current.screenStream = null;
      r.current.screenOn = false;
      setScreenOn(false);
    });
    r.current.screenStream = stream;
    r.current.screenOn = true;
    setScreenOn(true);
    ensureFrames();
    } catch (err) {
      onError(permissionMessage(err, "screen"));
    }
  }

  function toggleBoard() {
    r.current.boardOn = !r.current.boardOn;
    setBoardOn(r.current.boardOn);
    if (r.current.boardOn) ensureFrames();
  }

  function closeDiagram() {
    r.current.diagram = null;
    setDiagram(null);
  }

  /** One student hears the teacher for this turn, so the others don't all answer at once. */
  function listener() {
    const ids = [...r.current.sessions.keys()];
    if (r.current.addressed && ids.includes(r.current.addressed)) return r.current.addressed;
    if (r.current.nextListener && ids.includes(r.current.nextListener)) return r.current.nextListener;
    return ids[0] ?? null;
  }

  function advanceListener() {
    const ids = [...r.current.sessions.keys()];
    const current = listener();
    if (!current || ids.length < 2) return;
    r.current.nextListener = ids[(ids.indexOf(current) + 1) % ids.length];
  }

  /** Live audio goes to every student. Nothing is sent during the open blackout, or after the teacher has paused. */
  function pushMic(b64: string) {
    if (r.current.holdMic || Date.now() - r.current.openedAt < BLACKOUT_MS) return;
    for (const session of r.current.sessions.values()) {
      try {
        session.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } });
      } catch {
        /* a seat that already closed */
      }
    }
  }

  /** The teacher paused. Close the audio so the class knows the turn is over and someone should answer. */
  function endTeacherTurn() {
    if (r.current.holdMic || r.current.turn || r.current.sessions.size === 0) return;
    r.current.holdMic = true;
    if (seeing()) flushFrame();
    for (const session of r.current.sessions.values()) {
      try {
        session.sendRealtimeInput({ audioStreamEnd: true });
      } catch {
        /* a seat that already closed */
      }
    }
    if (r.current.replyWait) clearTimeout(r.current.replyWait);
    r.current.replyWait = setTimeout(() => {
      r.current.holdMic = false;
      if (!r.current.on || r.current.turn || playing()) return;
      const id = listener();
      if (!id) return;
      const said = r.current.utterance.trim();
      speak(id, said || null, said ? null : "The teacher just paused. Answer in one short spoken line.");
    }, 1500);
  }

  /** One student is heard at a time. Saying a name reserves the next answer for them. */
  function claim(persona: string): boolean {
    const addressed = r.current.addressed;
    if (addressed && addressed !== persona && r.current.active === null) return false;
    if (r.current.active === null) {
      r.current.active = persona;
      if (addressed === persona) r.current.addressed = null;
      setSpeaking(persona);
      return true;
    }
    return r.current.active === persona;
  }

  function broadcast(except: string | null, text: string) {
    for (const id of r.current.sessions.keys()) if (id !== except) send(id, text, false);
  }

  /** Asks one student to speak. Called after the server picks the speaker. */
  function speak(persona: string, teacherText: string | null, note: string | null) {
    if (!r.current.on) return;
    if (r.current.replyWait) clearTimeout(r.current.replyWait);
    r.current.replyWait = 0;
    if (teacherText) broadcast(persona, classLine("Teacher", teacherText));
    r.current.turn = { persona, text: "", interrupted: false, done: false };
    r.current.active = persona;
    setSpeaking(persona);
    setLive({ persona, text: "" });
    setStatus(`${r.current.names.get(persona)} is talking. Interrupt anytime.`);
    try {
      r.current.sessions.get(persona)?.sendRealtimeInput({ text: yourTurn(teacherText, note) });
    } catch (err) {
      console.error("voice cue failed", err);
    }
  }

  function enqueueAudio(b64: string, mimeType?: string) {
    const ctx = r.current.playCtx;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const samples = pcm16ToFloat32(base64ToBytes(b64));
    const buffer = ctx.createBuffer(1, samples.length, sampleRateOf(mimeType));
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, r.current.playEnd);
    src.start(at);
    r.current.playEnd = at + buffer.duration;
    r.current.sources.push(src);
    src.onended = () => (r.current.sources = r.current.sources.filter((s) => s !== src));
  }

  function onMessage(persona: string, msg: LiveServerMessage) {
    const content = msg.serverContent;
    if (!content) return;
    const heard = content.inputTranscription?.text;
    // The browser transcript is the one that asks for a reply. Gemini's copy would file the same line twice.
    if (heard && !r.current.recognition && persona === r.current.sessions.keys().next().value) noteTeacher(heard);
    // A fresh picture can look like an interruption. Only the teacher's voice cuts a student off.
    if (content.interrupted && r.current.active === persona && r.current.teacherSpeaking) bargeIn();

    const mine = r.current.active === persona || r.current.turn?.persona === persona;
    const incoming = Boolean(content.outputTranscription?.text || content.modelTurn?.parts?.some((p) => p.inlineData?.data));
    if (incoming && !mine && !claim(persona)) return;
    if (r.current.active !== persona && r.current.turn?.persona !== persona) return;

    let turn = r.current.turn;
    if (!turn || turn.persona !== persona) {
      if (r.current.replyWait) clearTimeout(r.current.replyWait);
      r.current.replyWait = 0;
      r.current.holdMic = false;
      turn = { persona, text: "", interrupted: false, done: false };
      r.current.turn = turn;
      setLive({ persona, text: "" });
      setStatus(`${r.current.names.get(persona)} is talking. Interrupt anytime.`);
    }
    if (turn.interrupted) {
      if (content.turnComplete) {
        r.current.turn = null;
        r.current.active = null;
      }
      return;
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) enqueueAudio(part.inlineData.data, part.inlineData.mimeType);
    }
    if (content.outputTranscription?.text) {
      turn.text += content.outputTranscription.text;
      setLive({ persona, text: turn.text });
    }
    if (content.turnComplete && !turn.done) {
      turn.done = true;
      const wait = Math.max(0, (r.current.playEnd - (r.current.playCtx?.currentTime ?? 0)) * 1000);
      setTimeout(() => finishTurn(turn), wait);
    }
  }

  function noteTeacher(chunk: string, replace = false) {
    r.current.utterance = (replace ? chunk : `${r.current.utterance} ${chunk}`).replace(/\s+/g, " ").trim();
    setHearing(r.current.utterance);
    r.current.lastActivity = Date.now();
    setIdle(null);
    const lower = r.current.utterance.toLowerCase();
    for (const [id, name] of r.current.names) {
      if (lower.includes(name.toLowerCase())) r.current.addressed = id;
    }
    if (r.current.gapTimer) clearTimeout(r.current.gapTimer);
    r.current.gapTimer = setTimeout(submitUtterance, UTTERANCE_GAP_MS);
  }

  async function finishTurn(turn: Turn) {
    if (r.current.turn !== turn) return;
    r.current.turn = null;
    r.current.active = null;
    setSpeaking(null);
    setLive(null);
    setStatus("Listening. Keep teaching.");
    r.current.lastActivity = Date.now();
    advanceListener();
    const text = turn.text.trim();
    if (!text) return;
    broadcast(turn.persona, classLine(r.current.names.get(turn.persona) ?? turn.persona, text));
    const res = await personaSaidAction(viewRef.current.id, turn.persona, text, false);
    onView(res.view);
  }

  /** The learner talked over a student: stop the audio now and log what was heard. */
  function bargeIn() {
    const turn = r.current.turn;
    if (!turn || turn.interrupted) return;
    turn.interrupted = true;
    r.current.active = null;
    r.current.bargedIn = true;
    for (const s of r.current.sources) {
      try {
        s.stop();
      } catch {}
    }
    r.current.sources = [];
    r.current.playEnd = 0;
    setSpeaking(null);
    setLive(null);
    setStatus("Listening…");
    const partial = turn.text.trim();
    send(turn.persona, interruptedLine(partial), false);
    if (partial) personaSaidAction(viewRef.current.id, turn.persona, partial, true).then((res) => onView(res.view));
  }

  async function submitUtterance() {
    const text = r.current.utterance.trim();
    r.current.utterance = "";
    r.current.bargedIn = false;
    restartHearing();
    setHearing(null);
    if (!text || !r.current.on) return;
    r.current.lastActivity = Date.now();
    const cue = languageCue(text);
    if (cue) applyLanguage(cue);
    r.current.teacherTurns += 1;
    if (r.current.teacherTurns % 3 === 0) coachTipAction(viewRef.current.id, text).then((res) => setTip(res.tip));
    if (!r.current.turn) setStatus("Listening…");
    const res = await sayAction(viewRef.current.id, text, null);
    onView(res.view);
    if (res.error) onError(res.error);
    if (!res.voice) {
      setStatus("Listening. Keep teaching.");
      return;
    }
    if (isDiagramRequest(text)) {
      void requestDiagram(text, res.voice.speaker);
      return;
    }
    // An ordinary pause is answered from the live audio. A director note is the only extra cue.
    if (res.voice.note) speak(res.voice.speaker, text, res.voice.note);
  }

  /** Opens the mic during the click. A later server call is too late for the browser to allow it. */
  function prepareMic() {
    onError(null);
    const playCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    void playCtx.resume();
    const micCtx = new AudioContext();
    void micCtx.resume();
    r.current.playCtx = playCtx;
    r.current.micCtx = micCtx;
    r.current.preparedMic = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    r.current.hear = true;
    startHearing();
  }

  function restartHearing() {
    const rec = r.current.recognition;
    r.current.recognition = null;
    try {
      rec?.stop();
    } catch {
      /* already stopped */
    }
    if (r.current.hear) startHearing();
  }

  /** Browser transcript, started in the click, so a reply is requested even when the live transcript is empty. */
  function startHearing() {
    const w = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor || r.current.recognition) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = SPEECH_LANG[r.current.language];
    rec.onresult = (event) => {
      if (playing()) return;
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      if (text.trim()) noteTeacher(text.trim(), true);
    };
    rec.onend = () => {
      if (!r.current.hear || r.current.recognition !== rec) return;
      try {
        rec.start();
      } catch {
        /* already starting */
      }
    };
    rec.onerror = () => {
      if (r.current.recognition === rec) r.current.recognition = null;
    };
    try {
      rec.start();
    } catch {
      return;
    }
    r.current.recognition = rec;
  }

  async function startMeter() {
    const pending = r.current.preparedMic;
    r.current.preparedMic = null;
    const mic = pending ? await pending : await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    const ctx = r.current.micCtx ?? new AudioContext();
    r.current.micCtx = ctx;
    const source = ctx.createMediaStreamSource(mic);
    // ScriptProcessor is the widely supported way to read PCM without a worklet file.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    processor.connect(sink);
    sink.connect(ctx.destination);
    const detector = new BargeInDetector(performance.now(), { quietThreshold: SPEECH_RMS, playingThreshold: 0.12, holdMs: 350, warmupMs: 600 });
    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      const loud = rms(channel);
      setLevel(loud);
      const isPlaying = playing();
      const teacherCutIn = detector.feed(loud, isPlaying, performance.now());
      // Speaker echo is loud enough to look like the teacher. Don't send it, and don't let it cut the reply.
      if (isPlaying && !teacherCutIn) {
        r.current.teacherSpeaking = false;
        return;
      }
      if (teacherCutIn && r.current.turn && !r.current.turn.interrupted) {
        r.current.holdMic = false;
        bargeIn();
      }
      const pcm = downsamplePcm16Base64(channel, ctx.sampleRate);
      if (loud >= SPEECH_RMS) {
        if (r.current.replyWait) clearTimeout(r.current.replyWait);
        r.current.replyWait = 0;
        r.current.teacherSpeaking = true;
        r.current.wasLoud = true;
        r.current.quietSince = 0;
        r.current.holdMic = false;
        r.current.lastActivity = Date.now();
        pushMic(pcm);
        return;
      }
      r.current.teacherSpeaking = false;
      if (!r.current.wasLoud || r.current.holdMic || r.current.turn) return;
      r.current.quietSince ||= performance.now();
      if (performance.now() - r.current.quietSince < 400) {
        pushMic(pcm);
        return;
      }
      r.current.wasLoud = false;
      r.current.quietSince = 0;
      endTeacherTurn();
    };
    r.current.processor = processor;
    r.current.mic = mic;
    r.current.micCtx = ctx;
  }

  async function start() {
    onError(null);
    if (!r.current.playCtx) r.current.playCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    await r.current.playCtx.resume().catch(() => {});
    r.current.on = true;
    setOn(true);
    setStatus("Connecting your class…");
    try {
      const { seats, error } = await voiceSeatsAction(viewRef.current.id);
      if (!seats) throw new Error(error ?? "Couldn't start voice.");
      const history = viewRef.current.turns.filter((t) => t.speaker !== "system").slice(-12);
      for (const seat of seats) {
        if (r.current.sessions.size > 0) await new Promise((resolve) => setTimeout(resolve, 400));
        r.current.names.set(seat.persona, seat.name);
        const ai = new GoogleGenAI({ apiKey: seat.token, httpOptions: { apiVersion: "v1alpha" } });
        const session = await ai.live.connect({
          model: seat.model,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 500, prefixPaddingMs: 200 } },
          },
          callbacks: {
            onmessage: (m) => onMessage(seat.persona, m),
            onerror: () => onError(`${seat.name}'s voice connection had a problem.`),
            onclose: () => r.current.sessions.delete(seat.persona),
          },
        });
        r.current.sessions.set(seat.persona, session);
      }
      r.current.openedAt = Date.now();
      // Catch everyone up on the conversation so far.
      for (const t of history) {
        const who = t.speaker === "learner" ? "Teacher" : (r.current.names.get(t.speaker) ?? t.speaker);
        broadcast(null, classLine(who, t.text));
      }
      await startMeter();
      r.current.lastActivity = Date.now();
      r.current.idleTimer = setInterval(checkIdle, 1000);
      setStatus("Listening. Start teaching out loud.");
    } catch (err) {
      onError(permissionMessage(err, "microphone"));
      await stop();
    }
  }

  function checkIdle() {
    if (r.current.turn) return;
    const over = Date.now() - r.current.lastActivity - IDLE_MS;
    if (over < 0) return setIdle(null);
    const left = IDLE_COUNTDOWN_S - Math.floor(over / 1000);
    if (left <= 0) stop();
    else setIdle(left);
  }

  async function stop() {
    if (!r.current.on && !r.current.hear) return;
    r.current.on = false;
    r.current.hear = false;
    for (const id of [r.current.gapTimer, r.current.meter, r.current.idleTimer, r.current.frameTimer, r.current.replyWait]) if (id) clearTimeout(id);
    r.current.cameraStream?.getTracks().forEach((track) => track.stop());
    r.current.screenStream?.getTracks().forEach((track) => track.stop());
    r.current.cameraStream = null;
    r.current.screenStream = null;
    r.current.cameraOn = false;
    r.current.screenOn = false;
    r.current.boardOn = false;
    r.current.diagram = null;
    r.current.frameTimer = 0;
    try {
      r.current.recognition?.stop();
    } catch {}
    try {
      r.current.processor?.disconnect();
    } catch {}
    r.current.preparedMic?.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => {});
    r.current.preparedMic = null;
    r.current.mic?.getTracks().forEach((t) => t.stop());
    for (const s of r.current.sessions.values()) {
      try {
        s.close();
      } catch {}
    }
    r.current.sessions.clear();
    await r.current.playCtx?.close().catch(() => {});
    await r.current.micCtx?.close().catch(() => {});
    r.current = { ...r.current, playCtx: null, micCtx: null, mic: null, processor: null, recognition: null, turn: null, active: null, addressed: null, sources: [], playEnd: 0, utterance: "", holdMic: false, wasLoud: false, quietSince: 0, replyWait: 0, nextListener: null };
    setOn(false);
    setSpeaking(null);
    setLive(null);
    setHearing(null);
    setIdle(null);
    setLevel(0);
    setCameraOn(false);
    setScreenOn(false);
    setBoardOn(false);
    setDiagram(null);
    setTip(null);
    const res = await setModeAction(viewRef.current.id, "text");
    onView(res.view);
  }

  // Leaving the page ends the voice class.
  useEffect(
    () => () => {
      if (r.current.on) stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    on, prepareMic, start, stop, speak, speaking, live, hearing, status, idle, level,
    bind, cameraOn, screenOn, boardOn, toggleCamera, toggleScreen, toggleBoard,
    language, languages: CLASS_LANGUAGES, setClassLanguage: applyLanguage,
    tip, diagram, closeDiagram,
  };
}
