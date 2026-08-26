/// <reference types="vite/client" />

/** Frame bridge the server video renderer drives. Only present in render mode. */
type MapStudioVideoBridge = {
  ready: boolean;
  totalFrames: number;
  settled: boolean;
  setFrame: (frame: number) => void;
};

interface Window {
  __mapStudioVideo?: MapStudioVideoBridge;
}
