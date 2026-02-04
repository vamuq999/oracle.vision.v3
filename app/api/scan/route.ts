import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  base: "base", // (CoinGecko token/project id may differ; keeping for UX, will fallback)
  doge: "dogecoin",
  ada: "cardano"
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function parseSymbols(url: URL) {
  const raw = url.searchParams.get("symbols") || "btc,eth,sol";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "oracle-vision-v3"
    },
    // Keep it snappy, avoid dead-hanging
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  return res.json();
}

// simple RSI(14) on close series
function rsi14(closes: number[]) {
  if (closes.length < 16) return null;
  const period = 14;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }

  gains /= period;
  losses /= period;

  let rs = losses === 0 ? 100 : gains / losses;
  let rsi = 100 - 100 / (1 + rs);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;

    gains = (gains * (period - 1) + gain) / period;
    losses = (losses * (period - 1) + loss) / period;

    rs = losses === 0 ? 100 : gains / losses;
    rsi = 100 - 100 / (1 + rs);
  }

  return clamp(rsi, 0, 100);
}

function bullScore(params: {
  change24h: number; // %
  rsi: number | null;
  volRatio: number; // last hour volume vs avg
}) {
  const { change24h, rsi, volRatio } = params;

  // score from 0..100
  let s = 50;

  // momentum
  s += clamp(change24h, -10, 10) * 2.2; // -22..+22

  // RSI sweet spot: 50-65 is "healthy bull"; too high = overheated
  if (rsi != null) {
    if (rsi >= 50 && rsi <= 65) s += 18;
    else if (rsi > 65 && rsi <= 75) s += 8;
    else if (rsi < 40) s -= 12;
    else if (rsi > 80) s -= 10;
  }

  // volume pop
  s += clamp((volRatio - 1) * 20, -12, 18);

  return clamp(Math.round(s), 0, 100);
}

function labelFromScore(score: number) {
  if (score >= 75) return { label: "BULLISH", tone: "good" as const };
  if (score >= 55) return { label: "UPTREND", tone: "warn" as const };
  return { label: "RISK / CHOP", tone: "bad" as const };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = parseSymbols(url);

    // Map to IDs (fallback: keep symbol but might fail upstream; we handle gracefully)
    const ids = symbols
      .map((s) => SYMBOL_TO_COINGECKO_ID[s] || "")
      .filter(Boolean)
      .join(",");

    // Current market snapshot (price, 24h change, volume, market cap)
    const marketsUrl =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h`;

    const markets = await fetchJson(marketsUrl);

    // For each coin, pull last 2 days hourly prices+volume to compute RSI + volume ratio
    const out = await Promise.all(
      (markets as any[]).map(async (m) => {
        const id = String(m.id || "");
        const symbol = String(m.symbol || "").toLowerCase();

        // market_chart includes prices + total_volumes arrays
        const chartUrl =
          `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=2&interval=hourly`;

        let rsi: number | null = null;
        let volRatio = 1;

        try {
          const chart = await fetchJson(chartUrl);
          const prices: number[] = (chart?.prices || []).map((p: any) => Number(p?.[1]));
          const vols: number[] = (chart?.total_volumes || []).map((v: any) => Number(v?.[1]));

          rsi = rsi14(prices.filter((x) => Number.isFinite(x)));

          const v = vols.filter((x) => Number.isFinite(x));
          if (v.length >= 10) {
            const last = v[v.length - 1];
            const avg = v.slice(Math.max(0, v.length - 10), v.length - 1).reduce((a, b) => a + b, 0) / 9;
            if (avg > 0) volRatio = last / avg;
          }
        } catch {
          // ignore per-coin chart failures
        }

        const change24h = Number(m.price_change_percentage_24h ?? 0);
        const score = bullScore({ change24h, rsi, volRatio });
        const lbl = labelFromScore(score);

        return {
          id,
          symbol,
          name: String(m.name || symbol.toUpperCase()),
          price: Number(m.current_price ?? 0),
          marketCap: Number(m.market_cap ?? 0),
          vol24h: Number(m.total_volume ?? 0),
          change24h,
          rsi14: rsi,
          volRatio: Number.isFinite(volRatio) ? Math.round(volRatio * 100) / 100 : 1,
          score,
          stance: lbl.label,
          tone: lbl.tone,
          ts: Date.now()
        };
      })
    );

    return NextResponse.json(
      { ok: true, symbols, data: out, ts: Date.now() },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Scan failed",
        detail: String(e?.message || e)
      },
      { status: 502 }
    );
  }
}