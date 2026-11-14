import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadSerif } from "@remotion/google-fonts/Newsreader";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";

export const serif = loadSerif("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
export const sans = loadSans("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

// Tradelock palette (web/app/globals.css, dark theme), warmed for video.
export const C = {
  bg: "#111417",
  card: "#1a1f24",
  rule: "#2b333b",
  ink: "#ece9e4",
  muted: "#8f98a1",
  accent: "#e0786e", // stamp red
  blue: "#7fa8e0", // form blue
  ok: "#7cc792",
  paper: "#f4f1ea",
  paperInk: "#1e2328",
  paperMuted: "#6b737b",
};

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0→1 over [start, start+len] with the house ease. */
export const prog = (f: number, start: number, len = 18) =>
  interpolate(f, [start, start + len], [0, 1], { ...clamp, easing: EASE });

/** Blur-in reveal used across the video (matches the reference's text treatment). */
export const reveal = (f: number, start: number, len = 18, dy = 14): React.CSSProperties => {
  const p = prog(f, start, len);
  return { opacity: p, filter: `blur(${(1 - p) * 10}px)`, translate: `0px ${(1 - p) * dy}px` };
};

const Glow: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 66%, rgba(224,120,110,0.17) 0%, rgba(224,120,110,0.06) 30%, rgba(17,20,23,0) 58%)`,
        scale: interpolate(f, [0, 300], [1, 1.06], clamp),
      }}
    />
  );
};

export const Scene: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const out = interpolate(f, [dur - 14, dur], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: sans, color: C.ink }}>
      <Glow />
      <div
        style={{
          position: "absolute",
          top: 54,
          width: "100%",
          textAlign: "center",
          fontFamily: mono,
          fontSize: 19,
          letterSpacing: "0.2em",
          color: C.accent,
        }}
      >
        TRADELOCK · DOCUMENTS AGAINST PAYMENT ON NEAR
      </div>
      <AbsoluteFill style={{ opacity: 1 - out, filter: `blur(${out * 10}px)` }}>{children}</AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: 42,
          width: "100%",
          textAlign: "center",
          fontFamily: mono,
          fontSize: 17,
          letterSpacing: "0.08em",
          color: C.muted,
          opacity: 0.8,
        }}
      >
        NEAR testnet · Sepolia · tUSD is a test token
      </div>
    </AbsoluteFill>
  );
};

type Seg = string | { a: string };

/** Two-line serif headline; words blur in one after another, accent words in stamp red. */
export const Headline: React.FC<{ lines: Seg[][]; sub?: string; start?: number }> = ({
  lines,
  sub,
  start = 6,
}) => {
  const f = useCurrentFrame();
  let i = 0;
  return (
    <div style={{ position: "absolute", top: 118, left: 80, right: 80, textAlign: "center" }}>
      <div style={{ fontFamily: serif, fontSize: 84, lineHeight: 1.08, fontWeight: 400, letterSpacing: "-0.01em" }}>
        {lines.map((line, li) => (
          <div key={li}>
            {line.flatMap((seg, si) => {
              const accent = typeof seg !== "string";
              const text = typeof seg === "string" ? seg : seg.a;
              return text
                .split(/(\s+)/)
                .filter((w) => w.length)
                .map((w, wi) => {
                  if (/^\s+$/.test(w)) return <span key={`${si}-${wi}`}> </span>;
                  const s = start + i++ * 3;
                  return (
                    <span
                      key={`${si}-${wi}`}
                      style={{ display: "inline-block", color: accent ? C.accent : C.ink, ...reveal(f, s, 16, 10) }}
                    >
                      {w}
                    </span>
                  );
                });
            })}
          </div>
        ))}
      </div>
      {sub ? (
        <div
          style={{
            marginTop: 26,
            fontSize: 31,
            lineHeight: 1.35,
            color: C.muted,
            ...reveal(f, start + i * 3 + 6, 18, 8),
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};

/** The area under the headline where each scene's card lives (1080 × 520, top 452). */
export const Stage: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 452 }) => (
  <div style={{ position: "absolute", top, left: 0, width: 1080, height: 520 }}>{children}</div>
);

export const Card: React.FC<{ style?: React.CSSProperties; paper?: boolean; children: React.ReactNode }> = ({
  style,
  paper,
  children,
}) => (
  <div
    style={{
      background: paper ? C.paper : C.card,
      color: paper ? C.paperInk : C.ink,
      border: paper ? "none" : `1px solid ${C.rule}`,
      borderRadius: 18,
      boxShadow: paper ? "0 24px 60px rgba(0,0,0,0.45)" : "0 18px 50px rgba(0,0,0,0.35)",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Label: React.FC<{ color?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({
  color = C.muted,
  children,
  style,
}) => (
  <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: "0.16em", color, ...style }}>{children}</div>
);

export const Check: React.FC<{ p: number; size?: number; color?: string }> = ({ p, size = 34, color = C.ok }) => (
  <svg width={size} height={size} viewBox="0 0 34 34" style={{ flexShrink: 0 }}>
    <circle cx="17" cy="17" r="15" fill={p > 0 ? color : "none"} stroke={p > 0 ? color : C.rule} strokeWidth="2" opacity={p > 0 ? 0.18 + 0.82 * p : 1} />
    <path
      d="M10 17.5 L15 22.5 L24.5 12"
      fill="none"
      stroke={C.bg}
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - p}
    />
  </svg>
);

/** Rubber-stamp seal, as on the deal page. */
export const Stamp: React.FC<{ text: string; p: number; color?: string; size?: number }> = ({
  text,
  p,
  color = C.accent,
  size = 92,
}) => (
  <div
    style={{
      display: "inline-block",
      fontFamily: mono,
      fontWeight: 500,
      fontSize: size,
      letterSpacing: "0.12em",
      color,
      border: `7px solid ${color}`,
      borderRadius: 14,
      padding: "6px 28px",
      rotate: "-8deg",
      opacity: p,
      scale: interpolate(p, [0, 1], [1.7, 1]),
      background: "rgba(17,20,23,0.82)",
    }}
  >
    {text}
  </div>
);

export const Logo: React.FC<{ size?: number }> = ({ size = 170 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.23,
      background: C.paper,
      boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 112 112">
      <circle cx="42" cy="56" r="27" fill="none" stroke={C.paperInk} strokeWidth="11" />
      <circle cx="70" cy="56" r="27" fill="none" stroke="#a8322a" strokeWidth="11" />
      <path d="M42 29 A27 27 0 0 1 64.5 41" fill="none" stroke={C.paperInk} strokeWidth="11" />
    </svg>
  </div>
);
