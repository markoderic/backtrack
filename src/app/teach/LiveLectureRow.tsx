import Link from "next/link";

/** A lecture that is running now: its name, and where the teacher can go from here. */
export function LiveLectureRow({ id, name }: { id: string; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-semibold">Live now</span>
      <span>{name}</span>
      <Link href={`/teach/l/${id}/present`} className="border border-current px-4 py-2">
        Resume
      </Link>
      <Link href={`/teach/l/${id}/live`} className="border border-current px-4 py-2">
        Data
      </Link>
      <Link href={`/teach/l/${id}/live?end=1`} className="border border-current px-4 py-2">
        End lecture
      </Link>
    </div>
  );
}
