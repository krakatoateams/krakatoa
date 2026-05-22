"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

export function LondonClock({ className = "" }: { className?: string }) {
  const [time, setTime] = useState("");

  useEffect(() => {
    const format = () => {
      const formatted = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
      setTime(formatted);
    };
    format();
    const id = window.setInterval(format, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Clock className="w-3.5 h-3.5" strokeWidth={2} />
      <span>{time ? `${time} in Jakarta` : "— in Jakarta"}</span>
    </span>
  );
}
