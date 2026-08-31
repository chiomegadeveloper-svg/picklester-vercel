"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Picklester startup]", error);
  }, [error]);

  return (
    <main className="arena-shell">
      <div className="phone-app fatal-screen" role="alert">
        <img src="/picklester-logo.png" alt="Picklester" />
        <AlertTriangle />
        <h1>Picklester could not start</h1>
        <p>The app hit a temporary startup problem. Try loading it again.</p>
        <button type="button" onClick={reset}><RotateCcw /> Try again</button>
      </div>
    </main>
  );
}
