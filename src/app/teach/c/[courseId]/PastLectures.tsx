"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatLectureDate } from "@/lib/lectureDate";
import { Icon } from "@/components/Icon";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { LectureMenu } from "../../LectureMenu";
import { rowLinkClass, staggerClass, staggerStyle } from "../../ui";

export type PastLecture = {
  id: string;
  name: string;
  lectureDate: string;
  joined: number | null;
  lostTaps: number | null;
  mostLost: { number: number; firstLine: string } | null;
};

const SHOWN = 5;

// Column widths from the design (33:860): Date 120, Lecture the rest, Joined 100, Lost taps 100,
// Most lost slide 260, 18 for the arrow. Narrower windows drop the number columns.
const COL = {
  date: "w-22 shrink-0 sm:w-30",
  joined: "hidden w-25 shrink-0 md:flex",
  lost: "hidden w-25 shrink-0 md:flex",
  most: "hidden w-65 shrink-0 lg:flex",
};

/** The past lectures table on the course page: newest first, five shown, the rest one press away. */
export function PastLectures({ lectures }: { lectures: PastLecture[] }) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const moveFocus = useRef(false);

  // "N more" goes away when pressed, so the keyboard lands on the first lecture it brought in.
  useEffect(() => {
    if (all && moveFocus.current) {
      moveFocus.current = false;
      list.current?.querySelectorAll<HTMLAnchorElement>("li > a")[SHOWN]?.focus();
    }
  }, [all]);
  const shown = all ? lectures : lectures.slice(0, SHOWN);
  const more = lectures.length - shown.length;

  return (
    <div className="flex flex-col">
      <div aria-hidden className="flex items-center border-t border-hairline py-4 type-caption text-secondary">
        <span className={`flex h-6 items-center ${COL.date}`}>Date</span>
        <span className="flex h-6 min-w-0 flex-1 items-center">Lecture</span>
        <span className={`h-6 items-center ${COL.joined}`}>Joined</span>
        <span className={`h-6 items-center ${COL.lost}`}>Lost taps</span>
        <span className={`h-6 items-center ${COL.most}`}>Most lost slide</span>
        <span className="size-4.5 shrink-0" />
        {/* Room for the ⋯ menu button (44) and the 8 px gap before it, so the headings line up. */}
        <span className="w-13 shrink-0" />
      </div>
      <ul ref={list} className="flex flex-col">
        {shown.map((l, i) => (
          <li key={l.id} className={`group/row flex items-center gap-2 border-t border-hairline ${staggerClass}`} style={staggerStyle(i)}>
            <Link href={`/teach/l/${l.id}`} className={`${rowLinkClass} flex min-w-0 flex-1 items-center py-4 type-body`}>
              <span className={`flex h-6 items-center text-secondary ${COL.date}`}>{formatLectureDate(l.lectureDate)}</span>
              <span className="min-w-0 flex-1 truncate pr-4 type-body-strong text-ink transition-colors duration-(--dur-fast) ease-out group-hover:text-ink-hover">
                {l.name}
              </span>
              <span className={`h-6 items-center text-ink ${COL.joined}`}>
                {l.joined !== null && (
                  <>
                    {l.joined}
                    <span className="sr-only"> joined</span>
                  </>
                )}
              </span>
              <span className={`h-6 items-center text-ink ${COL.lost}`}>
                {l.lostTaps !== null && (
                  <>
                    {l.lostTaps}
                    <span className="sr-only"> lost taps</span>
                  </>
                )}
              </span>
              <span className={`h-6 min-w-0 items-center gap-2 pr-4 ${COL.most}`}>
                {l.mostLost ? (
                  <>
                    <span className="sr-only">Most lost: slide </span>
                    <span className="shrink-0 text-ink">{l.mostLost.number}</span>
                    <span className="min-w-0 truncate text-ink">{l.mostLost.firstLine}</span>
                  </>
                ) : (
                  l.lostTaps === 0 && <span className="text-secondary">None</span>
                )}
              </span>
              <Icon
                name="forward"
                size={18}
                className="transition-[translate] duration-(--dur-fast) ease-out motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
            <LectureMenu lectureId={l.id} lectureName={l.name} live={false} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          onClick={() => {
            moveFocus.current = true;
            setAll(true);
          }}
          className={`${buttonSecondaryClass} mt-4 w-fit`}
        >
          {more} more
        </button>
      )}
    </div>
  );
}
