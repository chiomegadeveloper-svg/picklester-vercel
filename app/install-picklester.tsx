"use client";

import { useEffect, useState } from "react";
import { Download, Laptop, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPicklester({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [ios] = useState(
    () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent),
  );

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const installed = () => {
      setPrompt(null);
      toast.success("Picklester installed.");
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function install() {
    if (window.matchMedia("(display-mode: standalone)").matches)
      return toast.success("Picklester is already installed.");
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setPrompt(null);
      return;
    }
    setHelpOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className={compact ? "install-button compact" : "install-button"}
        onClick={() => void install()}
      >
        <Download />
        <span>{compact ? "Install app" : "Install Picklester"}</span>
      </button>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="match-dialog install-dialog">
          <DialogHeader>
            <div className="dialog-kicker">
              <Download /> INSTALL APP
            </div>
            <DialogTitle>Add Picklester to your device</DialogTitle>
            <DialogDescription>
              Use it like an app without visiting an app store.
            </DialogDescription>
          </DialogHeader>
          <div className="install-steps">
            <article>
              <Smartphone />
              <span>
                <b>Android</b>
                <small>
                  Open in Chrome, tap the browser menu, then Install app or Add
                  to Home screen.
                </small>
              </span>
            </article>
            <article className={ios ? "recommended" : ""}>
              <Smartphone />
              <span>
                <b>iPhone / iPad</b>
                <small>
                  Open in Safari, tap Share, then Add to Home Screen.
                </small>
              </span>
            </article>
            <article>
              <Laptop />
              <span>
                <b>Desktop</b>
                <small>
                  Open in Chrome or Edge and select the install icon in the
                  address bar.
                </small>
              </span>
            </article>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
