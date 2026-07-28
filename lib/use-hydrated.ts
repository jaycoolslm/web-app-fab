"use client";

import { useEffect, useState } from "react";

/**
 * False during SSR and the first client render, true once React has hydrated.
 *
 * Used to keep auth submit buttons disabled until their onSubmit handler is
 * actually attached. Without it an early click falls through to a native form
 * submit, which silently reloads the page and looks like nothing happened —
 * easy for a person to shrug off, and a hard stop for anything driving the app
 * in a browser.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
