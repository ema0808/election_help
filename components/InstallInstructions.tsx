"use client";

import { useState } from "react";
import { useInstallPrompt, type Platform } from "@/lib/useInstallPrompt";

const TABS: { key: Platform; label: string }[] = [
  { key: "ios", label: "iPhone" },
  { key: "android", label: "Android" },
];

export function InstallInstructions() {
  const { platform, isStandalone, canPromptInstall, promptInstall } = useInstallPrompt();
  const [tab, setTab] = useState<Platform>(platform === "android" ? "android" : "ios");
  const [installed, setInstalled] = useState(false);

  if (isStandalone || installed) return null;

  async function handleInstallClick() {
    const accepted = await promptInstall();
    if (accepted) setInstalled(true);
  }

  return (
    <div className="w-full rounded-xl bg-zinc-100 px-4 py-3 text-left dark:bg-zinc-800">
      <div className="text-sm font-medium">Dodaj na početni ekran</div>
      <div className="mt-1 mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        Instaliraj aplikaciju na telefon da joj pristupiš jednim dodirom, čak i bez interneta.
      </div>

      <div className="mb-3 flex gap-1 rounded-full bg-zinc-200 p-1 text-xs dark:bg-zinc-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-full py-1.5 font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-foreground shadow-sm dark:bg-zinc-900"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ios" && (
        <ol className="list-inside list-decimal space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            Dodirni ikonu <strong>Podijeli</strong> (kvadrat sa strelicom prema gore) u traci pregledača.
          </li>
          <li>
            Odaberi <strong>Dodaj na početni ekran</strong>.
          </li>
          <li>
            Dodirni <strong>Dodaj</strong> u gornjem desnom uglu.
          </li>
        </ol>
      )}

      {tab === "android" &&
        (canPromptInstall ? (
          <button
            type="button"
            onClick={handleInstallClick}
            className="w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Instaliraj aplikaciju
          </button>
        ) : (
          <ol className="list-inside list-decimal space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            <li>
              Dodirni meni (tri tačke) u gornjem desnom uglu pregledača.
            </li>
            <li>
              Odaberi <strong>Instaliraj aplikaciju</strong> ili <strong>Dodaj na početni ekran</strong>.
            </li>
            <li>Potvrdi instalaciju.</li>
          </ol>
        ))}
    </div>
  );
}
