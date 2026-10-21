import Link from "next/link";

export default function Home() {
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
      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        <Link href="/join" style={{ padding: "0.75rem 1.5rem", border: "1px solid currentColor" }}>
          Join a class
        </Link>
        <Link href="/teach" style={{ padding: "0.75rem 1.5rem", border: "1px solid currentColor" }}>
          I&apos;m a teacher
        </Link>
      </nav>
    </main>
  );
}
