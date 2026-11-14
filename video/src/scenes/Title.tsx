import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { D } from "../data";
import { C, Card, Check, Headline, Label, Scene, Stage, mono, prog, reveal } from "../ui";

export const TITLE_DUR = 300;
export const CHECK_DUR = 270;

const Pill: React.FC<{ label: string; addr: string; color: string; note: string }> = ({ label, addr, color, note }) => (
  <Card style={{ width: 330, padding: "16px 22px" }}>
    <Label color={color}>{label}</Label>
    <div style={{ fontFamily: mono, fontSize: 28, marginTop: 6 }}>{addr}</div>
    <div style={{ fontSize: 19, color: C.muted, marginTop: 2 }}>{note}</div>
  </Card>
);

const Ebl: React.FC = () => (
  <Card paper style={{ width: 150, height: 180, padding: "14px 14px" }}>
    <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", color: C.paperMuted, lineHeight: 1.4 }}>
      ELECTRONIC
      <br />
      BILL OF LADING
    </div>
    {[100, 70, 110, 60].map((w, i) => (
      <div key={i} style={{ height: 7, width: w, background: "#d9d3c6", borderRadius: 4, marginTop: 12 }} />
    ))}
    <div style={{ position: "absolute", right: 14, bottom: 14, width: 34, height: 34, borderRadius: 17, border: "3px solid #a8322a", opacity: 0.85 }} />
  </Card>
);

const EscrowRow: React.FC<{ k: string; switched: boolean; p: number }> = ({ k, switched, p }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 0", fontSize: 26 }}>
    <span style={{ fontFamily: mono, color: C.muted, width: 230 }}>{k}()</span>
    <span style={{ fontFamily: mono, flex: 1, color: switched ? C.ink : C.muted }}>{switched ? D.dealAddr : D.supplierEvm}</span>
    <Check p={p} />
  </div>
);

export const TitleLock: React.FC = () => {
  const f = useCurrentFrame();
  const move = prog(f, 80, 50);
  const switched = f >= 130;
  return (
    <Scene dur={TITLE_DUR}>
      <Headline
        lines={[["The supplier hands"], ["over the ", { a: "title." }]]}
        sub="The eBL moves to an address only the contract controls, through NEAR Chain Signatures."
      />
      <Stage top={440}>
        <div style={{ position: "absolute", left: 70, top: 0, ...reveal(f, 36) }}>
          <Pill label="SUPPLIER" addr={D.supplierEvm} color={C.accent} note="Sepolia wallet" />
        </div>
        <div style={{ position: "absolute", right: 70, top: 0, ...reveal(f, 44) }}>
          <Pill label="DEAL ADDRESS" addr={D.dealAddr} color={C.blue} note="signed only by NEAR MPC" />
        </div>
        <div
          style={{
            position: "absolute",
            left: interpolate(move, [0, 1], [160, 770]),
            top: 128,
            rotate: `${interpolate(move, [0, 0.5, 1], [-4, 3, 0])}deg`,
            ...reveal(f, 58),
          }}
        >
          <Ebl />
        </div>
        <div style={{ position: "absolute", left: 160, top: 326, ...reveal(f, 70) }}>
          <Card style={{ width: 760, padding: "14px 30px 16px" }}>
            <Label color={C.muted}>TITLEESCROW · SEPOLIA</Label>
            <EscrowRow k="holder" switched={switched} p={prog(f, 136, 14)} />
            <EscrowRow k="beneficiary" switched={switched} p={prog(f, 146, 14)} />
            <div style={{ fontFamily: mono, fontSize: 19, color: C.muted, marginTop: 4, ...reveal(f, 160, 18, 4) }}>
              transferOwners(deal, deal) · Sepolia tx {D.handOverTx}
            </div>
          </Card>
        </div>
      </Stage>
    </Scene>
  );
};

const Item: React.FC<{ text: string; detail: string; at: number }> = ({ text, detail, at }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "13px 0", borderTop: `1px solid ${C.rule}`, ...reveal(f, at - 10, 14, 6) }}>
      <Check p={prog(f, at, 14)} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 28 }}>{text}</div>
        <div style={{ fontFamily: mono, fontSize: 19, color: C.muted, marginTop: 2 }}>{detail}</div>
      </div>
    </div>
  );
};

export const CheckDocs: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Scene dur={CHECK_DUR}>
      <Headline
        lines={[["The buyer checks."], ["Then ", { a: "pays." }]]}
        sub="Documents against payment, without the bank: title is confirmed before any money moves."
      />
      <Stage top={440}>
        <div style={{ position: "absolute", left: 160, top: 0, ...reveal(f, 36) }}>
          <Card style={{ width: 760, padding: "20px 32px 8px" }}>
            <Label color={C.accent} style={{ marginBottom: 10 }}>
              BEFORE PAYMENT IS RELEASED
            </Label>
            <Item at={56} text="Cash locked in the deal" detail={`${D.amount} · state Funded`} />
            <Item at={78} text="Holder = deal address" detail={`checked on Sepolia · block ${D.heldBlock}`} />
            <Item at={100} text="Beneficiary = deal address" detail="confirm_title_held · state TitleHeld" />
            <Item at={122} text="Buyer accepts the documents" detail={`accept_documents · testnet tx ${D.acceptTx}`} />
          </Card>
        </div>
      </Stage>
    </Scene>
  );
};
