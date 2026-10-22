import Link from "next/link";
import { ButtonPrimaryLink, buttonSecondaryClass, buttonSecondaryWideClass } from "@/components/ButtonPrimary";
import { LinkPending, pendingPressClass } from "@/components/LinkPending";
import { LogoLockup } from "@/components/Logo";
import { PrivacyLink } from "@/components/PrivacyLink";

/**
 * Home (Figma 31:74): the logo and two choices, Join a class (the one primary button) and I'm a teacher
 * (the white secondary button at the same size), then a smaller white My spots for a student's
 * lectures on this browser (Marko, 2:10 PM: a way back to My spots outside a live lecture).
 * Both press in (scale .97), ease their hover color and fade their focus ring in (press utility).
 */
export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-bg px-4">
      <div className="flex w-full animate-page-in flex-col items-center gap-10">
        <h1>
          <LogoLockup size="L" />
        </h1>
        <nav className="flex w-full flex-col items-center gap-3">
          <ButtonPrimaryLink href="/join">Join a class</ButtonPrimaryLink>
          {/* A white button the size of Join a class (not an underlined link). It stays pressed
              until the teacher page or its skeleton shows, so a click never looks ignored. */}
          <Link href="/teach" className={`${buttonSecondaryWideClass} ${pendingPressClass}`}>
            I&apos;m a teacher
            <LinkPending />
          </Link>
        </nav>
        {/* Quieter than the two choices, and apart from them: a student's lectures on this browser,
            live or ended (Marko, 2:10 PM). Smaller, white. */}
        <Link href="/spots" className={`${buttonSecondaryClass} ${pendingPressClass} -mt-4 px-5`}>
          My spots
          <LinkPending />
        </Link>
      </div>
      {/* Quiet footer: out of the flow, so the logo and the two choices stay exactly centered. */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
        <PrivacyLink className="pointer-events-auto" />
      </footer>
    </main>
  );
}
