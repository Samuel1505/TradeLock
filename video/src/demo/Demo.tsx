import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Logo, Stamp } from "../ui";
import caps from "./captions.json";
import { Browser, C, Captions, enter, LEAD, mono, Ring, serif, Shell, Tag, Terminal, Title, useSpring, type Word } from "./kit";

const FPS = 30;
const TAIL = 12; // frames after each VO clip
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const sec = (s: number) => Math.round(s * FPS) + LEAD; // VO-relative seconds → scene frame

// Real values: docs/DEPLOYMENTS.md "Demo run — Settled deal for the video" (deal 4).
const D4 = {
  supplierEvm: "0xefbC…8717",
  dealAddr: "0xdEFA…96eB",
  buyerEvm: "0x6a7d…46ed",
  escrow: "0xEDc8…7162",
  mint: "0xa381…0cdb",
  handOver: "0x3699…950e",
  heldBlock: "12132549",
  accept: "FUpQ8zv…BAwf",
  mpcSig: "GbYq7WG…cpgM",
  titleTx: "0x4317…f796",
};

// Screenshot regions (3200-wide, 2x): whole content column, cash+title cards, title card.
const FULL: [number, number, number] = [540, 200, 2120];
const TITLE_CARD: [number, number, number] = [1600, 640, 1300];

/* 1 — the first-mover problem (diagram) */
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const a = useSpring(8, "soft");
  const b = useSpring(16, "soft");
  const wob = (k: number) => Math.sin((f - k) / 5) * interpolate(f, [40, 60], [0, 14], clamp);
  const party = (label: string, sub: string, x: number, p: number) => (
    <div style={{ position: "absolute", left: x, top: 430, width: 420, ...enter(p) }}>
      <div style={{ background: C.card, border: `1px solid ${C.rule}`, borderRadius: 22, padding: "34px 38px" }}>
        <Tag>{label}</Tag>
        <div style={{ fontFamily: serif, fontSize: 64, marginTop: 8 }}>{sub}</div>
      </div>
    </div>
  );
  return (
    <>
      <Title lines={[["Neither side wants to go ", { a: "first." }]]} />
      {party("Buyer", "Pays", 260, a)}
      {party("Supplier", "Ships", 1240, b)}
      <div style={{ position: "absolute", left: 740, top: 470, width: 110, height: 110, borderRadius: 55, border: `8px solid #e3b95f`, color: "#e3b95f", fontFamily: serif, fontSize: 64, display: "flex", alignItems: "center", justifyContent: "center", transform: `translateX(${wob(0)}px)`, opacity: a }}>$</div>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ position: "absolute", left: 1070, top: 465, transform: `translateX(${-wob(3)}px)`, opacity: b }}><path d="M60 10 L108 34 L108 88 L60 112 L12 88 L12 34 Z M12 34 L60 58 L108 34 M60 58 L60 112" fill="none" stroke="#c9a27a" strokeWidth="7" strokeLinejoin="round" /></svg>
      <div style={{ position: "absolute", left: 905, top: 470, fontFamily: serif, fontSize: 80, color: C.accent, opacity: interpolate(f, [70, 85], [0, 1], clamp) }}>?</div>
      <Tag style={{ position: "absolute", right: 120, top: 100 }}>Diagram</Tag>
    </>
  );
};

/* 2 — banks: slow, costly, 41% rejected (diagram) */
const Banks: React.FC = () => {
  const f = useCurrentFrame();
  const p = useSpring(sec(5.6), "heavy");
  const n = Math.round(41 * p);
  const chip = (t: string, at: number, x: number) => {
    const q = useSpring(at);
    return (
      <div style={{ position: "absolute", left: x, top: 640, padding: "14px 26px", borderRadius: 40, border: `2px solid ${C.rule}`, fontSize: 32, ...enter(q, 20) }}>{t}</div>
    );
  };
  const gate = interpolate(f, [sec(1.2), sec(2.4)], [0, 1], { ...clamp });
  return (
    <>
      <Title lines={[["Banks hold the documents ", { a: "until you pay." }]]} />
      <svg width="420" height="380" viewBox="0 0 420 380" style={{ position: "absolute", left: 200, top: 300 }}>
        <path d="M30 120 L210 30 L390 120 Z" fill="none" stroke={C.muted} strokeWidth="8" strokeLinejoin="round" />
        {[80, 160, 250, 330].map((x) => (
          <rect key={x} x={x - 14} y={140} width={28} height={160 * gate} fill={C.muted} rx={4} />
        ))}
        <rect x={30} y={318} width={360} height={14} fill={C.muted} rx={4} />
      </svg>
      {chip("slow", sec(3.4), 200)}
      {chip("expensive", sec(4.2), 340)}
      <div style={{ position: "absolute", left: 900, top: 290, opacity: p }}>
        <div style={{ fontFamily: serif, fontSize: 300, lineHeight: 1, color: C.accent }}>{n}%</div>
        <div style={{ fontSize: 38, color: C.ink, marginTop: 10, maxWidth: 820 }}>of SME trade finance applications rejected</div>
        <Tag style={{ marginTop: 14 }}>Asian Development Bank</Tag>
      </div>
      <Tag style={{ position: "absolute", right: 120, top: 100 }}>Diagram</Tag>
    </>
  );
};

/* 3 — Tradelock */
const Intro: React.FC = () => {
  const l = useSpring(2, "heavy");
  const s = useSpring(sec(4.6), "ui");
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, top: 210, display: "flex", flexDirection: "column", alignItems: "center", ...enter(l, 60) }}>
        <Logo size={170} />
        <div style={{ fontFamily: serif, fontSize: 130, marginTop: 26 }}>Tradelock</div>
      </div>
      <Title top={620} center size={64} at={sec(1.3)} lines={[["Goods for money, ", { a: "exchanged" }, " by a contract."]]} />
      <div style={{ position: "absolute", right: 300, top: 250 }}>
        <Stamp text="NO BANK" p={s} size={60} />
      </div>
    </>
  );
};

/* 4 — create, accept, fund (deal 4, real runner output + live page) */
const Fund: React.FC = () => {
  const f = useCurrentFrame();
  const shot = f < sec(3.2) ? "shots/01.jpg" : f < sec(6.2) ? "shots/02.jpg" : "shots/03.jpg";
  const zoom = useSpring(sec(7), "soft");
  const ring = useSpring(sec(8.4));
  return (
    <>
      <Title size={64} lines={[["The buyer pays in. ", { a: "The contract holds it." }]]} />
      <Terminal
        w={760}
        h={560}
        style={{ left: 100, top: 300 }}
        lines={[
          { at: sec(0.2), text: "pnpm demo settle --step", kind: "cmd" },
          { at: sec(0.8), text: "▶ create_deal as buyer — deal 4", kind: "step" },
          { at: sec(1.8), text: "✓ BbuRatY…VFo6w", kind: "ok" },
          { at: sec(3.0), text: "▶ supplier accepts the deal", kind: "step" },
          { at: sec(3.8), text: "✓ CiszXL5…KdGy", kind: "ok" },
          { at: sec(5.0), text: "▶ buyer funds deal 4", kind: "step" },
          { at: sec(5.4), text: "  mt_transfer_call → mt_on_transfer", kind: "dim" },
          { at: sec(6.0), text: "✓ HMnS3tg…Qucmh", kind: "ok" },
          { at: sec(6.6), text: "[deal 4] state Funded", kind: "state" },
        ]}
      />
      <Browser
        src={shot}
        url="localhost:3000/deals/4"
        w={940}
        h={560}
        style={{ left: 900, top: 300 }}
        crop={FULL}
        crop2={[560, 560, 1500]}
        p2={zoom}
        overlay={(s, c) => <Ring rect={[591, 653, 861, 482]} crop={c} scale={s} p={ring} color={C.ok} />}
      />
      <Tag style={{ position: "absolute", left: 900, top: 920 }}>Deal 4 · live page, NEAR testnet</Tag>
    </>
  );
};

/* 5 — the main shot: title moves to the deal's own address */
const Handover: React.FC = () => {
  const f = useCurrentFrame();
  const a = useSpring(4, "soft");
  const b = useSpring(10, "soft");
  const move = useSpring(sec(3.0), "heavy");
  const flip = interpolate(f, [sec(5.5), sec(6.5)], [0, 1], clamp);
  const label = useSpring(sec(8.5));
  const wallet = (tag: string, addr: string, sub: string, x: number, p: number, hi?: boolean) => (
    <div style={{ position: "absolute", left: x, top: 290, width: 520, ...enter(p) }}>
      <div style={{ background: C.card, border: `2px solid ${hi ? C.blue : C.rule}`, borderRadius: 22, padding: "28px 34px" }}>
        <Tag color={hi ? C.blue : C.muted}>{tag}</Tag>
        <div style={{ fontFamily: mono, fontSize: 44, marginTop: 10 }}>{addr}</div>
        <div style={{ fontSize: 24, color: C.muted, marginTop: 6 }}>{sub}</div>
      </div>
    </div>
  );
  const docX = interpolate(move, [0, 1], [330, 1560]);
  const docY = interpolate(move, [0, 1], [450, 640]) - Math.sin(Math.PI * Math.min(1, move)) * 200;
  const scramble = (from: string, to: string, p: number) =>
    p <= 0 ? from : p >= 1 ? to : to.split("").map((ch, i) => (i / to.length < p ? ch : "0123456789abcdef"[(i * 7 + Math.floor(f)) % 16])).join("");
  return (
    <>
      <Title size={64} lines={[["The title moves to the deal's ", { a: "own address." }]]} />
      {wallet("Supplier · Sepolia wallet", D4.supplierEvm, "signs the hand-over", 160, a)}
      {wallet("Deal 4 address · Sepolia", D4.dealAddr, "an address only NEAR MPC can sign for", 1240, b, true)}
      <div
        style={{
          position: "absolute",
          left: docX,
          top: docY,
          width: 200,
          height: 250,
          background: C.paper,
          borderRadius: 12,
          boxShadow: "0 30px 70px rgba(0,0,0,0.5)",
          padding: 20,
          transform: `rotate(${-6 + 12 * move}deg)`,
          opacity: a,
        }}
      >
        <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.1em", color: C.paperMuted }}>ELECTRONIC BILL OF LADING</div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 9, background: "#d9d4ca", borderRadius: 4, marginTop: 16, width: `${90 - i * 12}%` }} />
        ))}
        <div style={{ position: "absolute", right: 18, bottom: 18, width: 44, height: 44, borderRadius: 22, border: `4px solid ${C.accent}` }} />
      </div>
      <div style={{ position: "absolute", left: 160, top: 640, width: 1200, background: C.card, border: `1px solid ${C.rule}`, borderRadius: 18, padding: "22px 32px", ...enter(b) }}>
        <Tag>TitleEscrow {D4.escrow} · read on Sepolia</Tag>
        {["holder()", "beneficiary()"].map((k) => (
          <div key={k} style={{ display: "flex", fontFamily: mono, fontSize: 32, marginTop: 12 }}>
            <div style={{ width: 300, color: C.muted }}>{k}</div>
            <div style={{ color: flip >= 1 ? C.blue : C.ink }}>{scramble(D4.supplierEvm, D4.dealAddr, flip)}</div>
            <div style={{ marginLeft: "auto", color: C.ok, opacity: flip >= 1 ? 1 : 0 }}>✓</div>
          </div>
        ))}
      </div>
      <Tag style={{ position: "absolute", left: 160, top: 900, ...enter(label, 10) }}>
        mint {D4.mint} · hand-over {D4.handOver} · Sepolia
      </Tag>
    </>
  );
};

/* 6 — buyer checks the title, accepts */
const Check: React.FC = () => {
  const zoom = useSpring(6, "soft");
  const ring = useSpring(sec(1.2));
  return (
    <>
      <Title size={64} lines={[["The buyer checks. ", { a: "Then accepts." }]]} />
      <Browser
        src="shots/06.jpg"
        url="localhost:3000/deals/4"
        w={1060}
        h={600}
        style={{ left: 100, top: 280 }}
        crop={FULL}
        crop2={TITLE_CARD}
        p2={zoom}
        overlay={(s, c) => <Ring rect={[1770, 1050, 460, 115]} crop={c} scale={s} p={ring} color={C.blue} />}
      />
      <Terminal
        w={620}
        h={360}
        style={{ left: 1200, top: 400 }}
        lines={[
          { at: sec(0.6), text: "▶ confirm_title_held", kind: "step" },
          { at: sec(1.2), text: `  Sepolia block ${D4.heldBlock}`, kind: "dim" },
          { at: sec(1.8), text: "✓ 4Fv4dYY…oBHRk", kind: "ok" },
          { at: sec(3.2), text: "▶ accept_documents", kind: "step" },
          { at: sec(3.9), text: `✓ ${D4.accept}`, kind: "ok" },
        ]}
      />
    </>
  );
};

/* 7 — both legs move */
const Release: React.FC = () => {
  const r1 = useSpring(sec(1.6));
  const r2 = useSpring(sec(4.6));
  const note = useSpring(sec(2.6));
  const stamp = useSpring(sec(7.6), "ui");
  const row = (leg: string, what: string, to: string, ev: string, p: number, top: number) => (
    <div style={{ position: "absolute", left: 160, right: 160, top, display: "flex", alignItems: "center", gap: 30, background: C.card, border: `1px solid ${C.rule}`, borderRadius: 20, padding: "26px 36px", ...enter(p) }}>
      <Tag style={{ width: 120 }}>{leg}</Tag>
      <div style={{ fontSize: 44 }}>{what}</div>
      <div style={{ fontSize: 44, color: C.muted }}>→</div>
      <div style={{ fontFamily: mono, fontSize: 36 }}>{to}</div>
      <div style={{ marginLeft: "auto", textAlign: "right" }}>
        <div style={{ color: C.ok, fontSize: 44 }}>✓</div>
        <div style={{ fontFamily: mono, fontSize: 18, color: C.muted }}>{ev}</div>
      </div>
    </div>
  );
  return (
    <>
      <Title size={64} lines={[["Both legs ", { a: "move." }]]} />
      {row("Cash", "1.00 tUSD", "supplier.samuelowen.testnet", `accept_documents ${D4.accept}`, r1, 300)}
      <div style={{ position: "absolute", left: 160, right: 160, top: 470, textAlign: "center", fontSize: 30, color: C.blue, ...enter(note, 10) }}>
        The contract already holds the title, so paying first is safe.
      </div>
      {row("Title", "eBL", `buyer ${D4.buyerEvm}`, `MPC ${D4.mpcSig} · Sepolia ${D4.titleTx}`, r2, 560)}
      <div style={{ position: "absolute", left: 0, right: 0, top: 780, textAlign: "center" }}>
        <Stamp text="RELEASED" p={stamp} size={72} />
      </div>
    </>
  );
};

/* 8 — refused documents (deal 1) and a 2-of-3 dispute (deal 3) */
const Paths: React.FC = () => {
  const a = useSpring(sec(0.2), "soft");
  const b = useSpring(sec(4.4), "soft");
  return (
    <>
      <Title size={64} lines={[["Wrong documents? ", { a: "Disagreement?" }]]} />
      <div style={{ ...enter(a) }}>
        <Browser src="shots/d1.jpg" url="localhost:3000/deals/1" w={820} h={470} style={{ left: 100, top: 290 }} crop={[560, 300, 1700]} />
        <Tag color={C.accent} style={{ position: "absolute", left: 100, top: 830 }}>Deal 1 · documents refused → cash and title back</Tag>
      </div>
      <div style={{ ...enter(b) }}>
        <Browser src="shots/d3.jpg" url="localhost:3000/deals/3" w={820} h={470} style={{ left: 1000, top: 290 }} crop={[560, 300, 1700]} />
        <Tag color={C.ok} style={{ position: "absolute", left: 1000, top: 830 }}>Deal 3 · votes Refund / Release / Release → 2-of-3</Tag>
      </div>
    </>
  );
};

/* 9 — every deal is real (deals 0–4, docs/DEPLOYMENTS.md) */
const DEALS: [string, string, string, string][] = [
  ["0", "Documents accepted, paid against title", "SETTLED", C.ok],
  ["1", "Documents refused, both legs returned", "REFUNDED", C.accent],
  ["2", "Escrow-only, no bill of lading", "SETTLED", C.ok],
  ["3", "Disputed, settled 2-of-3", "SETTLED", C.ok],
  ["4", "This video", "SETTLED", C.ok],
];
const DealRow: React.FC<{ i: number; id: string; what: string; state: string; col: string; me: boolean }> = ({ i, id, what, state, col, me }) => {
  const p = useSpring(6 + i * 7);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, padding: "22px 30px", marginBottom: 14, borderRadius: 16, background: C.card, border: `2px solid ${me ? C.blue : C.rule}`, ...enter(p, 24) }}>
      <div style={{ fontFamily: mono, fontSize: 22, color: C.muted, width: 110 }}>DEAL {id}</div>
      <div style={{ fontSize: 34, flex: 1 }}>{what}</div>
      <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: "0.12em", color: col, border: `2px solid ${col}`, borderRadius: 8, padding: "4px 12px" }}>{state}</div>
    </div>
  );
};

const Proof: React.FC = () => {
  const c = useSpring(sec(6.4));
  return (
    <>
      <Title size={64} lines={[["Every deal is ", { a: "real.", c: C.ok }]]} />
      <div style={{ position: "absolute", left: 120, top: 290, width: 1040 }}>
        {DEALS.map(([id, what, state, col], i) => (
          <DealRow key={id} i={i} id={id} what={what} state={state} col={col} me={id === "4"} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 1250, top: 320, width: 570, ...enter(c) }}>
        <Tag>Check deal 4 yourself</Tag>
        <div style={{ marginTop: 16, background: "#0b0d10", border: `1px solid ${C.rule}`, borderRadius: 14, padding: "22px 24px", fontFamily: mono, fontSize: 22, lineHeight: 1.6 }}>
          <div style={{ color: C.muted }}>cast call {D4.escrow}</div>
          <div style={{ color: C.muted }}>  "holder()(address)"</div>
          <div style={{ color: C.ok, marginTop: 6 }}>→ {D4.buyerEvm}  (buyer)</div>
        </div>
        <div style={{ marginTop: 18, fontFamily: mono, fontSize: 18, color: C.blue }}>sepolia.etherscan.io/address/0xEDc8a5F1…7162</div>
        <div style={{ marginTop: 26, fontSize: 24, color: C.muted, lineHeight: 1.4 }}>Deals 0–4 on NEAR testnet + Sepolia: settled, refunded, escrow-only, disputed, and deal 4 from this video.</div>
      </div>
    </>
  );
};

/* 10 — close */
const End: React.FC = () => {
  const l = useSpring(2, "heavy");
  const t = useSpring(sec(3.2));
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, display: "flex", flexDirection: "column", alignItems: "center", ...enter(l, 50) }}>
        <Logo size={140} />
        <div style={{ fontFamily: serif, fontSize: 104, marginTop: 20 }}>Tradelock</div>
      </div>
      <Title top={520} center size={58} at={sec(0.1)} lines={[["The buyer only gets the goods when the seller ", { a: "gets paid." }]]} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 720, textAlign: "center", ...enter(t, 16) }}>
        <div style={{ fontFamily: mono, fontSize: 28, color: C.blue }}>github.com/Samuel1505/TradeLock</div>
        <Tag style={{ marginTop: 18 }}>Built on NEAR · NEAR HACKATHON · Real-World Money</Tag>
        <Tag style={{ marginTop: 10, fontSize: 17 }}>Testnet demo · disclosures in README</Tag>
      </div>
    </>
  );
};

const PARTS = [Hook, Banks, Intro, Fund, Handover, Check, Release, Paths, Proof, End];
const words = caps as { dur: number; words: Word[] }[];

export const DEMO_SCENES = PARTS.map((C, i) => ({
  id: `D${i + 1}`,
  Component: C,
  vo: `vo/${String(i + 1).padStart(2, "0")}.mp3`,
  words: words[i].words,
  dur: LEAD + Math.ceil(words[i].dur * FPS) + (i === PARTS.length - 1 ? 45 : TAIL),
}));

export const DEMO_TOTAL = DEMO_SCENES.reduce((n, s) => n + s.dur, 0);

export const Demo: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile("music.wav")} volume={(f) => interpolate(f, [0, 30], [0, 0.55], clamp)} />
      {DEMO_SCENES.map((s) => {
        const start = from;
        from += s.dur;
        return (
          <Sequence key={s.id} name={s.id} from={start} durationInFrames={s.dur}>
            <Shell dur={s.dur}>
              <s.Component />
              <Captions words={s.words} />
            </Shell>
            <Sequence from={LEAD}>
              <Audio src={staticFile(s.vo)} />
            </Sequence>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
