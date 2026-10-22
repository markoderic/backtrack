import { Suspense } from "react";
import { PastBody } from "./past-body";

export default function PastLecturePage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={null}>
      <PastBody params={params} />
    </Suspense>
  );
}
