import {
  runSimulation,
  type SimulationParams,
  type SimulationSummary,
} from "@/domain/simulation/monte-carlo";
import type { StrategySettings } from "@/domain/strategy/settings";

export type SimulationRequest = { params: SimulationParams; settings: StrategySettings };
export type SimulationMessage =
  | { type: "progress"; done: number }
  | { type: "done"; summary: SimulationSummary; elapsedMs: number }
  | { type: "error"; message: string };

const scope = self as unknown as {
  postMessage: (message: SimulationMessage) => void;
  onmessage: ((event: MessageEvent<SimulationRequest>) => void) | null;
};

// Runs entirely in the browser, off the main thread. Nothing leaves the machine.
scope.onmessage = (event) => {
  const { params, settings } = event.data;
  const started = performance.now();
  try {
    const summary = runSimulation(params, settings, (done) =>
      scope.postMessage({ type: "progress", done }),
    );
    scope.postMessage({ type: "done", summary, elapsedMs: performance.now() - started });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Simulation failed",
    });
  }
};
