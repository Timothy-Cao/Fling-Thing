const contactEmail = "timcao.support@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] px-6 py-12 text-sm leading-7 text-zinc-300">
      <div className="mx-auto max-w-3xl space-y-6">
        <a className="text-xs text-cyan-300 hover:text-cyan-100" href="/">Back to Fling Thing</a>
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p>Last updated: May 26, 2026</p>
        <p>Fling Thing is not intended for children under 13.</p>
        <section>
          <h2 className="text-xl font-semibold text-white">Local data</h2>
          <p>
            The game may save your contraption, coins, best distance, and dismissed hints in your
            browser using local storage. This data stays on your device unless you clear it.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-white">Analytics and hosting</h2>
          <p>
            The site is hosted on Vercel and may use Vercel Analytics. Hosting and analytics providers
            may process traffic, browser, device, country, referrer, and performance information.
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-white">Contact</h2>
          <p>
            For privacy questions, email{" "}
            <a className="text-cyan-300 underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
