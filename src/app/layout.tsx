import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "docs-mcp — vector RAG store for any document",
  description:
    "Drop any Word/Excel/PDF/PowerPoint into a queryable vector store. Vision-model extraction for scans + charts, page-number citations, break-even pricing. $5 = 5,700 pages.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
