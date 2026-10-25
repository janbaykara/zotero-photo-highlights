import { createContext } from "preact";
import type { ZoteroDndManager } from "../types";

export type { ZoteroDndManager };

export const ZoteroDndContext = createContext<ZoteroDndManager | null>(null);
