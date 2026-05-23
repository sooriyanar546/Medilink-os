'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, Activity, TrendingDown, TrendingUp, Cpu, HeartPulse, BrainCircuit, Users, Navigation, Flame, Zap, CheckCircle2, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { useHospitalStore } from '@/store/useHospitalStore';

export default function AdminMode() {
  const { adminMetrics, initializePusher, queue, loadQueue } = useHospitalStore();
  const [currentTime, setCurrentTime] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [billingClaims, setBillingClaims] = useState([]);
  const [isLoadingClaims, setIsLoadingClaims] = useState(true);
  const [isSimulatingClaim, setIsSimulatingClaim] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);

  const fetchClaims = async () => {
    try {
      const res = await fetch('/api/billing-claims');
      const data = await res.json();
      if (Array.isArray(data)) setBillingClaims(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingClaims(false);
    }
  };

  const simulateClaim = async () => {
    setIsSimulatingClaim(true);
    try {
      const mockNote = {
        subjective: "Patient complains of severe chest pain radiating to the left arm.",
        objective: "BP 160/100. HR 115.",
        assessment: "Suspected Myocardial Infarction.",
        plan: "Admit to ICU immediately. Start aspirin and arrange for angiography."
      };
      const res = await fetch('/api/billing-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          visitId: `sim_visit_${Date.now()}`, 
          clinicalNoteOverride: mockNote, 
          amount: 8500, 
          tpaName: 'National Health Insurance' 
        })
      });
      const data = await res.json();
      if (data.success) {
        setBillingClaims(prev => [data.billingClaim, ...prev]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSimulatingClaim(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await fetch('/api/audit');
      const data = await res.json();
      if (Array.isArray(data)) setAuditLogs(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    initializePusher();
    fetchClaims();
    fetchAuditLogs();
    loadQueue();
    const interval = setInterval(() => {
      loadQueue();
      fetchAuditLogs();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const waitingCount = queue.filter(v => v.status === 'WAITING').length;
  const isBottleneck = waitingCount > 2;

  const triggerSms = async () => {
    setIsSendingMessage(true);
    try {
      await fetch('/api/messages/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: 'pt_michael_chen',
          content: "Hi Michael, this is MediLink. Dr. Patel is running slightly behind due to an unexpected emergency. Your wait time is now approximately 25 mins. We appreciate your patience!",
          channel: 'WHATSAPP'
        })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setIsSendingMessage(false), 1000);
    }
  };

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={24} color="var(--color-primary)" /> Hospital Mission Control
          </h1>
          <p className="page-description">
            Live operational nervous system • {currentTime}
          </p>
        </div>
        
        {/* Global System Health Indicator */}
        <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '8px 16px', borderRadius: '50px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Activity size={16} color="#166534" />
            <span style={{ fontSize: 'var(--font-size-sm)', color: '#14532d', fontWeight: 600 }}>System Risk: LOW (12%)</span>
          </div>
          <div style={{ width: '1px', height: '20px', backgroundColor: '#bbf7d0' }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HeartPulse size={16} color="#059669" />
            <span style={{ fontSize: 'var(--font-size-sm)', color: '#065f46', fontWeight: 600 }}>Global Experience: 92/100</span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: '2fr 1.5fr', gap: 'var(--space-6)' }}>
        
        {/* Left Column: Awareness Map & Experience Engine */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          {/* Real-Time Operational Awareness Map */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: 'var(--space-4)', marginBottom: 0, backgroundColor: 'var(--color-surface-hover)', borderBottom: 'var(--border-light)' }}>
              <div className="card-title"><Navigation size={18} style={{ marginRight: '8px' }} /> Real-Time Awareness Map</div>
            </div>
            <div style={{ padding: 'var(--space-4)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
              
              {/* Department Block: OPD */}
              <div style={{ border: isBottleneck ? '2px solid #fca5a5' : '1px solid var(--border-light)', backgroundColor: isBottleneck ? '#fef2f2' : 'transparent', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: isBottleneck ? '#991b1b' : 'inherit' }}>OPD Block A</span>
                  <span className={`badge ${isBottleneck ? 'badge-danger' : 'badge-success'}`}>{isBottleneck ? 'High Stress' : 'Stable'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isBottleneck ? '#b91c1c' : 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                  <Users size={14} /> {waitingCount} Waiting • 1 Doctor
                </div>
                {isBottleneck && (
                  <div style={{ position: 'absolute', top: '-10px', right: '-10px', backgroundColor: '#ef4444', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)' }}>
                    <Flame size={14} />
                  </div>
                )}
              </div>

              {/* Department Block: Radiology (Bottleneck) */}
              <div style={{ border: '2px solid #fca5a5', backgroundColor: '#fef2f2', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: '#991b1b' }}>Radiology</span>
                  <span className="badge badge-danger">High Stress</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b91c1c', fontSize: 'var(--font-size-xs)' }}>
                  <Users size={14} /> 22 Patients • 45m Avg Wait
                </div>
                {/* Flame icon for emotional stress hotspot */}
                <div style={{ position: 'absolute', top: '-10px', right: '-10px', backgroundColor: '#ef4444', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)' }}>
                  <Flame size={14} />
                </div>
              </div>

              {/* Department Block: Pharmacy (Autonomously Fixing) */}
              <div style={{ border: '2px solid #bae6fd', backgroundColor: '#f0f9ff', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: '#0369a1' }}>Pharmacy</span>
                  <span className="badge badge-info" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={10} /> Auto-Scaling</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0284c7', fontSize: 'var(--font-size-xs)' }}>
                  <Users size={14} /> Surge Predicted (+3 Staff)
                </div>
              </div>

            </div>
          </div>

          {/* Revenue Protection & Claim Intelligence */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={18} color="#0284c7" /> Revenue Protection & AI Claims
              </div>
              <button className="btn btn-outline" onClick={simulateClaim} disabled={isSimulatingClaim} style={{ fontSize: '12px', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isSimulatingClaim ? <RefreshCw size={12} className="animate-spin" /> : <BrainCircuit size={12} />}
                Simulate AI Audit
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {isLoadingClaims && billingClaims.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-4)' }}>Loading claims...</div>
              ) : billingClaims.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-4)' }}>No flagged claims. Click simulate to test AI auditor.</div>
              ) : (
                billingClaims.slice(0, 3).map((claim) => (
                  <div key={claim.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', backgroundColor: claim.rejectionRisk > 30 ? '#fff1f2' : 'white', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}>Claim #{claim.id.slice(-6).toUpperCase()} • {claim.tpaName}</div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>{claim.visit?.patient?.name || 'Unknown Patient'} • ${claim.amount}</div>
                      </div>
                      <div className={`badge ${claim.rejectionRisk > 30 ? 'badge-danger' : 'badge-success'}`}>
                        Risk: {claim.rejectionRisk}%
                      </div>
                    </div>
                    
                    {claim.missingDocs && claim.missingDocs.length > 0 && (
                      <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: '4px', border: '1px solid #fecdd3' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#be123c', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={12} /> MISSING DOCUMENTATION DETECTED
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#9f1239' }}>
                          {claim.missingDocs.map((doc, idx) => <li key={idx}>{doc}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Experience Operations Engine */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="card-title">Experience Operations Engine</div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', paddingBottom: 'var(--space-4)', borderBottom: 'var(--border-light)' }}>
                <div style={{ backgroundColor: '#fee2e2', padding: '8px', borderRadius: '8px', color: '#dc2626' }}>
                  <Flame size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Frustration Spike Detected: Radiology Waiting</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Just now</span>
                  </div>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                    Sentiment analysis on patient app interactions shows rising anxiety. 3 patients have repeatedly checked queue status in the last 5 minutes.
                  </p>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                    <button className="btn btn-outline" style={{ fontSize: '12px', padding: '4px 10px', color: '#dc2626', borderColor: '#fca5a5' }}>Dispatch Floor Manager</button>
                    <button 
                      className="btn btn-primary" 
                      style={{ fontSize: '12px', padding: '4px 10px', opacity: isSendingMessage ? 0.7 : 1 }}
                      onClick={triggerSms}
                      disabled={isSendingMessage}
                    >
                      {isSendingMessage ? 'Sending...' : 'Auto-Send Reassurance SMS'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <div style={{ backgroundColor: '#f3f4f6', padding: '8px', borderRadius: '8px', color: '#4b5563' }}>
                  <Activity size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>Communication Breakdown Risk: Discharge</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>15 mins ago</span>
                  </div>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                    TPA approval delays are causing discharge instructions to bottleneck. Experience score dropping from 95 to 88.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Immutable Audit Trail */}
          <div className="card" style={{ marginTop: 'var(--space-6)', backgroundColor: '#f8fafc' }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155' }}>
                <ShieldAlert size={18} /> Immutable Audit Trail
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
              {auditLogs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-4)' }}>No logs captured yet.</div>
              ) : (
                auditLogs.map((log) => (
                  <div key={log.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '3px solid #64748b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{log.action}</span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#475569' }}>
                      <span style={{ fontWeight: 500 }}>{log.userName}</span> ({log.role}) accessed patient data.
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Right Column: Autonomous Orchestration & Finance */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          {/* Autonomous Flow Orchestrator */}
          <div className="card" style={{ border: '2px solid var(--color-primary-light)', background: 'linear-gradient(to bottom, #f0f9ff, #ffffff)' }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="card-title">
                <BrainCircuit color="var(--color-primary)" size={20} style={{ marginRight: '8px' }} />
                Autonomous Orchestrator
              </div>
              <span className="badge badge-primary" style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>ACTIVE</span>
            </div>
            
            <div style={{ backgroundColor: 'white', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>System Analysis</span>
                {isBottleneck ? (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} /> Action Required</span>
                ) : (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12} /> Optimal Flow</span>
                )}
              </div>
              <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-main)', marginBottom: '8px' }}>
                Dynamic Staff Redistribution
              </p>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {isBottleneck 
                  ? `Predicted severe bottleneck in OPD Block A due to ${waitingCount} waiting patients. System autonomously recommends reassigning 1 Triage Nurse to assist Dr. Sarah Jenkins.` 
                  : `Current consultation velocity matches queue length. No staff reallocation required at this time.`}
              </p>
              {isBottleneck && (
                <button className="btn btn-outline" style={{ marginTop: '8px', width: '100%', fontSize: '12px' }}>Approve Reallocation</button>
              )}
            </div>
          </div>

          {/* Revenue Leakage (Pre-emptive) */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ fontSize: 'var(--font-size-sm)' }}>
                <ShieldAlert color="var(--color-text-muted)" size={16} style={{ marginRight: '8px' }} />
                Pre-Emptive Claim Correction
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              
              <div style={{ backgroundColor: '#fefce8', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid #fef08a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: '#854d0e' }}>PT-9912 • MRI Brain</span>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: '#a16207' }}>₹12,500 Risk</span>
                </div>
                <p style={{ fontSize: 'var(--font-size-xs)', color: '#a16207', marginBottom: '8px' }}>
                  System flagged future rejection risk: "Clinical justification insufficient for contrast MRI" based on TPA's historical denial patterns.
                </p>
                <button className="btn btn-outline" style={{ width: '100%', fontSize: '12px', borderColor: '#ca8a04', color: '#854d0e', padding: '4px' }}>Send to Doctor for Addendum</button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>"Nothing Unpaid" Guarantee</span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)', fontWeight: 600 }}>₹{adminMetrics.revenueProtected.toLocaleString()} Protected Today</span>
              </div>

            </div>
          </div>

        </div>
      </div>
    </>
  );
}
