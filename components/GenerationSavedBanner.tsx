import { Check } from "lucide-react";

export function GenerationSavedBanner({
  message = "Saved to your library",
}: {
  message?: string;
}) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-2xl border border-success/20 bg-success/10 p-4 text-sm text-success">
      <Check className="h-5 w-5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
