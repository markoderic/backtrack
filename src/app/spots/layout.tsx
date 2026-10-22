import type { Metadata } from "next";

export const metadata: Metadata = { title: "My spots" };

export default function SpotsLayout({ children }: LayoutProps<"/spots">) {
  return children;
}
