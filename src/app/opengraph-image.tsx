import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Tarrow — an agent that knows your life, and does the work";

function Check() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" style={{ marginRight: 14 }}>
      <circle cx="12" cy="12" r="12" fill="#0a0a0a" />
      <path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function Image() {
  const steps = ["Finding events this week", "Reading lu.ma", "3 agents in parallel"];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="56" height="56" viewBox="0 0 32 32" style={{ marginRight: 16 }}>
              <rect width="32" height="32" rx="9" fill="#0a0a0a" />
              <path d="M9 10.5h14M16 10.5v11.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M12.2 18.4 16 22.2l3.8-3.8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <span style={{ fontSize: 40, color: "#0a0a0a" }}>Tarrow</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 66, lineHeight: 1.05, letterSpacing: -2, color: "#0a0a0a" }}>An agent that knows your life, and does the work.</div>
            <div style={{ fontSize: 28, color: "#737373", marginTop: 24 }}>Research, plans, events and real advice.</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: 40, flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", border: "2px solid #e7e5e4", borderRadius: 32, padding: "32px 30px" }}>
            {steps.map((label) => (
              <div key={label} style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#0a0a0a", marginBottom: 20 }}>
                <Check />
                {label}
              </div>
            ))}
            <div style={{ display: "flex", fontSize: 24, color: "#a3a3a3" }}>Working… 2m 14s</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
