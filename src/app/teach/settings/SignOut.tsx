"use client";

import { useActionState } from "react";
import { Icon } from "@/components/Icon";
import { buttonSecondaryClass } from "@/components/ButtonPrimary";
import { signOut, type SignOutState } from "./actions";

/** "Signed in as lcarter@miamioh.edu  Sign out" (Small secondary, then a white button, gap 16). */
export function SignOut({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState<SignOutState>(signOut, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 type-small wrap-anywhere text-secondary">
          {email ? `Signed in as ${email}` : "Signed in"}
        </p>
        <button type="submit" disabled={pending} className={buttonSecondaryClass}>
          Sign out
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="flex animate-fade-in items-center gap-2 type-small text-ink">
          <Icon name="alert" size={18} />
          {state.error}
        </p>
      )}
    </div>
  );
}
