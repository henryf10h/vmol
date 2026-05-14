import { useState, useEffect, useRef, useCallback } from 'react'

const METRIC_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '1rem 1.2rem',
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={METRIC_STYLE}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{sub}</div>}
    </div>
  )
}

function LogEntry({ log }) {
  const colors = {
    info: '#6366f1',
    market: '#f59e0b',
    llm: '#a78bfa',
    decision: '#22c55e',
    success: '#22c55e',
    error: '#ef4444',
  }
  return (
    <div className="fade-in" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
      <span style={{ color: colors[log.type] || '#6b7280', fontWeight: 500 }}>[{log.type?.toUpperCase()}]</span>
      <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>{log.message}</span>
    </div>
  )
}

function SimButton({ label, onClick, color, loading, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        padding: '0.6rem 1.2rem',
        borderRadius: '8px',
        background: disabled ? '#1f2937' : color || 'var(--accent)',
        color: disabled ? '#4b5563' : '#fff',
        fontWeight: 500,
        fontSize: '0.85rem',
        opacity: loading ? 0.7 : 1,
        width: '100%',
      }}
    >
      {loading ? 'Running...' : label}
    </button>
  )
}

export default function Dashboard() {
  const [state, setState] = useState(null)
  const [contracts, setContracts] = useState(null)
  const [logs, setLogs] = useState([])
  const [decisions, setDecisions] = useState([])
  const [loading, setLoading] = useState({})
  const logRef = useRef(null)

  useEffect(() => {
    fetch('/api/state').then(r => r.json()).then(setState)
    fetch('/api/history').then(r => r.json()).then(setDecisions)
    fetch('/api/contracts').then(r => r.json()).then(setContracts).catch(() => {})

    const es = new EventSource('/api/stream')
    es.addEventListener('state', (e) => setState(JSON.parse(e.data)))
    es.addEventListener('log', (e) => {
      setLogs(prev => [...prev.slice(-99), JSON.parse(e.data)])
    })
    es.addEventListener('decision', (e) => {
      setDecisions(prev => [...prev, JSON.parse(e.data)])
    })
    return () => es.close()
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const apiCall = useCallback(async (endpoint, key, body) => {
    setLoading(l => ({ ...l, [key]: true }))
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      console.error(err)
    }
    setLoading(l => ({ ...l, [key]: false }))
  }, [])

  if (!state) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Connecting to VMOL Protocol...</div>

  const healthColor = state.avgHealthFactor > 1.5 ? 'var(--success)' : state.avgHealthFactor > 1.2 ? 'var(--warning)' : 'var(--danger)'
  const ethDropPct = ((2000 - state.ethPrice) / 2000 * 100)

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700 }}>
            <span style={{ color: 'var(--accent)' }}>VMOL</span> Protocol
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>AI Risk Governor — Autonomous Lending Parameter Optimization</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '20px', background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)' }}>
            Starknet Sepolia · LIVE
          </span>
          {contracts && (
            <>
              <a href={contracts.poolUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '20px', background: 'var(--accent-dim)', color: 'var(--accent)', textDecoration: 'none' }}>
                Pool ↗
              </a>
              <a href={contracts.governorUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '20px', background: 'var(--accent-dim)', color: 'var(--accent)', textDecoration: 'none' }}>
                Governor ↗
              </a>
            </>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <MetricCard label="ETH Price" value={`$${state.ethPrice.toFixed(0)}`} sub={`${ethDropPct > 0 ? '-' : '+'}${Math.abs(ethDropPct).toFixed(1)}% vs baseline`} color={ethDropPct > 5 ? 'var(--danger)' : 'var(--text-primary)'} />
        <MetricCard label="LTV" value={`${(state.ltv * 100).toFixed(1)}%`} sub={`bounds: 50-85%`} color="var(--accent)" />
        <MetricCard label="Liq. Threshold" value={`${(state.liqThreshold * 100).toFixed(1)}%`} sub={`bounds: 60-90%`} color="var(--accent)" />
        <MetricCard label="Health Factor" value={state.avgHealthFactor.toFixed(3)} sub={`min: ${state.minHealthFactor.toFixed(3)}`} color={healthColor} />
        <MetricCard label="Utilization" value={`${(state.utilizationRate * 100).toFixed(1)}%`} sub={`$${(state.totalBorrows/1000).toFixed(0)}k / ${state.totalDeposits.toFixed(0)} ETH`} />
        <MetricCard label="Liquidations" value={state.nLiquidations} sub={`bad debt: $${state.badDebt.toFixed(0)}`} color={state.nLiquidations > 0 ? 'var(--danger)' : 'var(--success)'} />
        <MetricCard label="Active Users" value={state.nActiveUsers} sub={`${state.guardUpdateCount} agent updates`} />
      </div>

      {/* Main Content: 2 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1rem' }}>
        {/* Left: Agent Log */}
        <div style={{ ...METRIC_STYLE, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '500px' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Agent Reasoning Log</span>
            <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{logs.length} events</span>
          </div>
          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', minHeight: '300px' }}>
            {logs.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No events yet. Trigger the agent or simulate a market event.
              </div>
            )}
            {logs.map((log, i) => <LogEntry key={i} log={log} />)}
          </div>
        </div>

        {/* Right: Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Agent trigger */}
          <div style={{ ...METRIC_STYLE }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.75rem' }}>Agent Control</div>
            <SimButton label="Trigger Agent" onClick={() => apiCall('/api/agent/trigger', 'agent')} color="var(--accent)" loading={loading.agent} />
          </div>

          {/* Market Simulation */}
          <div style={{ ...METRIC_STYLE }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.75rem' }}>Market Simulation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <SimButton label="ETH Crash -10%" onClick={() => apiCall('/api/cheat/crash', 'crash10', { pct: 10 })} color="#dc2626" loading={loading.crash10} />
              <SimButton label="ETH Crash -20%" onClick={() => apiCall('/api/cheat/crash', 'crash20', { pct: 20 })} color="#991b1b" loading={loading.crash20} />
              <SimButton label="ETH Pump +10%" onClick={() => apiCall('/api/cheat/pump', 'pump10', { pct: 10 })} color="#16a34a" loading={loading.pump10} />
              <SimButton label="ETH Pump +20%" onClick={() => apiCall('/api/cheat/pump', 'pump20', { pct: 20 })} color="#15803d" loading={loading.pump20} />
              <SimButton label="Reset Pool" onClick={() => apiCall('/api/cheat/reset', 'reset')} color="#4b5563" loading={loading.reset} />
            </div>
          </div>

          {/* Full Demo */}
          <div style={{ ...METRIC_STYLE }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.75rem' }}>Demo Sequence</div>
            <SimButton label="Full Crash Demo" onClick={() => apiCall('/api/demo/crash', 'demo')} color="linear-gradient(135deg, #dc2626, #7c3aed)" loading={loading.demo} />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Simulates ETH crash in 5 steps. Agent reacts autonomously at each stage.
            </p>
          </div>
        </div>
      </div>

      {/* Decision History */}
      {decisions.length > 0 && (
        <div style={{ ...METRIC_STYLE, marginTop: '1rem', padding: 0 }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            Decision History ({decisions.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Action', 'LTV', 'Liq Threshold', 'Emergency', 'Status', 'TX', 'Reasoning'].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...decisions].reverse().map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(d.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: d.action === 'hold' ? 'rgba(107,114,128,0.2)' : d.action === 'adjust_emergency' ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.2)',
                        color: d.action === 'hold' ? '#9ca3af' : d.action === 'adjust_emergency' ? '#ef4444' : '#6366f1',
                      }}>{d.action}</span>
                    </td>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem' }}>
                      {d.action !== 'hold' ? `${(d.oldLtv*100).toFixed(1)}→${(d.newLtv*100).toFixed(1)}%` : `${(d.newLtv*100).toFixed(1)}%`}
                    </td>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem' }}>
                      {d.action !== 'hold' ? `${(d.oldLiqThreshold*100).toFixed(1)}→${(d.newLiqThreshold*100).toFixed(1)}%` : `${(d.newLiqThreshold*100).toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      {d.isEmergency && <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>YES</span>}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span style={{ color: d.accepted ? 'var(--success)' : 'var(--danger)', fontSize: '0.75rem' }}>
                        {d.accepted ? 'ACCEPTED' : 'REJECTED'}
                      </span>
                    </td>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem' }}>
                      {d.voyagerUrl ? (
                        <a href={d.voyagerUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                          {d.txHash.slice(0, 6)}...{d.txHash.slice(-4)} ↗
                        </a>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.reasoning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
