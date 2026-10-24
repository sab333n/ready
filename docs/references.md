# What we take from LearnHarness and Dasko

Two projects shape Ready. This page records what we adopt, what we change, and what we skip, so design decisions stay traceable.

| | LearnHarness | Dasko |
|---|---|---|
| Repo | github.com/amosblomqvist/learnharness | github.com/KingJerryX/Dasko-Zurich |
| License | **AGPL-3.0** | MIT (stated in README; the repo has no LICENSE file) |
| We use it for | Teaching method, readiness evidence, architecture | Live voice classroom |
| Stack | Next.js + Electron, file stores, OpenRouter (BYOK) | Hono + `ws` server, vanilla JS client, Gemini Live |

**Code policy.** We adopt ideas and designs, and write our own code. Copying LearnHarness code would put all of Ready under AGPL-3.0, so the source for the whole hosted app would have to be offered to every user. Dasko's code is MIT, so reuse is allowed with attribution, but it is a 2,000-line `server.ts` plus a 3,400-line `app.js` that don't fit our Next.js structure. We re-implement its techniques in our `voice` module.

---

## From LearnHarness: measure → plan → teach → practice

Its loop is our core loop. What we adopt, in our terms:

1. **Diagnostic = a binary search per prerequisite strand** (their "probe"). Before teaching a topic, find where understanding ends on each prerequisite it depends on: the floor (reliably right), the ceiling (where it runs out), and misconceptions. The diagnostic ends with one structured result: a list of `{ strand, floor, ceiling, misconceptions }`. Phase 2's 2–3 minute diagnostic produces exactly this, and Phase 3 reads it.
2. **Prerequisite map as a validated DAG.** Topics and their prerequisites form a graph that is checked for cycles when written. Teaching order is a topological order. (Phase 1 already stores `topic_prerequisites`. Phase 2 adds the cycle check and the ordering.)
3. **Commit before you grade.** Every graded question is written together with its answer key, which is drawn from the student's own materials and cites them. The key is saved before the student answers and is never revised after seeing the answer. This is their sycophancy guard. We use it for diagnostic questions, the teach-back grading, and the Phase 4 "quiz me" texts.
4. **Evidence is append-only; readiness is derived.** They never store "done" flags; status is computed from the transcript. We do the same: scores, diagnostic results and confidence are append-only rows, and readiness (green/yellow/red) is recomputed from them by one documented function. Nothing writes a color directly.
5. **Confidence plus thinking out loud.** Students mark sure/unsure and explain in their own words. That gives the confident-but-wrong signal the reflection highlights.
6. **One reasoning step at a time.** The AI students push on one gap at a time and don't lecture. This shapes the classroom prompts.
7. **Practice ladder for "quiz me".** Their rungs (worked example → direct exercise → composition) and cue distance (lesson context → adjacent → far) give our 3-question text quiz a defined difficulty. The default is a direct exercise in adjacent context.
8. **Scores are 0–10 plus one or two sentences** naming which rubric points were met or missed.

Architecture habits we already follow or will keep:
- Prompts are files, versioned, and visible.
- External services sit behind adapters: `llm`, `voice`, `sms`.
- Tests are deterministic, with scripted fakes and no network.

**Where we deliberately differ.** LearnHarness treats practice as "strengthening, not assessment" and never writes learner state back. Ready's purpose is to tell a student when they are not ready, so teaching evidence must feed readiness. We keep their honesty rules (commit before grading, cite sources, say "unsure") and apply them to assessment.

**Skipped for the December demo:** the cross-session knowledge graph of propositions and reasoning chains, background research sub-agents, Electron, and BYOK model slots.

---

## From Dasko: the live classroom

Techniques we re-implement in `src/lib/voice`:

1. **One realtime session per AI student**, each with its own persona and voice. The teacher's audio fans out to every session. Each student's finished line is forwarded to the others as `[Classroom] Name: "…"` so they can build on or disagree with each other.
2. **Barge-in on the client.** A volume-based voice detector runs in the browser. Its threshold rises while a student is talking through the speakers, so echo is not mistaken for the teacher. When the teacher speaks it stops playback at once, sends `speech_start`, and the server marks that student as interrupted, keeping the partial transcript.
3. **Anti-hallucination gates:**
   - Students stay silent until the teacher has actually spoken.
   - Audio is ignored for 1.5 s after a session opens.
   - Camera or whiteboard frames don't count as speech.
   - If the transcript is short at `speech_end`, the server waits 1 s for late transcription.
4. **Addressing by name.** If the teacher says a student's name, that student answers next.
5. **Materials framed as notes the students half-understood.** The students reference the student's own uploads, never recite them, and never explain the topic themselves.
6. **Push back once, then concede, and self-correct if the teacher misses an error.**
7. **Idle timeout:** after 2 minutes of silence, ask "Are you still there?" with a 30-second countdown, then end the session and generate the reflection.
8. **The post-session reflection** covers strengths, gaps, the best student questions and key vocabulary.

What we change:
- **The planted mistake is controlled, not random.** Dasko has students make confident errors in about 30% of turns, and nothing records them. For teach-back mode we need exactly one mistake that we can grade. The server picks it with the text LLM before the turn: a specific, topic-level error that contradicts a cited passage in the student's materials. The mistake is saved as a `planted_mistake` row, and the voice student is told to say it. Afterwards we grade whether the student caught it. Normal classroom turns keep only light, occasional errors.
- **Personas match our spec:** Beginner (Dasko's "confused"), Skeptic, and an optional role-player for the major, such as a patient for nursing.
- **The reflection is per topic and cited.** We add a score per topic, confident-but-wrong points, and the planted-mistake outcome. Every claim cites the student's materials, or says it is unsure. The result feeds readiness.
- **Deployment.** Next.js route handlers can't hold WebSockets, so Dasko's proxy server pattern doesn't drop in. Preferred option: the browser connects directly to the Gemini Live API with a short-lived token minted by our server (an ephemeral token; to be verified against the current Gemini API before building). Fallback: a small Node WebSocket sidecar next to Next.js.
- **Skipped for the demo:** camera and screen vision, on-demand diagram generation, and multilingual switching. These are nice to have but don't serve the core loop.

Model split: Gemini Live (native audio) for the realtime student voices. The existing `llm` module handles planning the planted mistake, the diagnostic questions with their answer keys, grading, and the reflection.
