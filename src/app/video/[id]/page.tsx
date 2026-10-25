import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Studio } from "@/components/studio";
import { LessonPlayer } from "@/components/video/player";
import { buttonClass } from "@/components/ui";
import { currentStudent } from "@/lib/auth/session";
import { studentVideo } from "@/lib/db/videos";
import { teachVideoTopic, videoFinished, videoStarted } from "../actions";

export default function VideoPage(props: PageProps<"/video/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading the video…</p>}>
      <Watch params={props.params} />
    </Suspense>
  );
}

async function Watch({ params }: { params: PageProps<"/video/[id]">["params"] }) {
  const student = await currentStudent();
  if (!student) redirect("/login");
  const { id } = await params;
  const video = await studentVideo(student.id, id).catch(() => null);
  if (!video) notFound();
  return (
    <Studio>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div>
          <p className="text-xs tracking-wide text-muted uppercase">From {video.instructor}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{video.title}</h1>
        </div>
        <LessonPlayer
          videoId={video.id}
          title={video.title}
          topic={video.topicName}
          scenes={video.scenes}
          audioScenes={video.audioScenes}
          onStarted={videoStarted.bind(null, video.id)}
          onFinished={videoFinished.bind(null, video.id)}
          endCard={
            <>
              <p className="text-xl font-semibold">Now make it yours.</p>
              <p className="max-w-md text-[#f2f0ea]/75">Explain {video.topicName} to Maya and Jordan in your own words. That&apos;s what tells you it holds up.</p>
              <form action={teachVideoTopic.bind(null, video.id)}>
                <button className="rounded-full bg-[#f2f0ea] px-5 py-2.5 text-sm font-semibold text-[#111]">Teach it back</button>
              </form>
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <form action={teachVideoTopic.bind(null, video.id)}>
            <button className={buttonClass}>Teach {video.topicName} now</button>
          </form>
          <Link href="/map" className="text-sm text-muted underline">
            Back to my semester
          </Link>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Read the transcript</summary>
          <ol className="mt-2 flex flex-col gap-3">
            {video.scenes.map((s, i) => (
              <li key={i}>
                <p className="font-medium">{s.title}</p>
                <p className="text-muted">{s.narration}</p>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </Studio>
  );
}
