import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AStock 看盘",
  description: "A股实时行情看盘工具：指数、自选、分时K线、板块、选股、持仓与涨跌停",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${plex.variable} antialiased bg-bg text-ink`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
