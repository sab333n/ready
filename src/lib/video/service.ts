// Making and sharing a lesson video: script → narration per scene → stored.
// Sharing notifies the students who aren't ready on that topic yet.
import { classMembers, classLabel, type ClassRow } from "@/lib/db/classes";
import * as videos from "@/lib/db/videos";
import { classReport, topicKey } from "@/lib/classes/report";
import { notifyStudent } from "@/lib/sms/service";
import { writeVideoScript } from "./script";
import { narrate } from "./voice";

export async function makeVideo(cls: ClassRow, topic: string, focus: string | null) {
  const { members } = await classMembers(cls.id);
  const report = classReport(members);
  const confidentWrong = report.topics.find((t) => t.key === topicKey(topic))?.confidentWrong ?? 0;
  const script = await writeVideoScript({ course: classLabel(cls), topic, focus, confidentWrong });
  const id = await videos.createVideo({ classId: cls.id, topicName: topic, title: script.title, focus, scenes: script.scenes, usedLlm: script.usedLlm });
  // Scenes are narrated in parallel; a scene without audio falls back to the browser's voice.
  const clips = await Promise.all(script.scenes.map((scene) => narrate(scene.narration).catch(() => null)));
  for (const [i, clip] of clips.entries()) if (clip) await videos.saveSceneAudio(id, i, clip.mime, clip.audio);
  return { id, narrated: clips.filter(Boolean).length, scenes: script.scenes.length };
}

/** Shares a video and notifies sharing students who aren't ready on its topic. */
export async function shareAndNotify(facultyId: string, instructor: string, video: videos.VideoRow) {
  if (!(await videos.shareVideo(facultyId, video.id))) return { notified: 0 };
  const { members } = await classMembers(video.classId);
  const report = classReport(members);
  const key = topicKey(video.topicName);
  const needIt = report.rows.filter((r) => r.cells[key] && r.cells[key].level !== "ready").map((r) => r.studentId);
  let notified = 0;
  for (const studentId of needIt) {
    const out = await notifyStudent(studentId, {
      title: `${instructor} made you a video`,
      body: `A short lesson on ${video.topicName}. Watch it, then teach it back.`,
      path: `/video/${video.id}`,
    }).catch(() => null);
    if (out?.sent) notified++;
  }
  return { notified, needIt: needIt.length };
}
