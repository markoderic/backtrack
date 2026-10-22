import { Suspense } from "react";
import { LectureBody } from "./lecture-body";

export default function LecturePage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={null}>
      <LectureBody params={params} />
    </Suspense>
  );
}
