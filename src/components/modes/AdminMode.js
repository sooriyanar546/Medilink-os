'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, Activity, TrendingDown, TrendingUp, Cpu, HeartPulse, BrainCircuit, Users, Navigation, Flame, Zap, CheckCircle2, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { useHospitalQueue } from '@/hooks/useHospitalQueue';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useHospitalStore } from '@/store/useHospitalStore';
import { motion, AnimatePresence } from 'framer-motion';

export default function AdminMode() {
  const { queue } = useHospitalQueue();
  const { adminMetrics } = useOperationalMetrics();
  const [currentTime, setCurrentTime] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [billingClaims, setBillingClaims] = useState([]);
  const [isLoadingClaims, setIsLoadingClaims] = useState(true);
  const [isSimulatingClaim, setIsSimulatingClaim] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [remediatedRooms, setRemediatedRooms] = useState({});

  const handleDispatchRemediation = (roomName) => {
    const showToast = useHospitalStore.getState().showToast;
    showToast(`Floor Manager support en route to ${roomName}! Staff notified via automated WhatsApp.`, "success");
    setRemediatedRooms(prev => ({ ...prev, [roomName]: true }));
    triggerSms(); // Send warning/reassurance SMS through SMS API
  };

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
    fetchClaims();
    fetchAuditLogs();
    const interval = setInterval(() => {
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
              <div className="card-title"><Navigation size={18} style={{ marginRight: '8px' }} /> Interactive Clinic Awareness & Floor Map</div>
            </div>
            
            <div style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }} className="triage-grid">
                {/* SVG Blueprint */}
                <div style={{ position: 'relative' }}>
                  <svg viewBox="0 0 500 300" style={{ width: '100%', height: 'auto', backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b' }}>
                    {/* Hallways and grid markings for blueprint look */}
                    <defs>
                      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(30, 41, 59, 0.4)" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                    
                    {/* Hallway divider line */}
                    <line x1="10" y1="140" x2="490" y2="140" stroke="#1e293b" strokeWidth="4" strokeDasharray="5,5" />
                    
                    {/* Triage Station */}
                    <g style={{ cursor: 'pointer' }} onClick={() => setSelectedRoom('Triage Station')}>
                      <rect 
                        x="20" y="20" width="130" height="100" rx="8" 
                        fill={selectedRoom === 'Triage Station' ? '#1e293b' : '#111827'} 
                        stroke={remediatedRooms['Triage Station'] ? '#10b981' : '#334155'} 
                        strokeWidth={selectedRoom === 'Triage Station' ? '3' : '1.5'} 
                      />
                      <circle cx="35" cy="35" r="5" fill="#10b981" />
                      <text x="50" y="40" fill="#94a3b8" fontSize="10" fontWeight="700">TRIAGE ROOM</text>
                      <text x="35" y="70" fill="white" fontSize="12" fontWeight="600">{queue.length > 0 ? 1 : 0} Waiting</text>
                      <text x="35" y="90" fill="#64748b" fontSize="9">NP Lopez</text>
                    </g>
                    
                    {/* Consultation Room 402 */}
                    <g style={{ cursor: 'pointer' }} onClick={() => setSelectedRoom('Consultation Room 402')}>
                      <rect 
                        x="170" y="20" width="150" height="100" rx="8" 
                        fill={selectedRoom === 'Consultation Room 402' ? '#1e293b' : '#111827'} 
                        stroke="#10b981" 
                        strokeWidth={selectedRoom === 'Consultation Room 402' ? '3' : '1.5'} 
                      />
                      <circle cx="185" cy="35" r="5" fill="#10b981" />
                      <text x="200" y="40" fill="#94a3b8" fontSize="10" fontWeight="700">ROOM 402 (CONSULT)</text>
                      <text x="185" y="70" fill="white" fontSize="12" fontWeight="600">Dr. Jenkins</text>
                      <text x="185" y="90" fill="#10b981" fontSize="9">Active Consultation</text>
                    </g>

                    {/* Consultation Room 403 (Stress Bottleneck) */}
                    <g style={{ cursor: 'pointer' }} onClick={() => setSelectedRoom('Consultation Room 403')}>
                      <rect 
                        x="340" y="20" width="140" height="100" rx="8" 
                        fill={selectedRoom === 'Consultation Room 403' ? '#1e293b' : '#111827'} 
                        stroke={remediatedRooms['Consultation Room 403'] ? '#10b981' : '#ef4444'} 
                        strokeWidth={selectedRoom === 'Consultation Room 403' ? '3' : '1.5'} 
                        style={{ filter: remediatedRooms['Consultation Room 403'] ? 'none' : 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.4))' }}
                      />
                      {/* Pulsing warning dot */}
                      <motion.circle 
                        cx="355" cy="35" r="5" 
                        fill={remediatedRooms['Consultation Room 403'] ? '#10b981' : '#ef4444'} 
                        animate={remediatedRooms['Consultation Room 403'] ? {} : { scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      />
                      <text x="370" y="40" fill="#94a3b8" fontSize="10" fontWeight="700">ROOM 403 (PATEL)</text>
                      <text x="355" y="70" fill="white" fontSize="12" fontWeight="600">{waitingCount} Delayed</text>
                      <text x="355" y="90" fill={remediatedRooms['Consultation Room 403'] ? '#10b981' : '#f87171'} fontSize="9">
                        {remediatedRooms['Consultation Room 403'] ? 'Support Dispatched' : 'Bottleneck (25m wait)'}
                      </text>
                    </g>

                    {/* Cashier Billing Desk */}
                    <g style={{ cursor: 'pointer' }} onClick={() => setSelectedRoom('Cashier Desk')}>
                      <rect 
                        x="20" y="160" width="220" height="110" rx="8" 
                        fill={selectedRoom === 'Cashier Desk' ? '#1e293b' : '#111827'} 
                        stroke={remediatedRooms['Cashier Desk'] ? '#10b981' : '#334155'} 
                        strokeWidth={selectedRoom === 'Cashier Desk' ? '3' : '1.5'} 
                      />
                      <circle cx="35" cy="175" r="5" fill="#0ea5e9" />
                      <text x="50" y="180" fill="#94a3b8" fontSize="10" fontWeight="700">CASHIER BILLING</text>
                      <text x="35" y="210" fill="white" fontSize="12" fontWeight="600">{billingClaims.filter(c => c.rejectionRisk > 30).length} High-Risk Claims</text>
                      <text x="35" y="230" fill="#64748b" fontSize="9">Officer Sharma • 3m wait</text>
                    </g>

                    {/* Pharmacy Counter (Auto-Scaling) */}
                    <g style={{ cursor: 'pointer' }} onClick={() => setSelectedRoom('Pharmacy Counter')}>
                      <rect 
                        x="260" y="160" width="220" height="110" rx="8" 
                        fill={selectedRoom === 'Pharmacy Counter' ? '#1e293b' : '#111827'} 
                        stroke={remediatedRooms['Pharmacy Counter'] ? '#10b981' : '#38bdf8'} 
                        strokeWidth={selectedRoom === 'Pharmacy Counter' ? '3' : '1.5'} 
                      />
                      <circle cx="275" cy="175" r="5" fill="#38bdf8" />
                      <text x="290" y="180" fill="#94a3b8" fontSize="10" fontWeight="700">PHARMACY DISPENSARY</text>
                      <text x="275" y="210" fill="white" fontSize="12" fontWeight="600">Surge Predicted (+3 Staff)</text>
                      <text x="275" y="230" fill="#0284c7" fontSize="9">Auto-Scaling Enabled</text>
                    </g>
                  </svg>
                  
                  {/* Blueprint label */}
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Zap size={12} color="#0ea5e9" /> Click any blueprint room to review active waiting patients & reallocate resources.
                  </div>
                </div>
                
                {/* Details side bar panel */}
                <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', color: '#94a3b8', minHeight: '260px' }}>
                  <AnimatePresence mode="wait">
                    {selectedRoom ? (
                      <motion.div 
                        key={selectedRoom}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: '8px' }}>
                          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'white', textTransform: 'uppercase' }}>{selectedRoom}</h3>
                          <span className="badge" style={{ 
                            fontSize: '9px', 
                            backgroundColor: selectedRoom.includes('403') ? (remediatedRooms[selectedRoom] ? '#065f46' : '#991b1b') : '#0369a1',
                            color: 'white',
                            padding: '2px 8px'
                          }}>
                            {selectedRoom.includes('403') ? (remediatedRooms[selectedRoom] ? 'Remediated' : 'Surge Warning') : 'Stable'}
                          </span>
                        </div>

                        {/* Room Data Breakdown */}
                        <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div>
                            <strong style={{ color: '#64748b' }}>Assigned Staff:</strong> <span style={{ color: 'white', marginLeft: '4px' }}>
                              {selectedRoom === 'Triage Station' && 'Nurse Practitioner Lopez'}
                              {selectedRoom === 'Consultation Room 402' && 'Dr. Sarah Jenkins (Palpitations consult)'}
                              {selectedRoom === 'Consultation Room 403' && 'Dr. Patel (Cardiology Specialized)'}
                              {selectedRoom === 'Cashier Desk' && 'Officer Sharma & 1 Billing Assistant'}
                              {selectedRoom === 'Pharmacy Counter' && 'Pharmacist Lee & 2 Dispensing Technicians'}
                            </span>
                          </div>
                          <div>
                            <strong style={{ color: '#64748b' }}>Queue Status:</strong> <span style={{ color: 'white', marginLeft: '4px' }}>
                              {selectedRoom === 'Triage Station' && `${queue.length > 0 ? 1 : 0} patient awaiting initial vital metrics`}
                              {selectedRoom === 'Consultation Room 402' && '1 patient active (Michael Chen)'}
                              {selectedRoom === 'Consultation Room 403' && `${waitingCount} patients awaiting consult (Emma Watson next)`}
                              {selectedRoom === 'Cashier Desk' && '1 invoice validation active'}
                              {selectedRoom === 'Pharmacy Counter' && '3 prescription packets filling'}
                            </span>
                          </div>
                          <div>
                            <strong style={{ color: '#64748b' }}>Average Wait Time:</strong> <span style={{ color: selectedRoom.includes('403') && !remediatedRooms[selectedRoom] ? '#ef4444' : 'white', fontWeight: selectedRoom.includes('403') ? 'bold' : 'normal', marginLeft: '4px' }}>
                              {selectedRoom === 'Triage Station' && '8 mins (SLA Met)'}
                              {selectedRoom === 'Consultation Room 402' && '0 mins (Direct)'}
                              {selectedRoom === 'Consultation Room 403' && (remediatedRooms[selectedRoom] ? '10 mins (Remediating)' : '25 mins (SLA Breach)')}
                              {selectedRoom === 'Cashier Desk' && '3 mins (SLA Met)'}
                              {selectedRoom === 'Pharmacy Counter' && '12 mins (SLA Met)'}
                            </span>
                          </div>
                        </div>

                        {/* Active dispatch action */}
                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.4 }}>
                            {selectedRoom.includes('403') 
                              ? (remediatedRooms[selectedRoom] ? "✓ Operations remediated. Additional support nurse assigned to guide incoming waiting patients." : "Critical alert: Queue delay detected. Reallocate resource to balance workload.")
                              : "Operational metrics clear. Continuous Pusher monitoring active."}
                          </div>
                          <button
                            onClick={() => handleDispatchRemediation(selectedRoom)}
                            disabled={remediatedRooms[selectedRoom]}
                            className={`btn ${selectedRoom.includes('403') ? 'btn-primary' : 'btn-outline'}`}
                            style={{ 
                              fontSize: '11px', 
                              padding: '8px', 
                              justifyContent: 'center',
                              backgroundColor: remediatedRooms[selectedRoom] ? '#064e3b' : (selectedRoom.includes('403') ? '#ef4444' : 'transparent'),
                              borderColor: remediatedRooms[selectedRoom] ? '#064e3b' : (selectedRoom.includes('403') ? '#ef4444' : 'var(--border-light)'),
                              color: remediatedRooms[selectedRoom] ? 'white' : (selectedRoom.includes('403') ? 'white' : 'white')
                            }}
                          >
                            {remediatedRooms[selectedRoom] ? '✓ Support Dispatched' : 'Dispatch Floor Manager Support'}
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center', color: '#64748b', fontSize: '11px' }}>
                        <Navigation size={24} style={{ marginBottom: '8px', strokeDasharray: '4', stroke: '#475569' }} />
                        Select a department room from the blueprint visualizer layout to review live wait stress, assignees, and perform administrative remediation actions.
                      </div>
                    )}
                  </AnimatePresence>
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

          {/* Clinical Performance Analytics */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp color="var(--color-primary)" size={20} />
                Clinical Performance Analytics
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Peak Check-in Hours Bar Chart */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>Peak Check-in Hours (Patient Arrival Load)</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>10 AM Peak</span>
                </div>
                <div style={{ height: '70px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 8px', borderBottom: '2px solid #e2e8f0', gap: '8px' }}>
                  {[
                    { hr: '8a', val: 30 },
                    { hr: '10a', val: 95 },
                    { hr: '12p', val: 65 },
                    { hr: '2p', val: 40 },
                    { hr: '4p', val: 75 },
                    { hr: '6p', val: 50 }
                  ].map((d, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <motion.div 
                        initial={{ height: 0 }}
                        animate={{ height: `${d.val}%` }}
                        transition={{ duration: 1, delay: i * 0.1 }}
                        style={{ 
                          width: '100%', 
                          maxHeight: '50px',
                          backgroundColor: d.val > 80 ? '#ef4444' : d.val > 60 ? '#f59e0b' : 'var(--color-primary)', 
                          borderRadius: '4px 4px 0 0',
                          position: 'relative'
                        }}
                        title={`${d.val}% load`}
                      />
                      <span style={{ fontSize: '9px', color: '#64748b', fontWeight: 'bold' }}>{d.hr}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Wait Time Trends Line Area Chart */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>Wait Time Trends (Weekly Avg)</span>
                  <span style={{ color: '#16a34a', fontWeight: 'bold' }}>-15% Improvement</span>
                </div>
                <div style={{ position: 'relative', height: '65px', borderBottom: '2px solid #e2e8f0', borderLeft: '2px solid #e2e8f0', paddingLeft: '8px' }}>
                  {/* Clean SVG Area Line Chart */}
                  <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0 45 Q 20 20, 40 30 T 80 10 T 100 15 L 100 50 L 0 50 Z"
                      fill="url(#areaGrad)"
                    />
                    <path
                      d="M0 45 Q 20 20, 40 30 T 80 10 T 100 15"
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth="2"
                    />
                    {/* Pulsing target node */}
                    <circle cx="80" cy="10" r="3" fill="#ef4444" />
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#64748b', marginTop: '2px', fontWeight: 600 }}>
                    <span>Mon</span>
                    <span>Wed</span>
                    <span>Fri</span>
                    <span>Sun</span>
                  </div>
                </div>
              </div>

              {/* Doctor Utilization & Sentiment Analytics Donut Chart */}
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#10b981" strokeWidth="3" 
                            strokeDasharray="78 22" strokeDashoffset="0" />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', color: '#065f46' }}>
                    78%
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)' }}>Doctor Utilization Index</span>
                  <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', margin: 0 }}>
                    Optimal workload threshold. Clinical burnout risk is stable (low stress signals).
                  </p>
                </div>
              </div>
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
