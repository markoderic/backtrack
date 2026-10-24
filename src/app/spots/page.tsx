import type { Metadata } from "next";
import { LectureList } from "./LectureList";

export const metadata: Metadata = { title: "My lectures" };

export default function SpotsIndexPage() {
  return <LectureList />;
}
