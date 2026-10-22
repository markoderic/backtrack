import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMiamiEmail } from "@/lib/email";

const MIAMI_DOMAIN = "miamioh.edu";

type CallbackUser = {
  id: string;
  email?: string;
  user_metadata?: { custom_claims?: { hd?: unknown } } & Record<string, unknown>;
  identities?: { provider?: string; identity_data?: { custom_claims?: { hd?: unknown } } & Record<string, unknown> }[];
};

// Google's hosted domain claim, from wherever Supabase put it. Undefined when absent.
function hostedDomains(user: CallbackUser): string[] {
  const found: unknown[] = [user.user_metadata?.custom_claims?.hd];
  for (const identity of user.identities ?? []) {
    if (identity.provider === "google") found.push(identity.identity_data?.custom_claims?.hd);
  }
  return found
    .filter((hd): hd is string => typeof hd === "string" && hd.trim() !== "")
    .map((hd) => hd.trim().toLowerCase());
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  const code = url.searchParams.get("code");
  if (!code) return go("/teach");

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return go("/teach");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return go("/teach");

  // The real Miami check. The hd hint on the sign in button only steers Google's
  // account picker, so it is checked here on the server. A missing hd claim is
  // fine (the email check still applies); a present one must be miamioh.edu.
  const domains = hostedDomains(user as CallbackUser);
  if (!isMiamiEmail(user.email) || domains.some((hd) => hd !== MIAMI_DOMAIN)) {
    await supabase.auth.signOut();
    return go("/teach/not-miami");
  }

  // Add the row on first sign in; a returning teacher's row is left exactly as it is
  // (insert ... on conflict do nothing). Nothing here updates the row: a teacher may
  // only change their own name (0014), and the email is set once, from Google.
  const { error: insertError } = await supabase
    .from("teachers")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true });
  const { data: teacher, error: readError } = insertError
    ? { data: null, error: insertError }
    : await supabase.from("teachers").select("display_name").eq("id", user.id).maybeSingle();

  // No teachers row means nothing later can work, so do not leave them signed in.
  if (readError || !teacher) {
    await supabase.auth.signOut();
    return go("/teach?error=signin");
  }

  return go(teacher.display_name ? "/teach" : "/teach/setup");
}
