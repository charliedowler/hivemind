import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-20">
      <p className="text-lg font-semibold text-honey">Hivemind</p>
      <h1 className="mt-6 text-5xl font-semibold tracking-tight">
        The dashboard is coming.
      </h1>
      <p className="mt-6 text-lg text-stone-400">
        Your team&apos;s shared memory will live here.
      </p>
      <Link
        href="/"
        className="mt-10 w-fit text-honey underline underline-offset-4"
      >
        Back to Hivemind
      </Link>
    </main>
  );
}
