import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { D } from "../data";
import { C, Card, Headline, Label, Logo, Scene, Stage, mono, prog, reveal, serif } from "../ui";

export const PROOF_DUR = 270;
export const END_DUR = 210;

const DEALS = [
  { id: "0", what: "Paid against title", seal: "RELEASED", color: C.ok },
  { id: "1", what: "Documents refused, both legs returned", seal: "RETURNED", color: C.blue },
  { id: "2", what: "Escrow-only, no bill of lading", seal: "RELEASED", color: C.ok },
  { id: "3", what: "Disputed, settled 2-of-3", seal: "RELEASED", color: C.ok },
];

export const Proof: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Scene dur={PROOF_DUR}>
      <Headline
        lines={[["Four real deals."], ["All ", { a: "on-chain." }]]}
        sub="Every step links to NEAR and Sepolia explorers. Check the title yourself."
      />
      <Stage top={440}>
        <div style={{ position: "absolute", left: 120, top: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {DEALS.map((d, i) => (
            <div key={d.id} style={reveal(f, 36 + i * 14, 16, 10)}>
              <Card style={{ width: 840, padding: "16px 28px", display: "flex", alignItems: "center", gap: 24 }}>
                <Label style={{ width: 100 }}>DEAL {d.id}</Label>
                <div style={{ flex: 1, fontSize: 27 }}>{d.what}</div>
                <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: "0.14em", color: d.color, border: `2px solid ${d.color}`, borderRadius: 8, padding: "4px 12px" }}>
                  {d.seal}
                </div>
              </Card>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", top: 400, width: 1080, textAlign: "center", ...reveal(f, 120) }}>
          <span style={{ fontFamily: mono, fontSize: 22, color: C.ok, background: "rgba(124,199,146,0.12)", border: "1px solid rgba(124,199,146,0.35)", borderRadius: 999, padding: "8px 20px" }}>
            TitleEscrow.holder() → {D.buyerEvm}
          </span>
        </div>
      </Stage>
    </Scene>
  );
};

export const End: React.FC = () => {
  const f = useCurrentFrame();
  const lp = prog(f, 8, 22);
  return (
    <Scene dur={END_DUR}>
      <div style={{ position: "absolute", top: 250, width: 1080, display: "flex", justifyContent: "center", opacity: lp, scale: interpolate(lp, [0, 1], [0.85, 1]) }}>
        <Logo />
      </div>
      <div style={{ position: "absolute", top: 452, width: 1080, textAlign: "center", fontFamily: serif, fontSize: 100, ...reveal(f, 24) }}>
        Tradelock
      </div>
      <div style={{ position: "absolute", top: 590, left: 100, right: 100, textAlign: "center", fontFamily: serif, fontSize: 46, lineHeight: 1.25, ...reveal(f, 44) }}>
        The buyer only gets the goods
        <br />
        when the seller gets <span style={{ color: C.accent }}>paid.</span>
      </div>
      <div style={{ position: "absolute", top: 760, width: 1080, textAlign: "center", ...reveal(f, 70) }}>
        <Label>NO BANK NEEDED · BUILT AT NEAR HACKATHON</Label>
        <div style={{ fontSize: 22, color: C.muted, marginTop: 12 }}>NEAR Intents · Chain Signatures · TradeTrust eBL</div>
      </div>
    </Scene>
  );
};

