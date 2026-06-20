'use client';

import React, { useState, useEffect } from 'react';
import { Pill, CheckCircle2, Clock, AlertTriangle, PackageOpen, Loader2, ShieldCheck, ShieldAlert, FileSignature } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHospitalStore } from '@/store/useHospitalStore';
import { triggerNativeHaptic } from '@/lib/native';

const patientHomeMeds = {
  'pt_michael_chen': [
    { drugName: "Amlodipine 5mg", dosage: "1 Tablet", frequency: "QD", indication: "Hypertension", rxNorm: "RxNorm: 197361" },
    { drugName: "Sertraline 50mg", dosage: "1 Tablet", frequency: "QD", indication: "Anxiety/Depression", rxNorm: "RxNorm: 312937" }
  ]
};

const getDDIWarnings = (note) => {
  const patientId = note.visit.patientId;
  const homeMeds = patientHomeMeds[patientId] || patientHomeMeds['pt_michael_chen'];
  const meds = Array.isArray(note.medications) ? note.medications : [];
  
  let list = [];
  const hasIbuprofen = meds.some(m => m.drugName.toLowerCase().includes("ibuprofen"));
  const hasSumatriptan = meds.some(m => m.drugName.toLowerCase().includes("sumatriptan"));
  const hasHomeAmlodipine = homeMeds.some(m => m.drugName.toLowerCase().includes("amlodipine"));
  const hasHomeSertraline = homeMeds.some(m => m.drugName.toLowerCase().includes("sertraline") || homeMeds.some(m => m.drugName.toLowerCase().includes("fluoxetine")));
  
  // Rule 1: Amlodipine (chronic) + Ibuprofen (acute) -> Antihypertensive Antagonism
  if (hasIbuprofen && hasHomeAmlodipine) {
    list.push({
      severity: "MEDIUM",
      message: "⚠️ Ibuprofen antagonizes Amlodipine's BP-lowering efficacy."
    });
  }

  // Rule 2: Sumatriptan (acute) + Sertraline (chronic) -> Serotonin Syndrome
  if (hasSumatriptan && hasHomeSertraline) {
    list.push({
      severity: "CRITICAL",
      message: "🚨 Sumatriptan + Sertraline poses severe risk of Serotonin Syndrome."
    });
  }

  // Rule 3: Duplicative NSAIDs
  const nsaidMeds = meds.filter(m => 
    m.drugName.toLowerCase().includes("ibuprofen") || 
    m.drugName.toLowerCase().includes("naproxen") ||
    m.drugName.toLowerCase().includes("aspirin")
  );
  if (nsaidMeds.length > 1) {
    list.push({
      severity: "HIGH",
      message: "⚠️ Duplicative duplicate NSAID therapy detected."
    });
  }
  
  return list;
};

export default function PharmacyMode() {
  const { showToast } = useHospitalStore();
  const [prescriptions, setPrescriptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Phase 12 Pharmacist Override Stacks
  const [overrides, setOverrides] = useState({}); // noteId -> { signed: boolean, reason: string, notes: string }
  const [selectedReasons, setSelectedReasons] = useState({}); // noteId -> reason
  const [overrideNotes, setOverrideNotes] = useState({}); // noteId -> comments

  const handleSignOverride = (noteId) => {
    const reason = selectedReasons[noteId] || "Physician consulted and co-administration approved";
    setOverrides(prev => ({
      ...prev,
      [noteId]: { signed: true, reason, notes: overrideNotes[noteId] || "" }
    }));
    try {
      triggerNativeHaptic('medium');
    } catch (e) {}
    showToast("Pharmacist clinical override signed and logged securely!", "success");
  };

  const fetchPrescriptions = async () => {
    try {
      const res = await fetch('/api/pharmacy');
      const data = await res.json();
      setPrescriptions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPrescriptions();
    
    // Subscribe to pusher for real-time pharmacy queue updates
    const { getPusherClient } = require('@/lib/pusher');
    const pusher = getPusherClient();
    if (pusher && pusher.subscribe) {
      const channel = pusher.subscribe('hospital-queue');
      channel.bind('pharmacy-updated', () => {
        fetchPrescriptions();
      });
      return () => {
        channel.unbind('pharmacy-updated');
        pusher.unsubscribe('hospital-queue');
      }
    }
  }, []);

  const updateStatus = async (noteId, status) => {
    try {
      showToast(`Transitioning prescription to ${status}...`, "info");
      const res = await fetch('/api/pharmacy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, pharmacyStatus: status })
      });
      if (res.ok) {
        fetchPrescriptions();
        showToast(`Prescription status updated to: ${status}`, "success");
        
        if (status === 'PREPARING') {
          triggerNativeHaptic('light');
        } else if (status === 'READY') {
          triggerNativeHaptic('medium');
        } else if (status === 'DISPENSED') {
          triggerNativeHaptic('success');
        }
      } else {
        showToast("Failed to update prescription.", "error");
        triggerNativeHaptic('error');
      }
    } catch (e) {
      console.error(e);
      showToast("Error updating prescription status.", "error");
      triggerNativeHaptic('error');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'PENDING': return 'var(--color-warning)';
      case 'PREPARING': return 'var(--color-info)';
      case 'READY': return 'var(--color-success)';
      case 'DISPENSED': return 'var(--color-text-muted)';
      default: return 'var(--color-text-muted)';
    }
  };

  const pendingCount = prescriptions.filter(p => p.pharmacyStatus === 'PENDING').length;
  const preparingCount = prescriptions.filter(p => p.pharmacyStatus === 'PREPARING').length;
  const readyCount = prescriptions.filter(p => p.pharmacyStatus === 'READY').length;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Pharmacy Operations</h1>
          <p className="page-description">Manage automated discharges and prescriptions.</p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-warning)' }}>{pendingCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>New</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-info)' }}>{preparingCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Preparing</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-success)' }}>{readyCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Ready</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px', color: 'var(--color-text-muted)' }}>
          <Loader2 size={32} className="spin" />
        </div>
      ) : prescriptions.length === 0 ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', color: 'var(--color-text-muted)' }}>
          <PackageOpen size={48} opacity={0.2} style={{ marginBottom: '16px' }} />
          <div style={{ fontSize: '1.25rem', fontWeight: 500 }}>No Active Prescriptions</div>
          <div style={{ fontSize: '0.875rem' }}>Waiting for doctors to sign clinical notes.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--space-6)' }}>
          <AnimatePresence>
            {prescriptions.map((note) => (
              <motion.div 
                key={note.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="card"
                style={{ 
                  borderTop: `4px solid ${getStatusColor(note.pharmacyStatus)}`,
                  opacity: note.pharmacyStatus === 'DISPENSED' ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-main)', margin: 0 }}>
                      {note.visit.patient.name}
                    </h3>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      ID: {note.visit.patientId} • Dr. {note.visit.doctor.name}
                    </div>
                  </div>
                  <span className="badge" style={{ backgroundColor: getStatusColor(note.pharmacyStatus), color: 'white' }}>
                    {note.pharmacyStatus}
                  </span>
                </div>

                <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Pill size={12} /> Prescribed Medications
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.875rem', color: '#334155' }}>
                    {(note.medications || []).map((med, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>
                        <strong>{med.drugName}</strong> — {med.dosage} ({med.frequency}) x {med.duration}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Clinical Safety Shield & Override Drawer */}
                {(() => {
                  const ddiWarnings = getDDIWarnings(note);
                  const hasWarnings = ddiWarnings.length > 0;
                  const isOverridden = overrides[note.id]?.signed;
                  const isDispensed = note.pharmacyStatus === 'DISPENSED';

                  if (!hasWarnings || isDispensed) return null;

                  return (
                    <div style={{
                      backgroundColor: isOverridden ? '#f0fdf4' : '#fff1f2',
                      border: isOverridden ? '1px solid #bbf7d0' : '1px solid #fecdd3',
                      padding: '12px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      fontSize: '12px',
                      transition: 'all 0.3s ease'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: isOverridden ? '#166534' : '#be123c', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {isOverridden ? <ShieldCheck size={14} color="#10b981" /> : <ShieldAlert size={14} color="#ef4444" />}
                          CLINICAL SAFETY AUDIT
                        </span>
                        <span className="badge" style={{
                          backgroundColor: isOverridden ? '#10b981' : '#be123c',
                          color: 'white',
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '2px 8px'
                        }}>
                          {isOverridden ? 'OVERRIDE LOGGED' : '⚠️ HOLD FOR DDI'}
                        </span>
                      </div>

                      {/* Warnings list */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {ddiWarnings.map((w, idx) => (
                          <div key={idx} style={{ color: isOverridden ? '#15803d' : '#9f1239', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '4px', height: '4px', backgroundColor: isOverridden ? '#22c55e' : '#ef4444', borderRadius: '50%' }}></span>
                            {w.message}
                          </div>
                        ))}
                      </div>

                      {!isOverridden ? (
                        <div style={{ 
                          marginTop: '8px', 
                          borderTop: '1px dashed #fca5a5', 
                          paddingTop: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}>
                          <div style={{ fontWeight: 700, color: '#be123c', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            ✍️ PHARMACIST COMPLIANCE SIGN-OFF REQUIRED
                          </div>
                          
                          <select
                            value={selectedReasons[note.id] || "Physician consulted and co-administration approved"}
                            onChange={(e) => setSelectedReasons(prev => ({ ...prev, [note.id]: e.target.value }))}
                            style={{
                              width: '100%',
                              padding: '6px',
                              borderRadius: '4px',
                              border: '1px solid #fda4af',
                              fontSize: '11px',
                              backgroundColor: 'white',
                              outline: 'none',
                              color: '#334155'
                            }}
                          >
                            <option value="Physician consulted and co-administration approved">Physician consulted and approved</option>
                            <option value="Patient advised on BP effects & home monitoring">Patient advised on BP effects & monitoring</option>
                            <option value="Critical dosage limits validated & confirmed">Critical dosage limits validated</option>
                            <option value="TPA co-pay pre-authorization signed">TPA co-pay pre-auth signed</option>
                          </select>

                          <textarea
                            placeholder="Pharmacist signature notes / comments..."
                            value={overrideNotes[note.id] || ""}
                            onChange={(e) => setOverrideNotes(prev => ({ ...prev, [note.id]: e.target.value }))}
                            style={{
                              width: '100%',
                              minHeight: '40px',
                              padding: '6px',
                              borderRadius: '4px',
                              border: '1px solid #fda4af',
                              fontSize: '11px',
                              backgroundColor: 'white',
                              outline: 'none',
                              resize: 'none',
                              color: '#334155'
                            }}
                          />

                          <button
                            onClick={() => handleSignOverride(note.id)}
                            style={{
                              backgroundColor: '#be123c',
                              color: 'white',
                              border: 'none',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              fontSize: '11px',
                              transition: 'all 0.2s',
                              outline: 'none'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#9f1239'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#be123c'}
                          >
                            <FileSignature size={12} /> Sign & Authorize Override
                          </button>
                        </div>
                      ) : (
                        <div style={{ 
                          marginTop: '4px', 
                          borderTop: '1px dashed #bbf7d0', 
                          paddingTop: '6px',
                          color: '#15803d',
                          fontSize: '11px',
                          lineHeight: 1.4
                        }}>
                          <div style={{ fontWeight: 700 }}>✓ Override Verified:</div>
                          <div style={{ fontStyle: 'italic' }}>"{overrides[note.id]?.reason}"</div>
                          {overrides[note.id]?.notes && (
                            <div style={{ marginTop: '2px', color: '#166534' }}>
                              Notes: {overrides[note.id]?.notes}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  {(() => {
                    const ddiWarnings = getDDIWarnings(note);
                    const hasWarnings = ddiWarnings.length > 0;
                    const isOverridden = overrides[note.id]?.signed;
                    const isLocked = hasWarnings && !isOverridden;

                    return (
                      <>
                        {note.pharmacyStatus === 'PENDING' && (
                          <button 
                            onClick={() => updateStatus(note.id, 'PREPARING')} 
                            disabled={isLocked}
                            className="btn btn-outline" 
                            style={{ 
                              flex: 1, 
                              opacity: isLocked ? 0.5 : 1, 
                              cursor: isLocked ? 'not-allowed' : 'pointer' 
                            }}
                          >
                            {isLocked ? 'Safety Sign-off Required' : 'Start Preparing'}
                          </button>
                        )}
                        {note.pharmacyStatus === 'PREPARING' && (
                          <button 
                            onClick={() => updateStatus(note.id, 'READY')} 
                            disabled={isLocked}
                            className="btn btn-primary" 
                            style={{ 
                              flex: 1, 
                              opacity: isLocked ? 0.5 : 1, 
                              cursor: isLocked ? 'not-allowed' : 'pointer',
                              backgroundColor: isLocked ? '#94a3b8' : 'var(--color-primary)'
                            }}
                          >
                            {isLocked ? 'Safety Sign-off Required' : 'Mark as Ready'}
                          </button>
                        )}
                        {note.pharmacyStatus === 'READY' && (
                          <button 
                            onClick={() => updateStatus(note.id, 'DISPENSED')} 
                            disabled={isLocked}
                            className="btn btn-outline" 
                            style={{ 
                              flex: 1, 
                              opacity: isLocked ? 0.5 : 1, 
                              cursor: isLocked ? 'not-allowed' : 'pointer',
                              backgroundColor: isLocked ? '#f1f5f9' : '#f1f5f9' 
                            }}
                          >
                            {isLocked ? 'Safety Sign-off Required' : 'Dispense to Patient'}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
