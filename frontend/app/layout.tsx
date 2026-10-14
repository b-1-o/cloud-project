import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Collab Docs",
  description: "Documents that stay in sync.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
