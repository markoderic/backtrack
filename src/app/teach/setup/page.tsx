import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { SetupForm } from "./setup-form";

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

  return <SetupForm />;
}

export default function SetupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-4xl font-semibold">Backtrack</h1>
      <Suspense fallback={null}>
        <SetupBody />
      </Suspense>
    </main>
  );
}
