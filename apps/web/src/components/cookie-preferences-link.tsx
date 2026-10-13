"use client";

import { useSetActiveUI } from "c15t/next";

export function CookiePreferencesLink() {
  const setActiveUI = useSetActiveUI();

  return (
    <button
      type="button"
      className="privacy-link"
      onClick={() => setActiveUI("dialog")}
    >
      Cookie preferences
    </button>
  );
}
