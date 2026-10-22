import { Suspense } from "react";
import { LiveBody, type LiveSearchParams } from "./live-body";
import { LiveDataSkeleton } from "../../../skeletons";

export default function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ lectureId: string }>;
  searchParams: LiveSearchParams;
}) {
  return (
    <Suspense fallback={<LiveDataSkeleton />}>
      <LiveBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
