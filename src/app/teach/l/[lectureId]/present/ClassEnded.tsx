import Link from "next/link";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";

/**
 * The projector once the class is over. The line is projector sized so the room can read it
 * from the back; the way back is a quiet white button for the teacher, not a big black one.
 */
export function ClassEnded({ courseId, fixed = false }: { courseId?: string; fixed?: boolean }) {
  return (
    <main
      className={`${fixed ? "fixed inset-0" : "min-h-screen w-full"} flex animate-page-in flex-col items-center justify-center gap-12 bg-bg p-4 text-center`}
    >
      <p role="status" className="type-projector-l text-ink">
        This class has ended.
      </p>
      {courseId && (
        <Link href={`/teach/c/${courseId}`} className={buttonSecondaryClass}>
          Back to the course
        </Link>
      )}
    </main>
  );
}
