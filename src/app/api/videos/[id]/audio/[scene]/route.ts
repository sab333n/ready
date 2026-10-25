import { currentFaculty } from "@/lib/auth/faculty";
import { currentStudent } from "@/lib/auth/session";
import { facultyVideo, sceneAudio, studentVideo } from "@/lib/db/videos";

// One scene's narration. Only the class's instructor, or a student in the class once it's shared.
export async function GET(_: Request, ctx: RouteContext<"/api/videos/[id]/audio/[scene]">) {
  const { id, scene } = await ctx.params;
  const [faculty, student] = await Promise.all([currentFaculty(), currentStudent()]);
  const allowed = (faculty && (await facultyVideo(faculty.id, id))) || (student && (await studentVideo(student.id, id)));
  if (!allowed) return new Response("Not found", { status: 404 });
  const clip = await sceneAudio(id, Number(scene));
  if (!clip) return new Response("No narration", { status: 404 });
  return new Response(new Uint8Array(clip.audio), {
    headers: { "content-type": clip.mime, "content-length": String(clip.audio.length), "cache-control": "private, max-age=86400" },
  });
}
