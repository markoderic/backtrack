"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

// A safety net for the teacher pages without their own (dashboard, setup, course, settings, past
// lecture), including a failed server action such as saving setup or adding a course.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen reset={reset} />;
}
