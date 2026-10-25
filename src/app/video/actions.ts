"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentStudent } from "@/lib/auth/session";
import { ensureNamedTopic } from "@/lib/db/repo";
import { markSeen, studentVideo } from "@/lib/db/videos";
import { startLesson } from "@/lib/lesson/service";

export async function videoStarted(videoId: string) {
  const student = await currentStudent();
  if (student && (await studentVideo(student.id, videoId))) await markSeen(videoId, student.id, false);
}

export async function videoFinished(videoId: string) {
  const student = await currentStudent();
  if (student && (await studentVideo(student.id, videoId))) await markSeen(videoId, student.id, true);
}

/**
 * After the video: teach the topic to the AI students. Uses the student's own topic
 * in the class's course so the result counts toward that class's readiness.
 */
export async function teachVideoTopic(videoId: string) {
  const student = await currentStudent();
  if (!student) redirect("/login");
  const video = await studentVideo(student.id, videoId);
  if (!video) redirect("/map");
  const [existing] = await sql<{ id: string }[]>`
    select t.id from topics t join courses c on c.id = t.course_id
    where t.student_id = ${student.id} and c.code = ${video.courseCode} and lower(t.name) = lower(${video.topicName})`;
  const topicId = existing?.id ?? (await ensureNamedTopic(student.id, video.topicName)).id;
  // Straight to teaching: the video was the explanation, now the student explains.
  const session = await startLesson(student, topicId, { withRolePlayer: /nurs|pharm|health/i.test(student.major ?? ""), skipDiagnostic: true });
  redirect(`/session/${session.id}`);
}
