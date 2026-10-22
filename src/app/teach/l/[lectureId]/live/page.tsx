import { Suspense } from "react";
import { LiveBody, type LiveSearchParams } from "./live-body";

export default function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ lectureId: string }>;
  searchParams: LiveSearchParams;
}) {
  return (
    <Suspense fallback={null}>
      <LiveBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
