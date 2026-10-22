import { Suspense } from "react";
import { PresentBody } from "./present-body";
import { ProjectorSkeleton } from "../../../skeletons";

export default function PresentPage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={<ProjectorSkeleton />}>
      <PresentBody params={params} />
    </Suspense>
  );
}
