// Titik masuk bundel render (@remotion/bundler). Komponennya sama persis dengan Player di editor.
import { Composition, registerRoot } from "remotion";
import { createProject } from "@cz/core";
import { CzComposition, type CompositionProps } from "./index.tsx";

const blank: CompositionProps = { project: createProject("Kosong", "p_blank"), src: {}, lib: null, output: { width: 1080, height: 1920 } };

function Root() {
  return (
    <Composition
      id="cz"
      component={CzComposition}
      defaultProps={blank}
      width={1080} height={1920} fps={30} durationInFrames={1}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, props.project.sequence.durationFrames),
        fps: props.project.sequence.fps,
        width: props.output.width, height: props.output.height,
      })}
    />
  );
}

registerRoot(Root);
