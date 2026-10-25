import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LessonPlayer } from "@/components/video/player";
import { currentFaculty } from "@/lib/auth/faculty";
import { facultyVideo } from "@/lib/db/videos";
import { deleteVideoAction } from "../../../../actions";
import { ShareVideoButton } from "../../../../forms";

export default function VideoPreview(props: PageProps<"/faculty/class/[id]/video/[videoId]">) {
  return (
    <Suspense fallback={<p className="p-8 text-[#5a5a5a]">Loading the video…</p>}>
      <Preview params={props.params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: PageProps<"/faculty/class/[id]/video/[videoId]">["params"] }) {
  const faculty = await currentFaculty();
  if (!faculty) redirect("/faculty");
  const { id, videoId } = await params;
  const video = await facultyVideo(faculty.id, videoId).catch(() => null);
  if (!video || video.classId !== id) notFound();
  const silent = video.scenes.length - video.audioScenes.length;
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-5 py-8">
      <div>
        <Link href={`/faculty/class/${id}`} className="text-sm text-[#5a5a5a] hover:text-[#111]">
          ← Back to the class
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">{video.title}</h1>
        <p className="text-[#5a5a5a]">
          {video.topicName} · {video.scenes.length} scenes · {video.status === "shared" ? "shared with the class" : "draft: only you can see it"}
          {video.focus ? ` · focus: ${video.focus}` : ""}
        </p>
      </div>
      <LessonPlayer
        videoId={video.id}
        title={video.title}
        topic={video.topicName}
        scenes={video.scenes}
        audioScenes={video.audioScenes}
        endCard={<p className="text-lg">Students see a &ldquo;Teach it back&rdquo; button here that opens a session on {video.topicName}.</p>}
      />
      {(silent > 0 || !video.usedLlm) && (
        <p className="rounded-xl border border-[#d97706]/40 bg-[#fdefd9] px-3 py-2 text-sm text-[#7a4a06]">
          {!video.usedLlm ? "The AI writer was unavailable, so this uses a general outline. " : ""}
          {silent > 0 ? `${silent} scene${silent === 1 ? "" : "s"} had no recorded voice and will use the device's own voice.` : ""}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ShareVideoButton videoId={video.id} shared={video.status === "shared"} />
        <form action={deleteVideoAction}>
          <input type="hidden" name="classId" value={id} />
          <input type="hidden" name="videoId" value={video.id} />
          <button className="text-sm text-[#dc2626] underline">Delete video</button>
        </form>
      </div>
      <section className="rounded-2xl border border-black/8 p-5">
        <h2 className="mb-3 text-lg font-semibold">Script</h2>
        <ol className="flex flex-col gap-4">
          {video.scenes.map((s, i) => (
            <li key={i}>
              <p className="font-medium">
                {i + 1}. {s.title}
              </p>
              <p className="text-sm text-[#5a5a5a]">{s.points.join(" · ")}</p>
              <p className="mt-1 text-sm">{s.narration}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
