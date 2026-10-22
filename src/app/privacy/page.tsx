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
          <p>You never sign in or sign up. Backtrack does not ask for a name, an email or a password.</p>
          <p>
            When you join with a code, Backtrack gets a random anonymous ID for your browser. Backtrack does not tie it
            to your name or your email, and Backtrack&apos;s own tables keep no device details with it. It lets you find your own spots again,
            lets Backtrack count different students without knowing who they are, and is what the limits below count
            against.
          </p>
          <p>Stored for you:</p>
          <ul>
            <li>Which lectures you joined, and when.</li>
            <li>
              Each time you tap I&apos;m lost or save a spot: the slide, the time, the note if you typed one, and the
              part of the slide you highlighted if you did.
            </li>
            <li>
              A tap you undo stays in the database, marked as undone, with its note and highlight. It is not counted,
              and the professor&apos;s screen does not show it.
            </li>
            <li>
              Each time you enter a wrong code: the time, with your anonymous ID. The code you typed is not kept. This
              slows down guessing. After 10 wrong codes in 10 minutes it stops answering for a while, even for a right
              code.
            </li>
            <li>
              At most 20 taps in a minute and 300 in one lecture for each student. After that taps are refused. This
              stops one browser from flooding a class.
            </li>
          </ul>
        </Section>

        <Section title="What professors see">
          <ul>
            <li>How many different students and how many taps each slide got.</li>
            <li>
              The notes students type, with the time of each tap, on the slide data screen, during the lecture and
              afterwards. Also the parts of a slide students highlighted. No names. Do not put your name or anything
              private in a note: the professor reads it.
            </li>
            <li>
              The screens never show your anonymous ID. The database does send it to the professor&apos;s browser so it
              can count different students, and it is the same ID in every lecture you join on this browser.
            </li>
            <li>
              Spots that a student saved with Save this are private. The database does not let a professor read them,
              and they never count.
            </li>
            <li>The CSV has one row per slide: date, lecture, slide number, first line of the slide, lost taps and different students. No notes and no names.</li>
          </ul>
          <p>A professor can hide notes on their own screen, for example when it is on a projector.</p>
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
            are uploaded, to a private storage folder. Backtrack also keeps the first line of text of each slide, to name
            the slide on the data screen, in My spots and in the CSV. No other teacher can read your courses or lectures. Students can load the slide images of a lecture they
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
            The code has no ads and no analytics, and loads no scripts from other sites. If you clear this site&apos;s
            data, you get a new anonymous ID and your old spots can no longer be found.
          </p>
        </Section>

        <Section title="How long">
          <p>
            Backtrack never deletes anything on a timer. A teacher can delete an ended lecture. That removes its taps,
            notes and joined list, and then its slide images. If an image fails to delete it can stay in storage. Wrong
            code records older than a day are cleared the next time the same anonymous ID
            enters a wrong code, so some stay longer.
          </p>
        </Section>

        <Section title="Where it lives">
          <p>
            The site runs on Vercel. The database, file storage and sign in run on Supabase, in the US East region
            (us-east-1). Vercel and Supabase may keep ordinary server logs, which can include your IP address. Backtrack does not send your data anywhere
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
