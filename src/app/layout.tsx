import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "@fontsource/newsreader/400.css";
// Student notes (type-note): Inter, regular, from npm (no Google Fonts at build).
import "@fontsource-variable/inter/wght.css";
import "./globals.css";

const DESCRIPTION = "Mark the slide where you got lost, come back to it after class.";

// The share preview image is the static opengraph-image.png and twitter-image.png in this folder (made once from the Geist font and the logo, so nothing is drawn at request time). Pages
// with their own title only set `title`, which the template turns into "Join — Backtrack". Lecture
// pages set nothing, so a pasted lecture link never shows a lecture name or code.
export const metadata: Metadata = {
  metadataBase: new URL("https://backtrack.courses"),
  title: { default: "Backtrack", template: "%s — Backtrack" },
  description: DESCRIPTION,
  applicationName: "Backtrack",
  openGraph: {
    type: "website",
    siteName: "Backtrack",
    title: "Backtrack",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Backtrack",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="bg-bg text-ink">{children}</body>
    </html>
  );
}
