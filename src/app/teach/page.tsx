import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";
import { SignInButton } from "./sign-in-button";

async function TeachBody({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && isMiamiEmail(user.email)) {
    const { data: teacher } = await supabase
      .from("teachers")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (teacher && !teacher.display_name) redirect("/teach/setup");
    if (teacher) return <p>{teacher.display_name}</p>;
  }

  const { error } = await searchParams;
  return (
    <>
      {error === "signin" && <p>Sign in didn&apos;t finish. Try again.</p>}
      <SignInButton />
    </>
  );
}

export default function TeachPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: 600 }}>Backtrack</h1>
      <Suspense fallback={null}>
        <TeachBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
