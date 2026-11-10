"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

type Device = "ios" | "android" | "other";

function detectDevice(): Device {
  const agent = window.navigator.userAgent;
  const touchMac = /Macintosh/i.test(agent) && window.navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/i.test(agent) || touchMac) return "ios";
  if (/android/i.test(agent)) return "android";
  return "other";
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-3 grid gap-2.5">
      {steps.map((step, index) => (
        <li key={step} className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
          >
            {index + 1}
          </span>
          <span className="text-muted-foreground">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallAppHelp() {
  const [isStandalone, setIsStandalone] = useState<boolean | null>(null);
  const [device, setDevice] = useState<Device>("other");

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const update = () => {
      setDevice(detectDevice());
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
      <p
        className="flex items-center gap-2 text-sm font-medium text-accent-foreground"
        role="status"
      >
        <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
        You&apos;re using the installed app.
      </p>
    );
  }

  const iphoneFirst = device !== "android";

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="rounded-xl bg-muted px-3.5 py-2.5 text-accent-foreground">
        Not installed yet. It takes about 10 seconds and adds CEIT Connect to your
        home screen like any other app.
      </p>

      <div className="flex flex-col gap-3">
        <section
          aria-labelledby="install-iphone-heading"
          className={cn(
            "rounded-xl border p-3.5",
            iphoneFirst ? "order-1" : "order-2",
            device === "ios" && "border-primary/40 bg-primary/5",
          )}
        >
          <h3
            id="install-iphone-heading"
            className="flex items-center gap-2 font-semibold"
          >
            iPhone
            {device === "ios" ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                Your device
              </span>
            ) : null}
          </h3>
          <Steps
            steps={[
              "Open CEIT Connect in Safari.",
              "Tap Share.",
              "Tap Add to Home Screen.",
            ]}
          />
        </section>

        <section
          aria-labelledby="install-android-heading"
          className={cn(
            "rounded-xl border p-3.5",
            iphoneFirst ? "order-2" : "order-1",
            device === "android" && "border-primary/40 bg-primary/5",
          )}
        >
          <h3
            id="install-android-heading"
            className="flex items-center gap-2 font-semibold"
          >
            Android
            {device === "android" ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                Your device
              </span>
            ) : null}
          </h3>
          <Steps
            steps={[
              "Open CEIT Connect in Chrome.",
              "Open the Chrome menu.",
              "Tap Install app, or Add to Home screen if you see that instead.",
            ]}
          />
        </section>
      </div>

      <p className="text-muted-foreground">
        On iPhone, the installed app keeps its own sign-in, and invite and reset
        links open in Safari first.
      </p>
    </div>
  );
}