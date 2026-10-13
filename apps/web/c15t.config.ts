import { defineConsentConfig } from "c15t/next";

export default defineConsentConfig({
  options: {
    consentCategories: ["necessary"],
    legalLinks: { privacyPolicy: { href: "/privacy", target: "_self" } },
    i18n: {
      messages: {
        en: {
          legalLinks: { privacyPolicy: "Privacy policy" },
          common: {
            acceptAll: "Continue",
            rejectAll: "Necessary only",
            customize: "Choose preferences",
            save: "Save preferences",
          },
          cookieBanner: {
            title: "Your privacy choices",
            description:
              "Hive uses only necessary cookies to run the service and remember your choices. We do not track page or cell visits.",
          },
          consentManagerDialog: {
            title: "Privacy preferences",
            description:
              "Hive uses only necessary cookies. These stay on to run the service, keep you signed in and remember your privacy choices.",
          },
          consentTypes: {
            necessary: {
              title: "Necessary",
              description:
                "Keep you signed in, run Hive and remember your privacy choices. These stay on.",
            },
          },
        },
      },
    },
    components: {
      banner: {
        card: { className: "privacy-card" },
        title: { className: "privacy-title" },
      },
      dialog: {
        card: { className: "privacy-card" },
        title: { className: "privacy-title" },
      },
    },
  },
});
