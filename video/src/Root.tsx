import React from "react";
import { Composition, Folder } from "remotion";
import { SCENES, TOTAL, Tradelock } from "./Tradelock";
import { Demo, DEMO_TOTAL } from "./demo/Demo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Demo" component={Demo} durationInFrames={DEMO_TOTAL} fps={30} width={1920} height={1080} />
    <Composition id="Tradelock" component={Tradelock} durationInFrames={TOTAL} fps={30} width={1080} height={1080} />
    <Folder name="Scenes">
      {SCENES.map((s) => (
        <Composition key={s.id} id={s.id} component={s.component} durationInFrames={s.dur} fps={30} width={1080} height={1080} />
      ))}
    </Folder>
  </>
);
