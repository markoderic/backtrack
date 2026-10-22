import type { Metadata } from "next";

export const metadata: Metadata = { title: "Join" };

export default function JoinLayout({ children }: LayoutProps<"/join">) {
  return children;
}
