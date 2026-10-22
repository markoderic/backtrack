import Link from "next/link";
import { secondaryButtonClass } from "./ui";

/** A lecture that is running now: its name, and where the teacher can go from here. */
export function LiveLectureRow({ id, name }: { id: string; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-hairline py-4">
      <div className="flex min-w-0 flex-1 basis-60 flex-col">
        <span className="type-small-strong text-ink">Live now</span>
        <span className="truncate type-lecture text-secondary">{name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/teach/l/${id}/present`} className={secondaryButtonClass}>
          Resume
        </Link>
        <Link href={`/teach/l/${id}/live`} className={secondaryButtonClass}>
          Data
        </Link>
        <Link href={`/teach/l/${id}/live?end=1`} className={secondaryButtonClass}>
          End lecture
        </Link>
      </div>
    </div>
  );
}
