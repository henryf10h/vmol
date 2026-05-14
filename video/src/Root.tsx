import { Composition } from "remotion";
import { Demo } from "./Demo";

// 42 seconds @ 30fps = 1260 frames
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={1260}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
