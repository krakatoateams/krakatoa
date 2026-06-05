export const GOOGLY_EYES_SPLINE_URL =
  "https://my.spline.design/googlyeyes-9vLBf5posajnNeZ0kedg2uVm-OIN/";

type SplineCoverEmbedProps = {
  src?: string;
  title?: string;
  interactive?: boolean;
  cropBottom?: number;
};

export function SplineCoverEmbed({
  src = GOOGLY_EYES_SPLINE_URL,
  title = "Spline 3D scene",
  interactive = false,
  cropBottom = 0,
}: SplineCoverEmbedProps) {
  return (
    <div
      className={`absolute inset-x-0 top-0 ${interactive ? "" : "pointer-events-none"}`}
      style={{ bottom: -cropBottom }}
    >
      <iframe
        src={src}
        title={title}
        allow="autoplay; fullscreen; xr-spatial-tracking"
        frameBorder="0"
        width="100%"
        height="100%"
        className="block border-0"
      />
    </div>
  );
}
