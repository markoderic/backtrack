import { Suspense } from "react";
import { PastBody } from "../past-body";
import { PastLectureSkeleton } from "../../../skeletons";

/*
 * The past lecture page. It sits in the (past) route group so its loading skeleton (loading.tsx
 * next to it) wraps only this page: one in [lectureId] itself would also show over the projector
 * and the live data view while they load.
 */
export default function PastLecturePage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={<PastLectureSkeleton />}>
      <PastBody params={params} />
    </Suspense>
  );
}
