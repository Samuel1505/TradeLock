import React from "react";
import { Series } from "remotion";
import { Banks, BANKS_DUR, Hook, HOOK_DUR } from "./scenes/Problem";
import { Cash, CASH_DUR, Intro, INTRO_DUR } from "./scenes/Product";
import { CheckDocs, CHECK_DUR, TitleLock, TITLE_DUR } from "./scenes/Title";
import { Dispute, DISPUTE_DUR, Release, RELEASE_DUR } from "./scenes/Release";
import { End, END_DUR, Proof, PROOF_DUR } from "./scenes/Close";

export const SCENES = [
  { id: "Hook", component: Hook, dur: HOOK_DUR },
  { id: "Banks", component: Banks, dur: BANKS_DUR },
  { id: "Intro", component: Intro, dur: INTRO_DUR },
  { id: "Cash", component: Cash, dur: CASH_DUR },
  { id: "Title", component: TitleLock, dur: TITLE_DUR },
  { id: "Check", component: CheckDocs, dur: CHECK_DUR },
  { id: "Release", component: Release, dur: RELEASE_DUR },
  { id: "Dispute", component: Dispute, dur: DISPUTE_DUR },
  { id: "Proof", component: Proof, dur: PROOF_DUR },
  { id: "End", component: End, dur: END_DUR },
] as const;

export const TOTAL = SCENES.reduce((n, s) => n + s.dur, 0);

export const Tradelock: React.FC = () => (
  <Series>
    {SCENES.map((s) => (
      <Series.Sequence key={s.id} name={s.id} durationInFrames={s.dur}>
        <s.component />
      </Series.Sequence>
    ))}
  </Series>
);
