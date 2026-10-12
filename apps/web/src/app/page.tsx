import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 sm:px-10">
      <header className="flex items-center justify-between gap-6 border-b border-white/15 py-7">
        <Link
          href="/"
          className="flex items-center gap-3 text-xl font-semibold tracking-tight"
        >
          <span aria-hidden="true" className="hive-mark" />
          Hivemind
        </Link>
        <a href="#early-access" className="text-sm text-honey hover:text-white">
          Get early access
        </a>
      </header>

      <section className="py-20 sm:py-28" aria-labelledby="hero-title">
        <h1
          id="hero-title"
          className="text-[clamp(4rem,12vw,9rem)] leading-none font-semibold tracking-[-0.075em]"
        >
          Hivemind<span className="text-honey">.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-2xl leading-snug text-stone-200 sm:text-4xl">
          A shared memory for your team&apos;s coding agents
        </p>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-stone-400">
          One agent figures it out. The whole team remembers.
        </p>
        <Link
          href="/app"
          className="mt-9 inline-flex rounded-lg bg-honey px-6 py-3.5 font-semibold text-ink hover:bg-amber-200"
        >
          Open the dashboard
        </Link>
        <ul className="mt-16 grid gap-6 border-t border-white/15 pt-8 text-stone-300 sm:grid-cols-3 sm:gap-10">
          <li>
            <span className="mb-2 block text-lg font-semibold text-white">
              Learn once.
            </span>
            Share discoveries across agents and teammates.
          </li>
          <li>
            <span className="mb-2 block text-lg font-semibold text-white">
              Skip the same mistakes.
            </span>
            Find the gotcha before it costs you an afternoon.
          </li>
          <li>
            <span className="mb-2 block text-lg font-semibold text-white">
              Keep the context.
            </span>
            Carry decisions into the next coding session.
          </li>
        </ul>
      </section>

      <section
        id="early-access"
        className="grid scroll-mt-8 gap-10 rounded-2xl border border-white/15 bg-surface p-7 sm:p-12 md:grid-cols-2"
        aria-labelledby="early-access-title"
      >
        <div>
          <h2
            id="early-access-title"
            className="text-3xl font-semibold tracking-tight"
          >
            A little less déjà vu.
          </h2>
          <p className="mt-4 max-w-sm leading-relaxed text-stone-400">
            We&apos;re building a place for the things your team learns along
            the way.
          </p>
          <p id="form-status" className="mt-6 text-sm text-honey">
            Early access opens soon. This form is a preview and does not send
            your details.
          </p>
        </div>
        <form
          aria-label="Early access"
          aria-describedby="form-status"
          className="grid gap-4"
        >
          <label className="grid gap-2 text-sm">
            Name
            <input name="name" autoComplete="name" placeholder="Your name" />
          </label>
          <label className="grid gap-2 text-sm">
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              Company
              <input
                name="company"
                autoComplete="organization"
                placeholder="Company name"
              />
            </label>
            <label className="grid gap-2 text-sm">
              Team size
              <select name="teamSize" defaultValue="">
                <option value="" disabled>
                  Select a size
                </option>
                <option value="1">Just me</option>
                <option value="2-10">2 to 10</option>
                <option value="11-50">11 to 50</option>
                <option value="51+">51 or more</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled
            className="mt-2 cursor-not-allowed rounded-lg border border-honey/30 bg-honey/10 px-5 py-3 font-medium text-honey"
          >
            Early access opens soon
          </button>
        </form>
      </section>
      <footer className="py-10 text-sm text-stone-500">
        Good work leaves something behind.
      </footer>
    </main>
  );
}
