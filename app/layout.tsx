import "./globals.css";

export const metadata = {
  title: "Oracle.Vision V3",
  description: "Telemetry-first bull signals. Crypto-only. Ship fast."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}