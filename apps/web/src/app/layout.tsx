import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontstage",
  description: "Keep the work backstage. Keep clients in the loop.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
