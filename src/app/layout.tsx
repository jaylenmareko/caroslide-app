import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
