import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backtrack",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="bg-bg text-ink">{children}</body>
    </html>
  );
}
