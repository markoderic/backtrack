import type { Metadata } from "next";
import Link from "next/link";
import { LogoLockup } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Backtrack stores, who can see it, and for how long.",
};

/**
 * Privacy: a plain page in the design system, one 640 px column. Every sentence here is checked against the
 * code and the migrations (see the report of the build for the list). Keep it that way: change the code, change
 * this page. It does not use the word "tracking" for the anonymous ID (spec: never call it tracking in the UI).
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-bg">
      <header className="flex items-center p-4">
        <Link href="/" className="press focus-ring flex rounded-xs">
          <LogoLockup size="S" />
        </Link>
      </header>
      <article className="mx-auto w-full max-w-160 animate-page-in px-4 pt-8 pb-16 text-ink">
        <h1 className="type-display">Privacy</h1>
        <p className="mt-3 type-body text-secondary">What Backtrack stores, who can see it, and for how long.</p>

        <Section title="Students">
          <p>You never sign in. There is no name, no email and no account.</p>
          <p>
            When you join with a code, Backtrack gets a random anonymous ID for your browser. It is not linked to your
            name, your email or your device. It only lets you find your own spots again.
          </p>
          <p>Stored for you:</p>
          <ul>
            <li>Which lectures you joined, and when.</li>
            <li>
              Each time you tap I&apos;m lost or save a spot: the slide, the time, the note if you typed one, and the
              part of the slide you highlighted if you did.
            </li>
            <li>A tap you undo stays in the database, marked as undone. It is not counted.</li>
            <li>Each wrong code you enter, with the time. This slows down guessing. After 10 wrong codes in 10 minutes it stops answering for a while.</li>
          </ul>
        </Section>

        <Section title="What professors see">
          <ul>
            <li>How many different students and how many taps each slide got.</li>
            <li>The notes students typed, and the parts of a slide they highlighted. Never a name.</li>
            <li>
              Spots that a student saved with Save this are private. The database does not let a professor read them,
              and they never count.
            </li>
            <li>The CSV has one row per slide: date, lecture, slide number, first line of the slide, lost taps and different students. No notes and no names.</li>
          </ul>
          <p>
            Other students cannot read your taps or your notes. The database only gives them counts. Who can see what is enforced
            in the database itself (row level security), not only on the screen.
          </p>
        </Section>

        <Section title="Teachers">
          <p>
            You sign in with Google, Miami accounts only (@miamioh.edu). The server checks that, not just the button.
            Backtrack keeps your email and the name you chose. Supabase, which runs the sign in, also keeps the basic
            profile Google sends with it.
          </p>
          <p>
            You add courses and start lectures. Your PDF is turned into images in your browser, and only those images
            are uploaded, to a private storage folder. Backtrack also keeps the first line of text of each slide, for
            the CSV. No other teacher can read your courses or lectures. Students can load the slide images of a lecture they
            joined.
          </p>
        </Section>

        <Section title="In your browser">
          <ul>
            <li>A sign in cookie from Supabase. It keeps you signed in, as a student or as a teacher, and lasts up to 400 days unless you clear it.</li>
            <li>Local storage: taps that have not reached the server yet (so a tap made offline is not lost), and a teacher&apos;s choice to hide notes.</li>
            <li>Session storage, until you close the tab: small flags such as a tap that was refused, or that the join code card was put away on the projector.</li>
          </ul>
          <p>
            Backtrack has no ads and no analytics, and loads no scripts from other sites. If you clear this site&apos;s
            data, you get a new anonymous ID and your old spots can no longer be found.
          </p>
        </Section>

        <Section title="How long">
          <p>
            Backtrack never deletes anything on a timer. A lecture, its slide images and the taps on it stay until that
            lecture is deleted. Wrong code records older than a day are cleared the next time the same anonymous ID
            enters a wrong code, so some stay longer.
          </p>
        </Section>

        <Section title="Where it lives">
          <p>
            The site runs on Vercel. The database, file storage and sign in run on Supabase, in the US East region
            (us-east-1). Like any host, they can keep ordinary server logs. Backtrack does not send your data anywhere
            else.
          </p>
        </Section>

        <p className="mt-12 type-body text-secondary">Questions: talk to your professor.</p>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 flex flex-col gap-3 type-body [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
      <h2 className="type-title">{title}</h2>
      {children}
    </section>
  );
}
