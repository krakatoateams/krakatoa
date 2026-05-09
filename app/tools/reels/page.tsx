/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ReelsPage() {
  const [theme, setTheme] = useState("");
  const [numScenes, setNumScenes] = useState(1);
  const [durationPerScene, setDurationPerScene] = useState(5);
  const [resolution, setResolution] = useState("480p");
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  const [captionStyle, setCaptionStyle] = useState({
    fontname: "Poppins",
    fontsize: 60,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    outlineThickness: 4,
    marginV: 15,
    highlightOnly: true
  });

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!theme.trim()) return;

    setLoading(true);
    setError(null);
    setVideoUrl(null);
    setLogs(["Starting generation pipeline..."]);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          theme, 
          numScenes: Number(numScenes), 
          durationPerScene: Number(durationPerScene),
          resolution,
          captionStyle
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate video");
      }

      setVideoUrl(data.videoUrl);
      setLogs((prev) => [...prev, "Video generated successfully!"]);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
      setLogs((prev) => [...prev, `Error: ${err.message}`]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="border-b border-gray-200 py-4 px-6 mb-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center text-indigo-600 hover:text-indigo-700 font-semibold">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Krakatoa
          </Link>
          <span className="text-xl font-bold text-gray-900">ReelsGen</span>
        </div>
      </nav>

      <main style={{ maxWidth: "800px", margin: "0 auto", padding: "0 2rem 4rem", fontFamily: "sans-serif" }}>
        <h1>ReelsGen</h1>
        <p>Generate a faceless video from a theme.</p>
        
        <form onSubmit={handleGenerate} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Enter a theme (e.g., A cyberpunk city in the rain)"
            required
            style={{ padding: "0.5rem", fontSize: "1rem", border: "1px solid #ccc", borderRadius: "4px" }}
            disabled={loading}
          />
          
          <div style={{ display: "flex", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>Number of Scenes:</label>
              <select 
                value={numScenes} 
                onChange={(e) => setNumScenes(Number(e.target.value))}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                disabled={loading}
              >
                <option value={1}>1 Scene</option>
                <option value={2}>2 Scenes (Stitched)</option>
                <option value={3}>3 Scenes (Stitched)</option>
              </select>
            </div>
            
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>Duration per Scene:</label>
              <select 
                value={durationPerScene} 
                onChange={(e) => setDurationPerScene(Number(e.target.value))}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                disabled={loading}
              >
                <option value={5}>5 Seconds</option>
                <option value={10}>10 Seconds</option>
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>Resolution:</label>
              <select 
                value={resolution} 
                onChange={(e) => setResolution(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                disabled={loading}
              >
                <option value="480p">480p (Fast)</option>
                <option value="720p">720p (HD)</option>
              </select>
            </div>
          </div>

          <div style={{ borderTop: "1px solid #ccc", paddingTop: "1rem", marginTop: "1rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "1.5rem" }}>Caption Styler</h3>
            
            <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
              {/* Left side: Controls */}
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>Font Family:</label>
                  <select 
                    value={captionStyle.fontname} 
                    onChange={(e) => setCaptionStyle({...captionStyle, fontname: e.target.value})}
                    style={{ width: "100%", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  >
                    <option value="Arial">Arial (System)</option>
                    <option value="Poppins">Poppins (ExtraBold)</option>
                    <option value="Montserrat">Montserrat (Bold)</option>
                    <option value="Bangers">Bangers (Comic)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>Font Size:</label>
                  <input 
                    type="number" 
                    value={captionStyle.fontsize} 
                    onChange={(e) => setCaptionStyle({...captionStyle, fontsize: Number(e.target.value)})}
                    style={{ width: "100%", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>Text Color:</label>
                  <input 
                    type="color" 
                    value={captionStyle.highlightColor} 
                    onChange={(e) => setCaptionStyle({...captionStyle, highlightColor: e.target.value})}
                    style={{ width: "100%", padding: "0.5rem", height: "40px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>Outline Color:</label>
                  <input 
                    type="color" 
                    value={captionStyle.outlineColor} 
                    onChange={(e) => setCaptionStyle({...captionStyle, outlineColor: e.target.value})}
                    style={{ width: "100%", padding: "0.5rem", height: "40px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>Outline Thickness:</label>
                  <input 
                    type="number" 
                    value={captionStyle.outlineThickness} 
                    onChange={(e) => setCaptionStyle({...captionStyle, outlineThickness: Number(e.target.value)})}
                    style={{ width: "100%", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>Vertical Margin (% from bottom):</label>
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={captionStyle.marginV} 
                    onChange={(e) => setCaptionStyle({...captionStyle, marginV: Number(e.target.value)})}
                    style={{ width: "100%" }}
                  />
                  <div style={{ textAlign: "right", fontSize: "0.8rem", marginTop: "0.25rem" }}>{captionStyle.marginV}%</div>
                </div>

              </div>

              {/* Right side: 9:16 Preview */}
              <div style={{ padding: "1.5rem", background: "#000", borderRadius: "8px", border: "1px solid #333", height: "100%", position: "relative" }}>
                <div style={{ color: "#888", fontSize: "0.8rem", marginBottom: "0.5rem" }}>9:16 Preview</div>
                <style dangerouslySetInnerHTML={{__html: `
                  @import url('https://fonts.googleapis.com/css2?family=Bangers&family=Montserrat:wght@700&family=Poppins:wght@800&display=swap');
                `}} />
                {(() => {
                  const FONT_METRIC_SCALES: Record<string, number> = {
                    "Arial": 0.87,
                    "Poppins": 0.86,
                    "Montserrat": 0.86,
                    "Bangers": 0.65
                  };
                  const DESCENDER_OFFSET_SCALES: Record<string, number> = {
                    "Arial": 0.08,
                    "Poppins": 0.08,
                    "Montserrat": 0.08,
                    "Bangers": 0.12
                  };
                  
                  const metricScale = FONT_METRIC_SCALES[captionStyle.fontname] || 0.85;
                  const offsetScale = DESCENDER_OFFSET_SCALES[captionStyle.fontname] || 0.08;

                  return (
                    <div style={{ 
                      width: "225px", 
                      height: "400px", 
                      background: "#000",
                      position: "relative",
                      margin: "0 auto",
                      borderRadius: "8px",
                      border: "1px solid #333",
                      overflow: "hidden"
                    }}>
                      <div style={{ 
                        position: "absolute", 
                        width: "100%", 
                        bottom: `calc(${captionStyle.marginV}% + ${captionStyle.fontsize * (400 / 854) * offsetScale}px)`,
                        left: 0,
                        padding: "0 10px",
                        boxSizing: "border-box",
                        display: "flex",
                        justifyContent: "center",
                        pointerEvents: "none"
                      }}>
                        <div style={{ 
                          position: "relative",
                          fontFamily: `'${captionStyle.fontname}', sans-serif`, 
                          fontSize: `${captionStyle.fontsize * (400 / 854) * metricScale}px`,
                          fontWeight: 800,
                          textAlign: "center",
                          lineHeight: "1.2",
                          textTransform: "uppercase"
                        }}>
                          <div style={{
                            position: "absolute",
                            left: 0, top: 0, right: 0, bottom: 0,
                            WebkitTextStroke: `${captionStyle.outlineThickness * (400 / 854) * 2}px ${captionStyle.outlineColor}`,
                            color: captionStyle.outlineColor,
                            zIndex: 0
                          }}>
                            <span>BREATHTAKING</span>
                          </div>
                          <div style={{ position: "relative", zIndex: 1, color: captionStyle.highlightColor }}>
                            <span>BREATHTAKING</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            style={{ padding: "0.75rem", fontSize: "1rem", cursor: loading ? "not-allowed" : "pointer", background: "#0070f3", color: "white", border: "none", borderRadius: "4px", fontWeight: "bold" }}
          >
            {loading ? "Generating your video..." : "Generate Video"}
          </button>
        </form>

        <div style={{ borderTop: "1px solid #ccc", paddingTop: "2rem", marginBottom: "2rem" }}>
          <h2>Test Pipeline (Stitch Only)</h2>
          <p style={{ fontSize: "0.9rem", color: "#666" }}>
            This tests the Whisper + Rendi pipeline using existing <code>video.mp4</code> and <code>audio.mp3</code> files from your Supabase <code>temp</code> bucket.
          </p>
          <button 
            onClick={async () => {
              if (loading) return;
              setLoading(true);
              setError(null);
              setVideoUrl(null);
              setLogs(["Starting test pipeline (Whisper -> Rendi)..."]);

              try {
                const response = await fetch("/api/test-stitch", { 
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ captionStyle })
                });
                const data = await response.json();

                if (!response.ok) throw new Error(data.error || "Failed to test pipeline");

                setVideoUrl(data.videoUrl);
                setLogs((prev) => [...prev, "Test pipeline completed successfully!"]);
              } catch (err: any) {
                setError(err.message || "An unexpected error occurred");
                setLogs((prev) => [...prev, `Error: ${err.message}`]);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{ padding: "0.5rem 1rem", fontSize: "0.9rem", cursor: loading ? "not-allowed" : "pointer", background: "#28a745", color: "white", border: "none", borderRadius: "4px" }}
          >
            {loading ? "Processing..." : "Run Stitching Test"}
          </button>
        </div>

        {error && (
          <div style={{ color: "red", marginBottom: "1rem", padding: "1rem", background: "#fff5f5", borderRadius: "4px", border: "1px solid #fed7d7" }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {videoUrl && (
          <div style={{ marginBottom: "2rem" }}>
            <h2>Result</h2>
            <video src={videoUrl} controls style={{ width: "100%", maxHeight: "500px", background: "#000", borderRadius: "8px" }}></video>
            <div style={{ marginTop: "1rem" }}>
              <a 
                href={videoUrl} 
                download 
                target="_blank" 
                rel="noreferrer"
                style={{ display: "inline-block", padding: "0.5rem 1rem", background: "#0070f3", color: "white", textDecoration: "none", borderRadius: "4px" }}
              >
                Download Video
              </a>
            </div>
          </div>
        )}

        <div style={{ background: "#f8f9fa", padding: "1.5rem", borderRadius: "8px", minHeight: "150px", border: "1px solid #e9ecef" }}>
          <h3 style={{ marginTop: 0 }}>Logs</h3>
          {logs.map((log, i) => (
            <div key={i} style={{ fontSize: "0.9rem", color: "#495057", marginBottom: "0.25rem", fontFamily: "monospace" }}>
              {log}
            </div>
          ))}
          {loading && <div style={{ fontSize: "0.9rem", color: "#6c757d", fontStyle: "italic", marginTop: "0.5rem" }}>Processing... check console for status.</div>}
        </div>
      </main>
    </div>
  );
}
