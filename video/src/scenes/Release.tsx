import React from "react";
import { useCurrentFrame } from "remotion";
import { D } from "../data";
import { C, Card, Check, Headline, Label, Scene, Stage, Stamp, mono, prog, reveal, serif } from "../ui";

export const RELEASE_DUR = 360;
export const DISPUTE_DUR = 300;

const Leg: React.FC<{ tag: string; color: string; main: string; detail: string; at: number }> = ({ tag, color, main, detail, at }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ ...reveal(f, at - 22) }}>
      <Card style={{ width: 840, padding: "22px 30px", display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ width: 92 }}>
          <Label color={color}>{tag}</Label>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 30 }}>{main}</div>
          <div style={{ fontFamily: mono, fontSize: 19, color: C.muted, marginTop: 4 }}>{detail}</div>
        </div>
        <Check p={prog(f, at, 14)} size={40} />
      </Card>
    </div>
  );
};

export const Release: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Scene dur={RELEASE_DUR}>
      <Headline
        lines={[["Cash to the supplier."], ["Title to the ", { a: "buyer." }]]}
        sub="The contract builds the Sepolia transaction itself. NEAR's MPC network signs it."
      />
      <Stage top={448}>
        <div style={{ position: "absolute", left: 120, top: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <Leg tag="CASH" color={C.blue} at={60} main={`${D.amount} → supplier`} detail={`paid out by the Verifier · testnet tx ${D.acceptTx}`} />
          <div style={{ ...reveal(f, 84), display: "flex", justifyContent: "center", gap: 14, alignItems: "center", fontFamily: mono, fontSize: 20, color: C.muted }}>
            <span style={{ color: C.blue }}>{D.mpc}</span> signs · contract ecrecover = deal address
          </div>
          <Leg tag="TITLE" color={C.accent} at={124} main={`eBL → buyer ${D.buyerEvm}`} detail={`MPC-signed transferOwners · Sepolia tx ${D.titleTx}`} />
        </div>
        <div style={{ position: "absolute", top: 330, width: 1080, textAlign: "center" }}>
          <Stamp text="RELEASED" p={prog(f, 168, 12)} />
        </div>
      </Stage>
    </Scene>
  );
};

const Vote: React.FC<{ role: string; decision: "Release" | "Refund"; at: number }> = ({ role, decision, at }) => {
  const f = useCurrentFrame();
  const color = decision === "Release" ? C.ok : C.accent;
  return (
    <div style={{ ...reveal(f, at, 16, 18) }}>
      <Card style={{ width: 250, padding: "22px 26px", textAlign: "center", borderColor: prog(f, at, 16) > 0.5 ? color : C.rule }}>
        <Label>{role}</Label>
        <div style={{ fontFamily: serif, fontSize: 52, color, marginTop: 8 }}>{decision}</div>
      </Card>
    </div>
  );
};

export const Dispute: React.FC = () => {
  const f = useCurrentFrame();
  const seg = (at: number) => prog(f, at, 14);
  const reached = f >= 118;
  return (
    <Scene dur={DISPUTE_DUR}>
      <Headline
        lines={[["Disagree?"], ["Two of three ", { a: "decide." }]]}
        sub="Buyer, supplier and arbiter each get one vote. The arbiter alone can never move funds."
      />
      <Stage top={440}>
        <div style={{ position: "absolute", left: 105, top: 0, display: "flex", gap: 30 }}>
          <Vote role="BUYER" decision="Refund" at={44} />
          <Vote role="SUPPLIER" decision="Release" at={74} />
          <Vote role="ARBITER" decision="Release" at={104} />
        </div>
        <div style={{ position: "absolute", left: 160, top: 200, width: 760, ...reveal(f, 60) }}>
          <div style={{ display: "flex", gap: 10 }}>
            {[seg(88), seg(118)].map((p, i) => (
              <div key={i} style={{ flex: 1, height: 12, borderRadius: 6, background: C.rule }}>
                <div style={{ height: 12, borderRadius: 6, background: C.ok, width: `${p * 100}%` }} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, textAlign: "center", fontFamily: mono, fontSize: 22, color: reached ? C.ok : C.muted }}>
            {reached ? "2 of 3 Release → settles to the supplier and buyer" : "waiting for 2 matching votes"}
          </div>
        </div>
        <div style={{ position: "absolute", top: 320, width: 1080, textAlign: "center", fontSize: 27, color: C.muted, lineHeight: 1.5, ...reveal(f, 150) }}>
          Buyer refuses the documents? <span style={{ color: C.ink }}>Cash and title both go back.</span>
          <div style={{ fontFamily: mono, fontSize: 19, marginTop: 6 }}>Deal 3: settled by vote · Deal 1: refunded · both on testnet</div>
        </div>
      </Stage>
    </Scene>
  );
};
