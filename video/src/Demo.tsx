import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { theme } from "./theme";
import { Background, FadeIn, Pill, Card, useProgress } from "./components";

// ============================================================
// Scene 1 — Title (0-120, 4s)
// ============================================================
const SceneTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoScale = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  return (
    <Background>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            transform: `scale(${logoScale})`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 140,
              fontWeight: 800,
              letterSpacing: -3,
              color: theme.text,
            }}
          >
            <span style={{ color: theme.accent }}>VMOL</span> Protocol
          </div>
        </div>
        <FadeIn delay={28} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 44, color: theme.textDim, fontWeight: 400 }}>
            AI Risk Governor for Lending Protocols
          </div>
        </FadeIn>
        <FadeIn delay={48} style={{ marginTop: 40 }}>
          <Pill>Starknet · Reinforcement Learning · DeFi</Pill>
        </FadeIn>
      </AbsoluteFill>
    </Background>
  );
};

// ============================================================
// Scene 2 — The Problem (120-360, 8s)
// ============================================================
const SceneProblem: React.FC = () => {
  return (
    <Background>
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px" }}>
        <FadeIn>
          <Pill color={theme.danger}>The Problem</Pill>
        </FadeIn>
        <FadeIn delay={15} style={{ marginTop: 36 }}>
          <div style={{ fontSize: 76, fontWeight: 700, color: theme.text, lineHeight: 1.15 }}>
            Lending protocols adjust risk through{" "}
            <span style={{ color: theme.danger }}>governance votes.</span>
          </div>
        </FadeIn>

        <div style={{ display: "flex", gap: 40, marginTop: 70 }}>
          <FadeIn delay={45} style={{ flex: 1 }}>
            <Card>
              <div style={{ fontSize: 30, color: theme.textMuted, marginBottom: 12 }}>
                Governance vote
              </div>
              <div style={{ fontSize: 90, fontWeight: 800, color: theme.danger }}>
                DAYS
              </div>
            </Card>
          </FadeIn>
          <FadeIn delay={60} style={{ flex: 1 }}>
            <Card>
              <div style={{ fontSize: 30, color: theme.textMuted, marginBottom: 12 }}>
                Market crash
              </div>
              <div style={{ fontSize: 90, fontWeight: 800, color: theme.warning }}>
                MINUTES
              </div>
            </Card>
          </FadeIn>
        </div>

        <FadeIn delay={90} style={{ marginTop: 56 }}>
          <div style={{ fontSize: 42, color: theme.textDim }}>
            By the time the vote passes, the bad debt is already on the books.
          </div>
        </FadeIn>
      </AbsoluteFill>
    </Background>
  );
};

// ============================================================
// Scene 3 — The Solution / Architecture (360-630, 9s)
// ============================================================
const FlowNode: React.FC<{
  title: string;
  sub: string;
  delay: number;
  color: string;
}> = ({ title, sub, delay, color }) => (
  <FadeIn delay={delay} style={{ flex: 1 }}>
    <Card glow style={{ borderColor: `${color}55` }}>
      <div style={{ fontSize: 34, fontWeight: 700, color, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ fontSize: 26, color: theme.textDim, lineHeight: 1.4 }}>{sub}</div>
    </Card>
  </FadeIn>
);

const Arrow: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [delay, delay + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontSize: 60,
        color: theme.accent,
        opacity: o,
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
      }}
    >
      →
    </div>
  );
};

const SceneSolution: React.FC = () => {
  return (
    <Background>
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 120px" }}>
        <FadeIn>
          <Pill color={theme.success}>The Solution</Pill>
        </FadeIn>
        <FadeIn delay={15} style={{ marginTop: 30 }}>
          <div style={{ fontSize: 72, fontWeight: 700, color: theme.text }}>
            An <span style={{ color: theme.accent }}>autonomous AI Risk Governor.</span>
          </div>
        </FadeIn>

        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            marginTop: 70,
          }}
        >
          <FlowNode
            title="AI Agent"
            sub="RL-trained model proposes new LTV & liquidation threshold"
            delay={40}
            color={theme.accent}
          />
          <Arrow delay={70} />
          <FlowNode
            title="RiskGovernor"
            sub="On-chain Cairo guardrails validate every proposal"
            delay={85}
            color={theme.warning}
          />
          <Arrow delay={115} />
          <FlowNode
            title="Lending Pool"
            sub="Parameters update — pool stays solvent, 24/7"
            delay={130}
            color={theme.success}
          />
        </div>

        <FadeIn delay={170} style={{ marginTop: 60 }}>
          <div style={{ fontSize: 42, color: theme.textDim }}>
            The AI proposes. The contract validates. The protocol adapts —{" "}
            <span style={{ color: theme.text }}>no governance delay.</span>
          </div>
        </FadeIn>
      </AbsoluteFill>
    </Background>
  );
};

// ============================================================
// Scene 4 — The Guardrails (630-900, 9s)
// ============================================================
const GuardRow: React.FC<{
  num: string;
  title: string;
  detail: string;
  delay: number;
}> = ({ num, title, detail, delay }) => (
  <FadeIn delay={delay}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 32,
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        padding: "28px 36px",
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 800,
          color: theme.accent,
          fontFamily: theme.fontMono,
          minWidth: 60,
        }}
      >
        {num}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 38, fontWeight: 700, color: theme.text }}>
          {title}
        </div>
        <div style={{ fontSize: 28, color: theme.textDim, marginTop: 4 }}>
          {detail}
        </div>
      </div>
    </div>
  </FadeIn>
);

const SceneGuardrails: React.FC = () => {
  return (
    <Background>
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px" }}>
        <FadeIn>
          <Pill color={theme.warning}>On-Chain Safety</Pill>
        </FadeIn>
        <FadeIn delay={15} style={{ marginTop: 28 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: theme.text }}>
            A compromised model{" "}
            <span style={{ color: theme.success }}>can't drain the pool.</span>
          </div>
        </FadeIn>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            marginTop: 56,
          }}
        >
          <GuardRow
            num="01"
            title="Identity"
            detail="Only the registered agent wallet can propose"
            delay={40}
          />
          <GuardRow
            num="02"
            title="Bounds"
            detail="LTV ∈ [50%, 85%] · Liquidation Threshold ∈ [60%, 90%]"
            delay={60}
          />
          <GuardRow
            num="03"
            title="Delta Caps"
            detail="Maximum 5% change per update — no sudden swings"
            delay={80}
          />
          <GuardRow
            num="04"
            title="Rate Limit"
            detail="Cooldown between updates + total update budget"
            delay={100}
          />
        </div>
      </AbsoluteFill>
    </Background>
  );
};

// ============================================================
// Scene 5 — Live On-Chain Result (900-1170, 9s)
// ============================================================
const SceneLive: React.FC = () => {
  const frame = useCurrentFrame();
  const txProgress = useProgress(60, 40);

  // Animated LTV value: 75% -> 70%
  const ltv = interpolate(frame, [110, 150], [75, 70], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lt = interpolate(frame, [110, 150], [80, 75], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Background>
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px" }}>
        <FadeIn>
          <Pill color={theme.success}>Live on Starknet Sepolia</Pill>
        </FadeIn>
        <FadeIn delay={12} style={{ marginTop: 28 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: theme.text }}>
            ETH crashes <span style={{ color: theme.danger }}>−25%</span> → the agent reacts.
          </div>
        </FadeIn>

        <div style={{ display: "flex", gap: 32, marginTop: 56 }}>
          <FadeIn delay={30} style={{ flex: 1 }}>
            <Card>
              <div style={{ fontSize: 28, color: theme.textMuted }}>LTV</div>
              <div
                style={{
                  fontSize: 96,
                  fontWeight: 800,
                  color: theme.accent,
                  fontFamily: theme.fontMono,
                }}
              >
                {ltv.toFixed(1)}%
              </div>
              <div style={{ fontSize: 24, color: theme.textDim }}>
                tightened from 75%
              </div>
            </Card>
          </FadeIn>
          <FadeIn delay={42} style={{ flex: 1 }}>
            <Card>
              <div style={{ fontSize: 28, color: theme.textMuted }}>
                Liquidation Threshold
              </div>
              <div
                style={{
                  fontSize: 96,
                  fontWeight: 800,
                  color: theme.accent,
                  fontFamily: theme.fontMono,
                }}
              >
                {lt.toFixed(1)}%
              </div>
              <div style={{ fontSize: 24, color: theme.textDim }}>
                tightened from 80%
              </div>
            </Card>
          </FadeIn>
        </div>

        {/* TX confirmation bar */}
        <FadeIn delay={55} style={{ marginTop: 44 }}>
          <Card glow style={{ borderColor: `${theme.success}55` }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div style={{ fontSize: 32, color: theme.text, fontWeight: 600 }}>
                propose_parameters() → RiskGovernor
              </div>
              <div
                style={{
                  fontSize: 28,
                  color: theme.success,
                  fontWeight: 700,
                }}
              >
                {txProgress >= 1 ? "✓ ACCEPTED ON L2" : "submitting..."}
              </div>
            </div>
            <div
              style={{
                height: 14,
                background: theme.border,
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${txProgress * 100}%`,
                  height: "100%",
                  background: theme.success,
                  borderRadius: 999,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 24,
                color: theme.textMuted,
                fontFamily: theme.fontMono,
                marginTop: 16,
              }}
            >
              tx: 0x78c84b0cb87f8ad7422c2ede515ed0e4e154a0965a9183294c56f0034c1af74
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={110} style={{ marginTop: 36 }}>
          <div style={{ fontSize: 38, color: theme.textDim }}>
            A real transaction. Real guardrails. Real protection —{" "}
            <span style={{ color: theme.text }}>in seconds, not days.</span>
          </div>
        </FadeIn>
      </AbsoluteFill>
    </Background>
  );
};

// ============================================================
// Scene 6 — Outro (1170-1260, 3s)
// ============================================================
const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  return (
    <Background>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `scale(${s})`, textAlign: "center" }}>
          <div style={{ fontSize: 120, fontWeight: 800, color: theme.text }}>
            <span style={{ color: theme.accent }}>VMOL</span> Protocol
          </div>
          <div style={{ fontSize: 40, color: theme.textDim, marginTop: 20 }}>
            Markets move in minutes. Now your risk parameters do too.
          </div>
        </div>
        <FadeIn delay={30} style={{ marginTop: 50 }}>
          <div
            style={{
              fontSize: 30,
              color: theme.textMuted,
              fontFamily: theme.fontMono,
            }}
          >
            Platanus Build Night 26 · Caracas
          </div>
        </FadeIn>
      </AbsoluteFill>
    </Background>
  );
};

// ============================================================
// Master composition
// ============================================================
export const Demo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence durationInFrames={120}>
        <SceneTitle />
      </Sequence>
      <Sequence from={120} durationInFrames={240}>
        <SceneProblem />
      </Sequence>
      <Sequence from={360} durationInFrames={270}>
        <SceneSolution />
      </Sequence>
      <Sequence from={630} durationInFrames={270}>
        <SceneGuardrails />
      </Sequence>
      <Sequence from={900} durationInFrames={270}>
        <SceneLive />
      </Sequence>
      <Sequence from={1170} durationInFrames={90}>
        <SceneOutro />
      </Sequence>
    </AbsoluteFill>
  );
};
