import { Suspense } from "react";
import { StartBody } from "./start-body";
import { StartSkeleton } from "../../../skeletons";

export default function StartPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<StartSkeleton />}>
      <StartBody params={params} />
    </Suspense>
  );
}
