"use client";

import { useEffect, useState } from "react";

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

export function InstallAppHelp() {
  const [isStandalone, setIsStandalone] = useState<boolean | null>(null);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const update = () => {
      setIsStandalone(
        displayMode.matches ||
          (window.navigator as StandaloneNavigator).standalone === true,
      );
    };

    update();
    displayMode.addEventListener("change", update);

    return () => displayMode.removeEventListener("change", update);
  }, []);

  if (isStandalone === null) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Checking how you opened CEIT Connect…
      </p>
    );
  }

  if (isStandalone) {
    return (
      <p className="text-sm font-medium" role="status">
        You&apos;re using the installed app.
      </p>
    );
  }

  return (
    <div className="space-y-5 text-sm">
      <section aria-labelledby="install-iphone-heading">
        <h3 id="install-iphone-heading" className="font-semibold">
          iPhone
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Open CEIT Connect in Safari.</li>
          <li>Tap Share.</li>
          <li>Tap Add to Home Screen.</li>
        </ol>
      </section>

      <section aria-labelledby="install-android-heading">
        <h3 id="install-android-heading" className="font-semibold">
          Android
        </h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Open CEIT Connect in Chrome.</li>
          <li>Open the Chrome menu.</li>
          <li>Tap Install app, or Add to Home screen if you see that instead.</li>
        </ol>
      </section>

      <p className="text-muted-foreground">
        On iPhone, the installed app keeps its own sign-in, and invite and reset
        links open in Safari first.
      </p>
    </div>
  );
}
