import Link from "next/link";
import { buttonPrimaryClass, buttonSecondaryWideClass } from "@/components/ButtonPrimary";
import { LinkPending, pendingPressClass, pendingPressPrimaryClass } from "@/components/LinkPending";
import { LogoLockup } from "@/components/Logo";
import { PrivacyLink } from "@/components/PrivacyLink";

/**
 * Home (Figma 31:74): the logo and two choices only, I'm a student (the one primary button, to
 * the code page, where My spots also lives) and I'm a teacher (the white secondary button at the
 * same size). Marko, hand test 2: a student picks "student" first, then sees the code boxes
 * and My spots there. Both press in (scale .97), ease their hover color and fade their focus
 * ring in (press utility), and hold the press until the next page shows.
 */
export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-bg px-4">
      <div className="flex w-full animate-page-in flex-col items-center gap-10">
        <h1>
          <LogoLockup size="L" />
        </h1>
        <nav className="flex w-full flex-col items-center gap-3">
          <Link href="/join" className={`${buttonPrimaryClass} ${pendingPressPrimaryClass}`}>
            I&apos;m a student
            <LinkPending />
          </Link>
          {/* A white button the size of I'm a student (not an underlined link). It stays pressed
              until the teacher page or its skeleton shows, so a click never looks ignored. */}
          <Link href="/teach" className={`${buttonSecondaryWideClass} ${pendingPressClass}`}>
            I&apos;m a teacher
            <LinkPending />
          </Link>
        </nav>
      </div>
      {/* Quiet footer: out of the flow, so the logo and the two choices stay exactly centered. */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
        <PrivacyLink className="pointer-events-auto" />
      </footer>
    </main>
  );
}
