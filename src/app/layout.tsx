import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoopAtoms Builder",
  description: "シームレスなループ音声を作成・結合するブラウザエディタ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
