import type { Metadata } from "next";
import { Inter_Tight, Fraunces, Poppins, Montserrat, Archivo_Black, DM_Sans } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-brand",
  weight: ["600"],
  style: ["italic"],
  display: "swap",
});

// Brand Kit font picker options (see src/lib/types.ts BRAND_FONTS) -- loaded globally
// since next/font/google requires static, build-time imports, not per-request selection.
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-poppins", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });
const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-archivo-black", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Caroslide",
  description: "Real, AI-generated carousels — pick an angle, drop in a topic, get slides ready to post.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${fraunces.variable} ${poppins.variable} ${montserrat.variable} ${archivoBlack.variable} ${dmSans.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
