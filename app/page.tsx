import Image from "next/image";
import Link from "next/link";

const FEATURES = [
  {
    title: "Radi bez interneta",
    text: "Pretraga priručnika radi u potpunosti offline, direktno na uređaju.",
  },
  {
    title: "Pametniji odgovori online",
    text: "Kad imate internet, dobijate precizniji odgovor uz izvore iz priručnika.",
  },
  {
    title: "Oba uređaja na jednom mjestu",
    text: "Uređaj za identifikaciju birača i optički skener za brojanje glasova.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <Image
          src="/icons/icon-512.png"
          alt="Izbori - Tehnička podrška"
          width={72}
          height={72}
          className="rounded-2xl"
          priority
        />

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Izbori - Tehnička podrška</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Tehnička podrška za operatere na biračkom mjestu na dan izbora u Bosni i Hercegovini — brzo pronađite rješenje u
            priručnicima za izborne uređaje, sa ili bez interneta.
          </p>
        </div>

        <ul className="flex w-full flex-col gap-3 text-left">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
              <div className="text-sm font-medium">{f.title}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">{f.text}</div>
            </li>
          ))}
        </ul>

        <Link
          href="/chat"
          className="w-full rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Postavi pitanje →
        </Link>
      </div>
    </div>
  );
}
