import { notFound } from "next/navigation";
import { LoadTest } from "./load-test";

// A tool for trying 40 students joining at once. Only there when the flag is on.
export default function LoadPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_LOAD_PAGE !== "1") notFound();
  return <LoadTest />;
}
