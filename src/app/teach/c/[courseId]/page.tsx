import { Suspense } from "react";
import { CourseBody } from "./course-body";
import { CourseSkeleton } from "../../skeletons";

export default function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<CourseSkeleton />}>
      <CourseBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
