import { LogoLockup } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { SignInButton } from "./sign-in-button";

/**
 * Teacher sign in (Figma 33:709), and the same screen with a message under it
 * (not a Miami account 33:731, or a sign in that did not finish). The message row is
 * reserved, so the button never moves when a message shows.
 */
export function SignInView({ message }: { message?: string | null }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-16">
      <div className="flex animate-page-in flex-col items-center gap-8">
        <h1>
          <LogoLockup size="L" />
        </h1>
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="type-title text-ink">Teacher sign in</h2>
          <SignInButton />
          <p className="type-small text-secondary">Miami University accounts only.</p>
          {message ? (
            <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
              <Icon name="alert" size={18} />
              {message}
            </p>
          ) : (
            <div aria-hidden className="h-5" />
          )}
        </div>
      </div>
    </main>
  );
}
