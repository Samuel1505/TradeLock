import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, serif } from "../ui";

export const W = 1920;
export const H = 1080;
export const LEAD = 6; // frames of silence before each VO clip
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Spring 0→1 starting at frame `at`. Snappy for UI, softer for big type. */
export const useSpring = (at: number, kind: "ui" | "soft" | "heavy" = "ui") => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const config =
    kind === "ui" ? { damping: 22, stiffness: 220, mass: 0.6 } : kind === "soft" ? { damping: 26, stiffness: 120 } : { damping: 30, stiffness: 80, mass: 1.2 };
  return spring({ frame: f - at, fps, config });
};

export const enter = (p: number, dy = 40): React.CSSProperties => ({
  opacity: interpolate(p, [0, 0.6], [0, 1], clamp),
  transform: `translateY(${(1 - p) * dy}px)`,
});

/** Scene shell: background, headline slot, exit fade. */
export const Shell: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const out = interpolate(f, [dur - 8, dur], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: sans, color: C.ink }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(127,168,224,0.07), rgba(17,20,23,0) 70%)",
        }}
      />
      <AbsoluteFill style={{ opacity: out }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

type Seg = string | { a: string; c?: string };

/** Top-left serif headline; words spring up one after another. */
export const Title: React.FC<{ lines: Seg[][]; at?: number; size?: number; top?: number; center?: boolean }> = ({
  lines,
  at = 4,
  size = 76,
  top = 84,
  center,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  let i = 0;
  return (
    <div style={{ position: "absolute", top, left: 120, right: 120, textAlign: center ? "center" : "left" }}>
      <div style={{ fontFamily: serif, fontSize: size, lineHeight: 1.06, letterSpacing: "-0.015em" }}>
        {lines.map((line, li) => (
          <div key={li}>
            {line.flatMap((seg, si) => {
              const text = typeof seg === "string" ? seg : seg.a;
              const color = typeof seg === "string" ? C.ink : seg.c ?? C.accent;
              const italic = typeof seg !== "string";
              return text
                .split(/(\s+)/)
                .filter(Boolean)
                .map((w, wi) => {
                  if (/^\s+$/.test(w)) return <span key={`${si}-${wi}`}> </span>;
                  const p = spring({ frame: f - (at + i++ * 2.5), fps, config: { damping: 20, stiffness: 180, mass: 0.7 } });
                  return (
                    <span
                      key={`${si}-${wi}`}
                      style={{ display: "inline-block", color, fontStyle: italic ? "italic" : "normal", paddingRight: italic ? "0.06em" : 0, ...enter(p, 28) }}
                    >
                      {w}
                    </span>
                  );
                });
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Small mono tag, e.g. "DIAGRAM" or "DEAL 4 · LIVE PAGE". */
export const Tag: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({
  children,
  color = C.muted,
  style,
}) => (
  <div
    style={{
      fontFamily: mono,
      fontSize: 20,
      letterSpacing: "0.14em",
      color,
      textTransform: "uppercase",
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * A screenshot of the live web app inside a browser frame. `crop` is the visible region in
 * screenshot pixels (3200-wide, 2x); it can animate between two crops for a push-in.
 */
export const Browser: React.FC<{
  src: string;
  url: string;
  w: number;
  h: number;
  crop: [number, number, number]; // x, y, width (image px)
  crop2?: [number, number, number];
  p2?: number; // 0→1 progress from crop to crop2
  style?: React.CSSProperties;
  overlay?: (scale: number, crop: [number, number, number]) => React.ReactNode;
}> = ({ src, url, w, h, crop, crop2, p2 = 0, style, overlay }) => {
  const c = (crop2 ? crop.map((v, i) => v + (crop2[i] - v) * p2) : crop) as [number, number, number];
  const bar = 44;
  const s = w / c[2];
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        height: h + bar,
        borderRadius: 16,
        overflow: "hidden",
        background: "#0d1013",
        border: `1px solid ${C.rule}`,
        boxShadow: "0 40px 100px rgba(0,0,0,0.55)",
        ...style,
      }}
    >
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: "#1b2026" }}>
        {["#e0786e", "#e3b95f", "#7cc792"].map((col) => (
          <div key={col} style={{ width: 12, height: 12, borderRadius: 6, background: col, opacity: 0.8 }} />
        ))}
        <div
          style={{
            marginLeft: 14,
            flex: 1,
            height: 26,
            borderRadius: 7,
            background: "#111417",
            fontFamily: mono,
            fontSize: 15,
            color: C.muted,
            display: "flex",
            alignItems: "center",
            paddingLeft: 12,
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
        <Img
          src={staticFile(src)}
          style={{ position: "absolute", left: -c[0] * s, top: -c[1] * s, width: 3200 * s }}
        />
        {overlay ? <div style={{ position: "absolute", inset: 0 }}>{overlay(s, c)}</div> : null}
      </div>
    </div>
  );
};

/** Highlight ring around a region given in screenshot px, inside a Browser. */
export const Ring: React.FC<{ rect: [number, number, number, number]; crop: [number, number, number]; scale: number; p: number; color?: string }> = ({
  rect,
  crop,
  scale,
  p,
  color = C.accent,
}) => (
  <div
    style={{
      position: "absolute",
      left: (rect[0] - crop[0]) * scale - 8,
      top: (rect[1] - crop[1]) * scale - 8,
      width: rect[2] * scale + 16,
      height: rect[3] * scale + 16,
      border: `4px solid ${color}`,
      borderRadius: 14,
      opacity: p,
      transform: `scale(${1.15 - 0.15 * p})`,
      boxShadow: `0 0 0 9999px rgba(10,12,14,${0.45 * p})`,
    }}
  />
);

export type TermLine = { at: number; text: string; kind?: "cmd" | "step" | "ok" | "state" | "dim" };

/** Terminal panel replaying real runner output; each line types in at its frame. */
export const Terminal: React.FC<{ lines: TermLine[]; w: number; h: number; style?: React.CSSProperties; title?: string }> = ({
  lines,
  w,
  h,
  style,
  title = "pnpm demo settle --deal 4 --step",
}) => {
  const f = useCurrentFrame();
  const color = { cmd: C.ink, step: C.blue, ok: C.ok, state: "#e3b95f", dim: C.muted } as const;
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        height: h,
        borderRadius: 16,
        background: "#0b0d10",
        border: `1px solid ${C.rule}`,
        boxShadow: "0 40px 100px rgba(0,0,0,0.55)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 18px", background: "#1b2026", gap: 9 }}>
        {["#e0786e", "#e3b95f", "#7cc792"].map((col) => (
          <div key={col} style={{ width: 12, height: 12, borderRadius: 6, background: col, opacity: 0.8 }} />
        ))}
        <div style={{ marginLeft: 14, fontFamily: mono, fontSize: 15, color: C.muted }}>{title}</div>
      </div>
      <div style={{ padding: "22px 26px", fontFamily: mono, fontSize: 21, lineHeight: 1.6 }}>
        {lines.map((l, i) => {
          if (f < l.at) return null;
          const n = Math.min(l.text.length, Math.floor((f - l.at) * 3.2));
          const k = l.kind ?? "dim";
          return (
            <div key={i} style={{ color: color[k], whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}>
              {k === "cmd" ? <span style={{ color: C.ok }}>$ </span> : null}
              {l.text.slice(0, n)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Karaoke caption line at the bottom, as in the reference: spoken words light up, key words in colour. */
export type Word = { w: string; s: number; e: number };
const KEY: Record<string, string> = {};
for (const k of "trust paid goods slow expensive forty-one percent turned down tradelock exchanged contract no bank needed near intents rules title cargo sepolia chain signatures accept accept. both legs mpc buyer. refuse back two three decide real yourself".split(" "))
  KEY[k] = C.accent;
for (const k of "near intents chain signatures mpc sepolia".split(" ")) KEY[k] = C.blue;
for (const k of "real yourself both decide".split(" ")) KEY[k] = C.ok;

const chunk = (words: Word[]) => {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    const end = /[.?!:]$/.test(w.w) || (/,$/.test(w.w) && cur.length >= 6) || cur.length >= 11;
    if (end) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
};

export const Captions: React.FC<{ words: Word[] }> = ({ words }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (f - LEAD) / fps;
  if (t < -0.1) return null;
  const chunks = chunk(words);
  let cur = chunks[0];
  for (const c of chunks) if (c[0].s - 0.05 <= t) cur = c;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 54,
        left: 160,
        right: 160,
        textAlign: "center",
        fontFamily: sans,
        fontWeight: 600,
        fontSize: 36,
        lineHeight: 1.3,
      }}
    >
      {cur.map((w, i) => {
        const spoken = w.s <= t;
        const k = w.w.toLowerCase().replace(/[^a-z0-9-]/g, "");
        const col = KEY[k];
        return (
          <span key={i} style={{ color: spoken ? col ?? C.ink : "rgba(236,233,228,0.32)", transition: "none" }}>
            {w.w}{" "}
          </span>
        );
      })}
    </div>
  );
};

export { C, mono, sans, serif };
