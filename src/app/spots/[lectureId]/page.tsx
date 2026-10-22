import { Suspense } from "react";
import { SpotsBody } from "./spots-body";

export default function SpotsPage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={null}>
      <SpotsBody params={params} />
    </Suspense>
  );
}
