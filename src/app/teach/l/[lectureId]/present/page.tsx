import { Suspense } from "react";
import { PresentBody } from "./present-body";

export default function PresentPage({ params }: { params: Promise<{ lectureId: string }> }) {
  return (
    <Suspense fallback={null}>
      <PresentBody params={params} />
    </Suspense>
  );
}
