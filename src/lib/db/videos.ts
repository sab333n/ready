// Lesson videos: the script, narration clips, and who watched. Instructors see
// only their own classes' videos; students see shared videos of classes they joined.
import { sql } from "./index";
import type { Scene } from "@/lib/video/script";

export type VideoRow = {
  id: string;
  classId: string;
  topicName: string;
  title: string;
  focus: string | null;
  scenes: Scene[];
  usedLlm: boolean;
  status: "draft" | "shared";
  createdAt: Date;
  sharedAt: Date | null;
};

export async function createVideo(v: { classId: string; topicName: string; title: string; focus: string | null; scenes: Scene[]; usedLlm: boolean }) {
  const [row] = await sql<{ id: string }[]>`
    insert into lesson_videos (class_id, topic_name, title, focus, scenes, used_llm)
    values (${v.classId}, ${v.topicName}, ${v.title}, ${v.focus}, ${sql.json(v.scenes as never)}, ${v.usedLlm}) returning id`;
  return row.id;
}

export async function saveSceneAudio(videoId: string, scene: number, mime: string, audio: Buffer) {
  await sql`
    insert into lesson_video_audio (video_id, scene, mime, audio) values (${videoId}, ${scene}, ${mime}, ${audio})
    on conflict (video_id, scene) do update set mime = excluded.mime, audio = excluded.audio`;
}

export async function facultyVideo(facultyId: string, videoId: string) {
  const [row] = await sql<(VideoRow & { audioScenes: number[] })[]>`
    select v.*, coalesce((select array_agg(scene order by scene) from lesson_video_audio a where a.video_id = v.id), '{}') as audio_scenes
    from lesson_videos v join classes c on c.id = v.class_id
    where v.id = ${videoId} and c.faculty_id = ${facultyId}`;
  return row ?? null;
}

/** A shared video the student may watch: they joined its class. */
export async function studentVideo(studentId: string, videoId: string) {
  const [row] = await sql<(VideoRow & { audioScenes: number[]; instructor: string; courseCode: string })[]>`
    select v.*, f.display_name as instructor, c.course_code,
      coalesce((select array_agg(scene order by scene) from lesson_video_audio a where a.video_id = v.id), '{}') as audio_scenes
    from lesson_videos v join classes c on c.id = v.class_id join faculty f on f.id = c.faculty_id
    join class_members m on m.class_id = c.id and m.student_id = ${studentId}
    where v.id = ${videoId} and v.status = 'shared'`;
  return row ?? null;
}

export async function sceneAudio(videoId: string, scene: number) {
  const [row] = await sql<{ mime: string; audio: Buffer }[]>`select mime, audio from lesson_video_audio where video_id = ${videoId} and scene = ${scene}`;
  return row ?? null;
}

export async function shareVideo(facultyId: string, videoId: string) {
  const [row] = await sql<{ id: string }[]>`
    update lesson_videos v set status = 'shared', shared_at = coalesce(shared_at, now())
    from classes c where c.id = v.class_id and v.id = ${videoId} and c.faculty_id = ${facultyId}
    returning v.id`;
  return Boolean(row);
}

export async function deleteVideo(facultyId: string, videoId: string) {
  await sql`delete from lesson_videos v using classes c where c.id = v.class_id and v.id = ${videoId} and c.faculty_id = ${facultyId}`;
}

export type VideoStats = VideoRow & { watched: number; finished: number; taughtBack: number };

/**
 * Each video with its follow-up: who watched, who finished, and who has taught
 * the topic since watching (the only thing that moves readiness).
 */
export async function classVideos(classId: string): Promise<VideoStats[]> {
  return sql<VideoStats[]>`
    select v.*,
      (select count(*)::int from lesson_video_views w where w.video_id = v.id) as watched,
      (select count(*)::int from lesson_video_views w where w.video_id = v.id and w.finished_at is not null) as finished,
      (select count(distinct w.student_id)::int from lesson_video_views w
         join topics t on t.student_id = w.student_id and lower(t.name) = lower(v.topic_name)
         join courses co on co.id = t.course_id
         join classes c on c.id = v.class_id and co.code = c.course_code
         join topic_scores ts on ts.topic_id = t.id and ts.created_at > w.first_seen_at and ts.source in ('teach', 'teach_back', 'practice')
       where w.video_id = v.id) as taught_back
    from lesson_videos v where v.class_id = ${classId} order by v.created_at desc`;
}

export async function studentVideos(studentId: string) {
  return sql<{ id: string; title: string; topicName: string; instructor: string; displayCode: string; sharedAt: Date; watched: boolean }[]>`
    select v.id, v.title, v.topic_name, f.display_name as instructor, c.display_code, v.shared_at,
      exists (select 1 from lesson_video_views w where w.video_id = v.id and w.student_id = ${studentId} and w.finished_at is not null) as watched
    from lesson_videos v join classes c on c.id = v.class_id join faculty f on f.id = c.faculty_id
    join class_members m on m.class_id = c.id and m.student_id = ${studentId}
    where v.status = 'shared' order by v.shared_at desc limit 10`;
}

export async function markSeen(videoId: string, studentId: string, finished: boolean) {
  await sql`
    insert into lesson_video_views (video_id, student_id, finished_at) values (${videoId}, ${studentId}, ${finished ? new Date() : null})
    on conflict (video_id, student_id) do update set finished_at = coalesce(lesson_video_views.finished_at, excluded.finished_at)`;
}
