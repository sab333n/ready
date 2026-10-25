// Text we send to each voice student's realtime session. They answer the live
// audio on their own. A "YOUR TURN" message is extra direction (see live-student.v1).

export function classLine(speaker: string, text: string): string {
  return `[Class] ${speaker}: "${text}"`;
}

export function yourTurn(teacherText: string | null, note: string | null): string {
  const parts = ["YOUR TURN."];
  if (teacherText) parts.push(`The teacher just said: "${teacherText}"`);
  if (note) parts.push(`Director note (follow it, never say it aloud): ${note}`);
  parts.push("Reply out loud now, in 1–3 short sentences.");
  return parts.join(" ");
}

export function interruptedLine(partial: string): string {
  return `[Class] You were interrupted by the teacher after saying: "${partial}". Let them talk.`;
}
