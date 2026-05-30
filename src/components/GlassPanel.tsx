import LiquidGlass from "liquid-glass-react";

interface GlassPanelProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  cornerRadius?: number;
}

export default function GlassPanel({
  children,
  className = "",
  style,
  cornerRadius = 24,
}: GlassPanelProps) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      <LiquidGlass
        displacementScale={40}
        blurAmount={0.08}
        saturation={130}
        aberrationIntensity={1}
        elasticity={0.15}
        cornerRadius={cornerRadius}
        overLight={false}
        style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%" }}
      >
        <div />
      </LiquidGlass>
      {children && <div className="relative z-10">{children}</div>}
    </div>
  );
}
