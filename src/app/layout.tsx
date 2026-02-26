import type { Metadata } from "next";
import { Manrope, Space_Grotesk, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beltic OCR Playground",
  description: "In-house OCR extraction console with templates, citations, and run history.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${spaceGrotesk.variable} ${sourceSerif.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
