import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { D } from "../data";
import { C, Card, Headline, Label, Scene, Stage, mono, prog, reveal, serif } from "../ui";

export const INTRO_DUR = 210;
export const CASH_DUR = 270;

export const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const l = prog(f, 66, 30);
  const r = prog(f, 72, 30);
  return (
    <Scene dur={INTRO_DUR}>
      <Headline
        lines={[["Goods for money,"], ["released ", { a: "together." }]]}
        sub="Tradelock holds both sides of a trade in one NEAR contract. No bank in the middle."
      />
      <Stage>
        <svg width={1080} height={520} style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M260 172 C 260 260, 470 250, 470 318" fill="none" stroke={C.blue} strokeWidth="3" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - l} />
          <path d="M820 172 C 820 260, 610 250, 610 318" fill="none" stroke={C.accent} strokeWidth="3" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - r} />
        </svg>
        <div style={{ position: "absolute", left: 80, top: 10, ...reveal(f, 36) }}>
          <Card style={{ width: 360, padding: "24px 28px" }}>
            <Label color={C.blue}>CASH LEG</Label>
            <div style={{ fontFamily: serif, fontSize: 44, marginTop: 8 }}>Stablecoins</div>
            <div style={{ fontSize: 24, color: C.muted, marginTop: 4 }}>held via NEAR Intents</div>
          </Card>
        </div>
        <div style={{ position: "absolute", right: 80, top: 10, ...reveal(f, 44) }}>
          <Card style={{ width: 360, padding: "24px 28px" }}>
            <Label color={C.accent}>TITLE LEG</Label>
            <div style={{ fontFamily: serif, fontSize: 44, marginTop: 8 }}>Bill of lading</div>
            <div style={{ fontSize: 24, color: C.muted, marginTop: 4 }}>TradeTrust eBL on Sepolia</div>
          </Card>
        </div>
        <div style={{ position: "absolute", left: 340, top: 318, ...reveal(f, 96) }}>
          <Card paper style={{ width: 400, padding: "22px 28px", textAlign: "center" }}>
            <Label color={C.paperMuted}>ONE NEAR CONTRACT</Label>
            <div style={{ fontFamily: mono, fontSize: 32, marginTop: 8, fontWeight: 500 }}>tradelock</div>
          </Card>
        </div>
      </Stage>
    </Scene>
  );
};

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderTop: "1px solid #ddd8cd", fontSize: 26 }}>
    <span style={{ color: C.paperMuted }}>{k}</span>
    <span style={{ fontFamily: mono, fontSize: 24 }}>{v}</span>
  </div>
);

export const Cash: React.FC = () => {
  const f = useCurrentFrame();
  const coin = prog(f, 70, 32);
  const funded = f >= 102;
  const pop = prog(f, 102, 14);
  return (
    <Scene dur={CASH_DUR}>
      <Headline
        lines={[["The buyer pays in."], ["The contract ", { a: "holds it." }]]}
        sub="Stablecoins move into the deal through NEAR Intents. Nobody can spend them alone."
      />
      <Stage>
        <div style={{ position: "absolute", left: 200, top: 0, ...reveal(f, 36) }}>
          <Card paper style={{ width: 680, padding: "24px 34px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Label color={C.paperMuted}>DEAL 0</Label>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 19,
                  letterSpacing: "0.14em",
                  padding: "6px 14px",
                  borderRadius: 8,
                  color: funded ? "#fff" : C.paperMuted,
                  background: funded ? "#1f4e8c" : "#e6e1d6",
                  scale: funded ? interpolate(pop, [0, 1], [1.25, 1]) : 1,
                }}
              >
                {funded ? "FUNDED" : "CREATED"}
              </div>
            </div>
            <Row k="Buyer" v={D.buyer} />
            <Row k="Supplier" v={D.supplier} />
            <Row k="Amount" v={D.amount} />
            <Row k="Held by" v={funded ? D.contract : "—"} />
          </Card>
        </div>
        <div
          style={{
            position: "absolute",
            left: interpolate(coin, [0, 1], [-120, 610]),
            top: interpolate(coin, [0, 0.5, 1], [190, 120, 250]),
            width: 96,
            height: 96,
            borderRadius: 48,
            background: C.blue,
            color: C.bg,
            fontFamily: mono,
            fontWeight: 500,
            fontSize: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: f < 70 ? 0 : 1 - prog(f, 98, 8),
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
          }}
        >
          tUSD
        </div>
        <div style={{ position: "absolute", top: 400, width: 1080, textAlign: "center", fontFamily: mono, fontSize: 21, color: C.muted, ...reveal(f, 116) }}>
          mt_transfer_call → mt_on_transfer · testnet tx {D.fundTx}
        </div>
      </Stage>
    </Scene>
  );
};
