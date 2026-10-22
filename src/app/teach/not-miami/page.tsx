import { SignInView } from "../sign-in-view";

// The server's hosted domain check failed in /auth/callback (it already signed them out).
export default function NotMiamiPage() {
  return <SignInView message="That isn't a Miami account. Use your @miamioh.edu account." />;
}
