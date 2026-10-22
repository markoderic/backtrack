import { Suspense } from "react";
import { LiveBody } from "./live-body";

export default function LivePage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={null}>
      <LiveBody params={params} />
    </Suspense>
  );
}
