import { useEffect, useEffectEvent, useState } from "react";
import { ArcadeRequestError } from "@/lib/arcadeApi";

export interface ActionMessage {
  text: string;
  error?: boolean;
}

export function formValue(form: FormData, field: string) {
  return String(form.get(field) ?? "").trim();
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

export const displayName = (person: { firstName: string; lastName: string; displayName: string; email?: string }) =>
  [person.firstName, person.lastName].filter(Boolean).join(" ") || person.displayName || person.email || "Unnamed";

export const isConflict =(error: unknown) => error instanceof ArcadeRequestError && error.status === 409;

/** One action at a time per panel, with a status or error line for the result. */
export function useAdminAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  async function run(action: () => Promise<string>, failure: string | ((error: unknown) => string)) {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await action() });
      return true;
    } catch (error) {
      setMessage({ text: typeof failure === "string" ? failure : failure(error), error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, setMessage, run };
}

/**
 * Server data as one explicit state: loading, error, or ready. A reload keeps the last
 * ready data on screen (refreshing: true) instead of flashing back to loading.
 */
export type Remote<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: T; refreshing: boolean };

type Settled<T> = { key: string; status: "error" } | { key: string; status: "ready"; data: T };

// Last good response per key for this signed-in session. Returning to a page shows it at once
// and refreshes in the background. Cleared on every sign-in change (see App).
const remoteCache = new Map<string, unknown>();
const CACHE_LIMIT = 60;

export function clearRemoteCache() {
  remoteCache.clear();
}

export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, key: string): { state: Remote<T>; reload: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [version, setVersion] = useState(0);
  const requestKey = key + "#" + version;
  const fetchData = useEffectEvent(load);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        remoteCache.delete(key);
        remoteCache.set(key, data);
        if (remoteCache.size > CACHE_LIMIT) remoteCache.delete(remoteCache.keys().next().value!);
        setSettled({ key: requestKey, status: "ready", data });
      })
      .catch(() => { if (!controller.signal.aborted) setSettled({ key: requestKey, status: "error" }); });
    return () => controller.abort();
  }, [key, requestKey]);

  let state: Remote<T> = { status: "loading" };
  if (settled?.key === requestKey) state = settled.status === "ready" ? { status: "ready", data: settled.data, refreshing: false } : { status: "error" };
  else if (settled?.status === "ready" && settled.key.startsWith(key + "#")) state = { status: "ready", data: settled.data, refreshing: true };
  else if (remoteCache.has(key)) state = { status: "ready", data: remoteCache.get(key) as T, refreshing: true };
  return { state, reload: () => setVersion((current) => current + 1) };
}
