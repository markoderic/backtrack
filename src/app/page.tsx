import Link from "next/link";
import { ButtonPrimaryLink } from "@/components/ButtonPrimary";
import { LogoLockup } from "@/components/Logo";

/** Home (Figma 31:74): the logo and two choices, Join a class (the one primary button) and I'm a teacher. */
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4">
      <div className="flex w-full animate-rise-in flex-col items-center gap-10">
        <h1>
          <LogoLockup size="L" />
        </h1>
        <nav className="flex w-full flex-col items-center gap-5">
          <ButtonPrimaryLink href="/join">Join a class</ButtonPrimaryLink>
          <Link href="/teach" className="focus-ring rounded-xs type-body text-ink underline">
            I&apos;m a teacher
          </Link>
        </nav>
      </div>
    </main>
  );
}
