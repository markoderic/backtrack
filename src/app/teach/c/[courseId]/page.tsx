import { Suspense } from "react";
import { CourseBody } from "./course-body";

export default function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={null}>
      <CourseBody params={params} />
    </Suspense>
  );
}
