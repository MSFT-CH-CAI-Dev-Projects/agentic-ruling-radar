"use client";
import { useEffect, useState } from "react";

/**
 * App logo with runtime detection. If `public/brand/logo.svg` is
 * mounted by the operator, use it. Otherwise fall back to a wordmark.
 */
export function AppLogo() {
  const [hasLogo, setHasLogo] = useState(false);

  useEffect(() => {
    fetch("/brand/logo.svg", { method: "HEAD" })
      .then((r) => setHasLogo(r.ok))
      .catch(() => setHasLogo(false));
  }, []);

  if (hasLogo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/brand/logo.svg" alt="Ruling Radar" className="h-8" />;
  }
  return (
    <span className="font-bold text-xl tracking-tight">
      <span className="text-brand-primary">Ruling Radar</span>
    </span>
  );
}
