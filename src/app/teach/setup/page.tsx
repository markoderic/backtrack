import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { LogoLockup } from "@/components/Logo";
import { SetupForm } from "./setup-form";

/** The name Google gave, as a starting point the teacher can change. */
function googleName(meta: unknown): string {
  const m = (meta ?? {}) as { full_name?: unknown; name?: unknown };
  const name = typeof m.full_name === "string" ? m.full_name : typeof m.name === "string" ? m.name : "";
  return name.trim().slice(0, 80);
}

async function SetupBody() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teach");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  // No teachers row, or setup already done.
  if (!teacher || teacher.display_name) redirect("/teach");

  return <SetupForm defaultName={googleName(user.user_metadata)} />;
}

// First time setup (Figma 33:759): logo top left, a 480 wide form in the middle.
export default function SetupPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-4 py-5 sm:px-8">
        <Link href="/" aria-label="backtrack, home" className="press focus-ring block w-fit rounded-sm">
          <LogoLockup size="S" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[544px] flex-1 animate-rise-in flex-col justify-center gap-7 px-4 pt-6 pb-16 sm:px-8">
        <h1 className="type-display text-ink">Set up your classes</h1>
        <Suspense fallback={null}>
          <SetupBody />
        </Suspense>
      </main>
    </div>
  );
}
