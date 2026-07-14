"use client";

import { useEffect, useRef } from "react";

/**
 * Autoplaying looped demo video. A client component because React doesn't
 * serialize the `muted` attribute on SSR, which makes browsers block
 * autoplay — so we set it via ref. Also pauses while off-screen.
 */
export function DemoVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    let inView = false;
    const sync = () => {
      if (inView && document.visibilityState === "visible") {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        sync();
      },
      { threshold: 0.3 },
    );
    io.observe(v);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <video
      ref={ref}
      src="/pulse-product-demo.mp4"
      poster="/pulse-demo-poster.jpg"
      muted
      loop
      playsInline
      preload="metadata"
      aria-label="Pulse demo: the dashboard, then the assistant answering a question with live tool calls and a recommended action"
      className="w-full"
    />
  );
}
