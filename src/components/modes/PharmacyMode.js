'use client';

import React, { useState, useEffect } from 'react';
import { Pill, CheckCircle2, Clock, AlertTriangle, PackageOpen, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHospitalStore } from '@/store/useHospitalStore';
import { triggerNativeHaptic } from '@/lib/native';

export default function PharmacyMode() {
  const { showToast } = useHospitalStore();
  const [prescriptions, setPrescriptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

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

                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  {note.pharmacyStatus === 'PENDING' && (
                    <button onClick={() => updateStatus(note.id, 'PREPARING')} className="btn btn-outline" style={{ flex: 1 }}>Start Preparing</button>
                  )}
                  {note.pharmacyStatus === 'PREPARING' && (
                    <button onClick={() => updateStatus(note.id, 'READY')} className="btn btn-primary" style={{ flex: 1 }}>Mark as Ready</button>
                  )}
                  {note.pharmacyStatus === 'READY' && (
                    <button onClick={() => updateStatus(note.id, 'DISPENSED')} className="btn btn-outline" style={{ flex: 1, backgroundColor: '#f1f5f9' }}>Dispense to Patient</button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
