import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, Card, Headline, Label, Scene, Stage, mono, prog, reveal, serif } from "../ui";

export const HOOK_DUR = 210;
export const BANKS_DUR = 210;

const Role: React.FC<{ role: string; verb: string; holds: string; color: string }> = ({ role, verb, holds, color }) => (
  <Card style={{ width: 320, padding: "30px 32px" }}>
    <Label color={color}>{role}</Label>
    <div style={{ fontFamily: serif, fontSize: 58, marginTop: 10 }}>{verb}</div>
    <div style={{ fontSize: 26, color: C.muted, marginTop: 6 }}>{holds}</div>
  </Card>
);

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  // Both sides inch forward, then pull back: nobody goes first.
  const nudge = interpolate(f, [70, 84, 100, 128, 142, 158], [0, 34, 0, 0, 34, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const q = prog(f, 60, 16);
  return (
    <Scene dur={HOOK_DUR}>
      <Headline
        lines={[["Neither side"], ["wants to go ", { a: "first." }]]}
        sub="The buyer won't pay before shipping. The supplier won't ship before payment."
      />
      <Stage>
        <div style={{ position: "absolute", left: 90, top: 60, ...reveal(f, 34), translate: `${nudge}px 0px` }}>
          <Role role="BUYER" verb="Pays" holds="stablecoins" color={C.blue} />
        </div>
        <div style={{ position: "absolute", right: 90, top: 60, ...reveal(f, 42), translate: `${-nudge}px 0px` }}>
          <Role role="SUPPLIER" verb="Ships" holds="bill of lading" color={C.accent} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 490,
            top: 128,
            width: 100,
            height: 100,
            borderRadius: 50,
            border: `2px solid ${C.accent}`,
            color: C.accent,
            fontFamily: serif,
            fontSize: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: q,
            scale: interpolate(q, [0, 1], [0.6, 1]) * (1 + 0.04 * Math.sin(f / 6)),
          }}
        >
          ?
        </div>
      </Stage>
    </Scene>
  );
};

const Stat: React.FC<{ value: string; label: string; fill?: number; start: number }> = ({ value, label, fill, start }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ width: 400, ...reveal(f, start) }}>
      <div style={{ fontFamily: serif, fontSize: 124, color: C.accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 28, color: C.ink, marginTop: 14, lineHeight: 1.3 }}>{label}</div>
      {fill !== undefined ? (
        <div style={{ marginTop: 22, height: 10, borderRadius: 5, background: C.rule, width: 340 }}>
          <div style={{ height: 10, borderRadius: 5, background: C.accent, width: 340 * fill }} />
        </div>
      ) : null}
    </div>
  );
};

export const Banks: React.FC = () => {
  const f = useCurrentFrame();
  const pct = interpolate(f, [44, 92], [0, 41], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const gap = interpolate(f, [56, 104], [0, 2.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene dur={BANKS_DUR}>
      <Headline
        lines={[["Banks solve this."], ["Slowly. Often ", { a: "not for you." }]]}
        sub="Letters of credit and documentary collections are slow, costly, and often refused to small firms."
      />
      <Stage>
        <div style={{ position: "absolute", left: 110, top: 40, display: "flex", gap: 60 }}>
          <Stat start={38} value={`${Math.round(pct)}%`} label="of SME trade finance applications rejected" fill={pct / 100} />
          <Stat start={50} value={`$${gap.toFixed(1)}T`} label="global trade finance gap" />
        </div>
        <div
          style={{
            position: "absolute",
            left: 110,
            top: 330,
            fontFamily: mono,
            fontSize: 19,
            color: C.muted,
            letterSpacing: "0.08em",
            ...reveal(f, 100),
          }}
        >
          SOURCE: ASIAN DEVELOPMENT BANK
        </div>
      </Stage>
    </Scene>
  );
};
