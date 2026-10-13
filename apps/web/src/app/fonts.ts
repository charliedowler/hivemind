import { Lilita_One, Nunito, Space_Mono, Silkscreen } from "next/font/google";

const display = Lilita_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
});
const body = Nunito({ subsets: ["latin"], variable: "--font-body" });
const mono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
});
const pixel = Silkscreen({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

export const fontVariables = `${display.variable} ${body.variable} ${mono.variable} ${pixel.variable}`;
