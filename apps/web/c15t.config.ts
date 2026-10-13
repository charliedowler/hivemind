import { defineConsentConfig } from "c15t/next";

export default defineConsentConfig({
  options: {
    consentCategories: ["necessary", "measurement"],
    legalLinks: { privacyPolicy: { href: "/privacy", target: "_self" } },
    i18n: {
      messages: {
        en: {
          legalLinks: { privacyPolicy: "Privacy policy" },
          common: {
            acceptAll: "Accept all",
            rejectAll: "Reject optional",
            customize: "Choose preferences",
            save: "Save preferences",
          },
          cookieBanner: {
            title: "Your privacy choices",
            description:
              "Hive uses necessary cookies to run the service and remember your choices. Optional measurement helps us understand how Hive is used, only if you allow it.",
          },
          consentManagerDialog: {
            title: "Privacy preferences",
            description:
              "Choose whether Hive can measure page visits. You can change your mind here at any time. Necessary cookies stay on to run the service.",
          },
          consentTypes: {
            necessary: {
              title: "Necessary",
              description:
                "Keep you signed in, run Hive and remember your privacy choices. These stay on.",
            },
            measurement: {
              title: "Measurement",
              description:
                "Allow Hive to measure page and cell visits to understand how the service is used. No measurement beacon is sent until you opt in.",
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
