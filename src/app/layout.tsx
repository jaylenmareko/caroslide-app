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

// SEO audit fix (2026-08-01): title was a bare "Caroslide" with zero keywords -- the single
// highest-leverage on-page fix available (title is the first thing both users and Google weigh
// for relevance). Also the first real openGraph/twitter block the site has ever had (verified live:
// zero og:*/twitter:* tags existed before this). metadataBase is required for openGraph.images
// (set per-page, see src/app/page.tsx) to resolve to an absolute URL. Deliberately a plain string
// title, not Next's {default, template} pattern -- privacy/terms already set their own full
// "X — Caroslide" strings, and a template would double-suffix them ("... — Caroslide — Caroslide").
export const metadata: Metadata = {
  metadataBase: new URL("https://caroslide.com"),
  title: "AI Carousel Generator for Instagram — Caroslide",
  description: "Real, AI-generated carousels — pick an angle, drop in a topic, get slides ready to post.",
  openGraph: {
    title: "AI Carousel Generator for Instagram — Caroslide",
    description: "Real, AI-generated carousels — pick an angle, drop in a topic, get slides ready to post.",
    siteName: "Caroslide",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Carousel Generator for Instagram — Caroslide",
    description: "Real, AI-generated carousels — pick an angle, drop in a topic, get slides ready to post.",
  },
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
