import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "ResumeMatch | Resume text extractor",
  description: "Extract raw text from PDF and DOCX resumes.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f5f7fb",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
