import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { normalizeHex, deltaE00 } from "./color";

export interface PaletteEntry {
  id: string;
  hex: string;
}

export interface PaletteState {
  colors: PaletteEntry[];
  anchorA: string | null;
  anchorB: string | null;
}

export type PaletteAction =
  | { type: "ADD_COLOR"; hex: string }
  | { type: "REMOVE_COLOR"; id: string }
  | { type: "TAP_SWATCH"; id: string }
  | { type: "RESET" };

const DEDUP_THRESHOLD = 3;

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `c${nextId}_${Math.random().toString(36).slice(2, 8)}`;
}

export function initialPaletteState(): PaletteState {
  return { colors: [], anchorA: null, anchorB: null };
}

export function paletteReducer(
  state: PaletteState,
  action: PaletteAction,
): PaletteState {
  switch (action.type) {
    case "ADD_COLOR": {
      const hex = normalizeHex(action.hex);
      if (!hex) return state;
      const tooClose = state.colors.some(
        (c) => deltaE00(c.hex, hex) < DEDUP_THRESHOLD,
      );
      if (tooClose) return state;
      return {
        ...state,
        colors: [...state.colors, { id: makeId(), hex }],
      };
    }

    case "REMOVE_COLOR": {
      return {
        colors: state.colors.filter((c) => c.id !== action.id),
        anchorA: state.anchorA === action.id ? null : state.anchorA,
        anchorB: state.anchorB === action.id ? null : state.anchorB,
      };
    }

    case "TAP_SWATCH": {
      const { id } = action;
      const exists = state.colors.some((c) => c.id === id);
      if (!exists) return state;

      const { anchorA, anchorB } = state;

      if (anchorA === null && anchorB === null) {
        return { ...state, anchorA: id };
      }
      if (anchorA !== null && anchorB === null) {
        if (id === anchorA) return { ...state, anchorA: null };
        return { ...state, anchorB: id };
      }
      if (anchorA === null && anchorB !== null) {
        if (id === anchorB) return { ...state, anchorB: null };
        return { ...state, anchorA: id };
      }
      // State 2 — both set
      if (id === anchorA) return { ...state, anchorA: null };
      if (id === anchorB) return { ...state, anchorB: null };
      // Third tap → A drops, B promotes to A, new id is B
      return { ...state, anchorA: anchorB, anchorB: id };
    }

    case "RESET":
      return initialPaletteState();

    default:
      return state;
  }
}

interface PaletteContextValue {
  state: PaletteState;
  dispatch: Dispatch<PaletteAction>;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(paletteReducer, initialPaletteState());
  return (
    <PaletteContext.Provider value={{ state, dispatch }}>
      {children}
    </PaletteContext.Provider>
  );
}

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used inside <PaletteProvider>");
  return ctx;
}
