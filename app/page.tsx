"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Tone = "good" | "warn" | "bad";

type CoinRow = {
  id: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  vol24h: number;
  change24h: number;
  rsi14: number | null;
  volRatio: number;
  score: number;
  stance: string;
  tone: Tone;
  ts: number;
};

const RECEIVING_WALLET = "0x959d4b2755e70961ddbbb47d4f1f9de894262d9b"; // your wallet
const PRO_PRICE_ETH = "0.01"; // change if you want

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "-";
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtCompact(n: number) {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
}

function toneDot(t: Tone) {
  if (t === "good") return "live";
  if (t === "warn") return "";
  return "dead";
}

function weiFromEth(ethStr: string) {
  // string-safe conversion to wei without extra libs
  const [a, b = ""] = ethStr.split(".");
  const frac = (b + "0".repeat(18)).slice(0, 18);
  const wei = BigInt(a || "0") * 10n ** 18n + BigInt(frac || "0");
  return "0x" + wei.toString(16);
}

function nowMs() {
  return Date.now();
}

const PRO_KEY = "oraclevisionv3_pro_until_ms";

function getProUntil() {
  try {
    const v = localStorage.getItem(PRO_KEY);
    const n = v ? Number(v) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setProFor24h() {
  try {
    const until = nowMs() + 24 * 60 * 60 * 1000;
    localStorage.setItem(PRO_KEY, String(until));
    return until;
  } catch {
    return 0;
  }
}

export default function Page() {
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<string>("");
  const [live, setLive] = useState(false);

  const [symbols, setSymbols] = useState("btc,eth,sol");
  const [rows, setRows] = useState<CoinRow[]>([]);
  const [lastErr, setLastErr] = useState<string>("");

  const [proUntil, setProUntilState] = useState<number>(0);
  const proActive = proUntil > nowMs();

  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string>("");

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setProUntilState(getProUntil());
  }, []);

  async function refresh() {
    try {
      setLastErr("");
      const res = await fetch(`/api/scan?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.detail || j?.error || "bad response");
      setRows(j.data || []);
      setLive(true);
    } catch (e: any) {
      setLive(false);
      setLastErr(String(e?.message || e));
    }
  }

  function startAuto() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    refresh();
    timerRef.current = window.setInterval(refresh, 10_000);
  }

  function stopAuto() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => {
    startAuto();
    return () => stopAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // listen for account/chain changes
    const eth = (window as any).ethereum;
    if (!eth?.on) return;

    const onAccounts = (accs: string[]) => setAccount(accs?.[0] || "");
    const onChain = (cid: string) => setChainId(cid || "");

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);

    return () => {
      try {
        eth.removeListener("accountsChanged", onAccounts);
        eth.removeListener("chainChanged", onChain);
      } catch {}
    };
  }, []);

  async function connect() {
    const eth = (window as any).ethereum;
    if (!eth?.request) {
      alert("MetaMask not found. Install MetaMask mobile or enable the in-app browser.");
      return;
    }
    const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(accs?.[0] || "");
    const cid = (await eth.request({ method: "eth_chainId" })) as string;
    setChainId(cid || "");
  }

  async function unlockPro() {
    const eth = (window as any).ethereum;
    if (!eth?.request) {
      alert("MetaMask not found.");
      return;
    }
    if (!account) {
      await connect();
      if (!(window as any).ethereum) return;
    }

    setSending(true);
    setTxHash("");

    try {
      const value = weiFromEth(PRO_PRICE_ETH);
      const tx = {
        from: account,
        to: RECEIVING_WALLET,
        value
      };

      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [tx]
      })) as string;

      setTxHash(hash);

      // Local unlock (24h) once tx is submitted
      const until = setProFor24h();
      setProUntilState(until);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  const summary = useMemo(() => {
    if (!rows.length) return { avg: 0, best: null as CoinRow | null, worst: null as CoinRow | null };
    const avg = Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length);
    const best = [...rows].sort((a, b) => b.score - a.score)[0];
    const worst = [...rows].sort((a, b) => a.score - b.score)[0];
    return { avg, best, worst };
  }, [rows]);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="orb" />
          <div>
            <p className="h1">ORACLE.VISION.V3</p>
            <p className="sub">Telemetry-first bull signals • crypto-only ops</p>
          </div>
        </div>

        <div className="row">
          <span className="badge">
            <span className={`dot ${live ? "live" : "dead"}`} />
            {live ? "LIVE • auto-scan 10s" : "OFFLINE • retrying"}
          </span>

          <button className="btn" onClick={refresh}>Refresh</button>

          {!account ? (
            <button className="btn primary" onClick={connect}>Connect MetaMask</button>
          ) : (
            <span className="badge">
              <span className="dot live" />
              <span className="mono">{shortAddr(account)}</span>
              <span style={{ opacity: 0.8 }}>{chainId ? ` • ${chainId}` : ""}</span>
            </span>
          )}

          {proActive ? (
            <button className="btn good" onClick={() => alert("Pro is active. Keep hunting signals 😈")}>
              PRO ACTIVE
            </button>
          ) : (
            <button className="btn primary" disabled={sending} onClick={unlockPro}>
              {sending ? "Sending…" : `Unlock Pro (${PRO_PRICE_ETH} ETH)`}
            </button>
          )}
        </div>
      </div>

      <div className="hero">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em" }}>
              Market Intent Scanner
            </h2>
            <p className="small" style={{ marginTop: 8, maxWidth: 720 }}>
              This isn’t financial advice—this is **signal intelligence**. We’re reading momentum + RSI heat + volume pop.
              Trad rules, modern execution: measure twice, ape once.
            </p>
          </div>

          <div style={{ minWidth: 280 }}>
            <div className="card">
              <h3>Targets</h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  placeholder="btc,eth,sol"
                  className="mono"
                  style={{
                    flex: "1 1 220px",
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.22)",
                    color: "var(--txt)",
                    outline: "none"
                  }}
                />
                <button className="btn" onClick={startAuto}>Run Feed</button>
                <button className="btn" onClick={stopAuto}>Pause</button>
              </div>
              <p className="small" style={{ marginTop: 10 }}>
                Symbols supported: btc, eth, sol, doge, ada (and more if CoinGecko maps them).
              </p>
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <h3>Telemetry KPIs</h3>
            <div className="kpis">
              <div className="kpi">
                <div className="label">Oracle Avg Score</div>
                <div className="value">{rows.length ? `${summary.avg}/100` : "—"}</div>
                <div className="small">Portfolio mood index</div>
              </div>
              <div className="kpi">
                <div className="label">Top Signal</div>
                <div className="value">{summary.best ? summary.best.symbol.toUpperCase() : "—"}</div>
                <div className="small">
                  {summary.best ? `${summary.best.score}/100 • ${summary.best.stance}` : "Waiting for data"}
                </div>
              </div>
              <div className="kpi">
                <div className="label">Risk Zone</div>
                <div className="value">{summary.worst ? summary.worst.symbol.toUpperCase() : "—"}</div>
                <div className="small">
                  {summary.worst ? `${summary.worst.score}/100 • ${summary.worst.stance}` : "Waiting for data"}
                </div>
              </div>
            </div>

            {!proActive && (
              <div style={{ marginTop: 12 }} className="small">
                <span className="pill warn">
                  Pro locks: extended commentary + stance logic detail + priority ranking.
                </span>{" "}
                <span className="pill">
                  Receiver: <span className="mono">{shortAddr(RECEIVING_WALLET)}</span>
                </span>
              </div>
            )}

            {txHash && (
              <div style={{ marginTop: 12 }} className="small">
                Tx submitted: <span className="mono">{txHash}</span>
              </div>
            )}

            {lastErr && (
              <div style={{ marginTop: 12 }} className="small">
                <span className="pill bad">Upstream hiccup</span>{" "}
                <span className="mono">{lastErr}</span>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Operator Notes</h3>
            <p className="small" style={{ marginTop: 0 }}>
              Practical playbook:
              <br />• Score ≥ 75: trend confirmation bias allowed.
              <br />• RSI too high? That’s **heat**, not safety.
              <br />• Volume ratio &gt; 1.2: attention spike.
            </p>
            <div className="small">
              {proActive ? (
                <span className="pill good">PRO: ACTIVE (24h)</span>
              ) : (
                <span className="pill warn">PRO: LOCKED</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Signal Board</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Price</th>
              <th>24h</th>
              <th>RSI14</th>
              <th>Vol Pop</th>
              <th>Score</th>
              <th>Stance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 800 }}>{r.symbol.toUpperCase()}</span>
                    <span className="small">{r.name}</span>
                  </div>
                </td>
                <td className="mono">${fmtMoney(r.price)}</td>
                <td className="mono" style={{ color: r.change24h >= 0 ? "var(--good)" : "var(--bad)" }}>
                  {r.change24h >= 0 ? "+" : ""}
                  {r.change24h.toFixed(2)}%
                </td>
                <td className="mono">{r.rsi14 == null ? "—" : r.rsi14.toFixed(1)}</td>
                <td className="mono">{r.volRatio.toFixed(2)}x</td>
                <td>
                  <span className={`pill ${r.tone}`}>
                    <span className={`dot ${toneDot(r.tone)}`} />
                    <span className="mono">{r.score}/100</span>
                  </span>
                </td>
                <td>
                  {proActive ? (
                    <span className={`pill ${r.tone}`}>{r.stance}</span>
                  ) : (
                    <span className="pill">LOCKED</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="small">
                  Loading scan… if this hangs, hit Refresh.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="footer">
          <span>Data: CoinGecko • Interval: 10s • Mode: No-Binance</span>
          <span className="mono">Receiver: {RECEIVING_WALLET}</span>
        </div>
      </div>
    </div>
  );
}