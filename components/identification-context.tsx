"use client";
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import {
  identificationReducer,
  emptyIdentificationState,
  type IdentificationAction,
  type IdentificationState,
} from "../lib/identification-workflow";
const Context = createContext<{
  state: IdentificationState;
  dispatch: React.Dispatch<IdentificationAction>;
} | null>(null);
export function IdentificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(
    identificationReducer,
    emptyIdentificationState,
  );
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const next = state.photos.map((p) => p.url);
    urls.current
      .filter((url) => !next.includes(url))
      .forEach((url) => URL.revokeObjectURL(url));
    urls.current = next;
  }, [state.photos]);
  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  return (
    <Context.Provider value={{ state, dispatch }}>{children}</Context.Provider>
  );
}
export function useIdentification() {
  const context = useContext(Context);
  if (!context) throw new Error("IdentificationProvider is missing");
  return context;
}
