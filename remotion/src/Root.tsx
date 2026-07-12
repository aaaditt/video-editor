import "./index.css";
import { Composition } from "remotion";
import { calculatePolishMetadata, Polish } from "./Polish";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Polish"
        component={Polish}
        // Placeholder values — calculateMetadata overrides them per job
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          job: "test-clip",
          plan: null,
          captions: null,
        }}
        calculateMetadata={calculatePolishMetadata}
      />
    </>
  );
};
