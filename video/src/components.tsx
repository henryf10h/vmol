import React from "react";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  AbsoluteFill,
} from "remotion";
import { theme } from "./theme";

// Fade + rise in. `delay` in frames.
export const FadeIn: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
  rise?: number;
}> = ({ children, delay = 0, style, rise = 30 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${(1 - s) * rise}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// Background with subtle radial glow
export const Background: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        fontFamily: theme.fontSans,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 40%, rgba(99,102,241,0.10), transparent 70%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

// Small pill label
export const Pill: React.FC<{
  children: React.ReactNode;
  color?: string;
}> = ({ children, color = theme.accent }) => (
  <div
    style={{
      display: "inline-block",
      padding: "10px 22px",
      borderRadius: 999,
      background: `${color}22`,
      color,
      fontSize: 26,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

// Card container
export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  glow?: boolean;
}> = ({ children, style, glow }) => (
  <div
    style={{
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 20,
      padding: 36,
      boxShadow: glow ? `0 0 60px ${theme.accentGlow}` : "none",
      ...style,
    }}
  >
    {children}
  </div>
);

// Progress bar that fills based on local frame
export const useProgress = (start: number, duration: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};
