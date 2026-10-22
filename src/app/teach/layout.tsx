import type { Metadata } from "next";

export const metadata: Metadata = { title: "Teacher" };

export default function TeachLayout({ children }: LayoutProps<"/teach">) {
  return children;
}
