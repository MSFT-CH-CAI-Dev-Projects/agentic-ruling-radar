import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-bold">Ruling Radar</h1>
        <p className="mt-2 text-brand-gray">
          Triage und Zusammenfassung neuer Schweizer Bundesgerichtsurteile — mit
          vollständigem Agent-Trace und überprüfbaren Quellen.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-1">
        <Link
          href="/case-1"
          className="block border border-brand-gray-dark p-6 hover:border-brand-primary"
        >
          <h2 className="text-xl font-bold">
            Use-Case 1 — Bundesgerichtsurteile
          </h2>
          <p className="mt-2 text-sm text-brand-gray">
            URL einfügen → strukturierte 7-Abschnitt-Zusammenfassung (Eckdaten,
            Sachverhalt, Streitgegenstand, Erwägungen, Dispositiv, Bedeutung,
            Schlagworte) als DOCX in SharePoint.
          </p>
          <p className="mt-4 text-brand-primary text-sm font-bold">Starten →</p>
        </Link>
      </section>

      <section className="border-l-4 border-brand-yellow bg-brand-light p-4 text-sm">
        <strong>Demo-Daten:</strong> Alle Personen-, Fall- und Dokumentdaten in
        diesem System sind <em>synthetisch generiert</em>. Es existieren keine
        Bezüge zu realen Versicherten.
      </section>
    </div>
  );
}
