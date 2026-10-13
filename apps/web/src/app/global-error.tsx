"use client";

import { ErrorBoundary, type ErrorBoundaryProps } from "@/components/error-boundary";
import "@hivemind/design-system/app.css";
import "./globals.css";
import { ConsentBanner, ConsentDialog, ConsentRoot } from "c15t/next";
import { CookiePreferencesLink } from "@/components/cookie-preferences-link";
import "./privacy.css";
import { fontVariables } from "./fonts";

export default function GlobalError(props: ErrorBoundaryProps) {
  return <html lang="en"><head><title>Something went wrong · Hive</title></head><body className={fontVariables}><ConsentRoot><ErrorBoundary {...props} /><ConsentBanner legalLinks={["privacyPolicy"]} /><ConsentDialog legalLinks={["privacyPolicy"]} /><footer className="privacy-footer"><CookiePreferencesLink /></footer></ConsentRoot></body></html>;
}
