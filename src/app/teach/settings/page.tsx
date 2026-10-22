import { Suspense } from "react";
import { SettingsBody } from "./settings-body";

// Teacher Settings (Figma 34:1246). Everything on it reads the session, so it renders inside Suspense.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsBody />
    </Suspense>
  );
}
