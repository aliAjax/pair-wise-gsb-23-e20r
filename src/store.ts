import { useEffect, useMemo, useReducer } from "react";
import type { AppState } from "./types";
import { buildSeed, reducer } from "./domain";

const STORAGE_KEY = "hxwl-09-inspection-state-v1";

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    // 忽略损坏的存档
  }
  return buildSeed();
}

export function useStore() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅影响持久化
    }
  }, [state]);

  return useMemo(() => ({ state, dispatch }), [state]);
}

export type Store = ReturnType<typeof useStore>;
