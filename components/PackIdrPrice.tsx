"use client";

import { formatIdr, formatIdrAsUsd } from "@/lib/credit-packs";
import { useUsdToIdr } from "@/lib/use-usd-to-idr";

/** IDR pack price with a smaller USD equivalent from the admin exchange rate. */
export function PackIdrPrice({
  amountIdr,
  className,
  usdClassName,
}: {
  amountIdr: number;
  className?: string;
  usdClassName?: string;
}) {
  const usd = formatIdrAsUsd(amountIdr, useUsdToIdr());
  return (
    <span className="flex w-full flex-col items-end text-right leading-tight">
      <span className={className}>{formatIdr(amountIdr)}</span>
      {usd ? (
        <span className={usdClassName ?? "text-xs font-normal text-text-disabled"}>
          ≈ {usd}
        </span>
      ) : null}
    </span>
  );
}
