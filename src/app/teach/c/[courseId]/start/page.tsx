import { Suspense } from "react";
import { StartBody } from "./start-body";

export default function StartPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={null}>
      <StartBody params={params} />
    </Suspense>
  );
}
