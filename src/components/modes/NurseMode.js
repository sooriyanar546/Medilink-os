'use client';

import React, { useState, useEffect } from 'react';
import { useHospitalQueue } from '@/hooks/useHospitalQueue';
import { useHospitalStore } from '@/store/useHospitalStore';
import { Activity, HeartPulse, Thermometer, Droplet, User, CheckCircle2, ChevronRight, Loader2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { triggerNativeHaptic } from '@/lib/native';

export default function NurseMode() {
  const { queue, loadQueue, isLoadingQueue } = useHospitalQueue();
  const { showToast } = useHospitalStore();
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vitals, setVitals] = useState({ bp: '', hr: '', temp: '', spo2: '' });

  const waitingPatients = queue.filter(v => v.status === 'waiting' && !v.vitals);

  const handleSelectPatient = (patient) => {
    setSelectedPatient(patient);
    setVitals({ bp: '', hr: '', temp: '', spo2: '' });
    triggerNativeHaptic('light');
  };

  const handleSaveVitals = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/visits/${selectedPatient.visitId}/vitals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vitals),
      });
      if (res.ok) {
        setSelectedPatient(null);
        loadQueue(); // Refresh to remove them from the 'Needs Vitals' list
        showToast("Triage vitals captured successfully!", "success");
        triggerNativeHaptic('success');
      } else {
        showToast("Failed to save vitals.", "error");
        triggerNativeHaptic('error');
      }
    } catch (err) {
      console.error(err);
      showToast("Error updating patient vitals.", "error");
      triggerNativeHaptic('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="triage-grid">
      
      {/* LEFT: Intake Queue */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="card-header" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="card-title">Pending Vitals ({waitingPatients.length})</div>
          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-light)', marginTop: '8px' }}>
            <Search size={16} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
            <input type="text" placeholder="Search patient..." style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', fontSize: '0.875rem' }} />
          </div>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
          {isLoadingQueue && waitingPatients.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
              <Loader2 className="spin" size={24} style={{ margin: '0 auto 8px' }} />
              Loading patients...
            </div>
          ) : waitingPatients.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
              <CheckCircle2 size={32} color="var(--color-success)" style={{ margin: '0 auto 8px' }} />
              All patients have vitals!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {waitingPatients.map((visit) => (
                <div 
                  key={visit.id}
                  onClick={() => handleSelectPatient(visit)}
                  style={{ 
                    padding: '12px', 
                    borderRadius: '8px', 
                    cursor: 'pointer',
                    backgroundColor: selectedPatient?.id === visit.id ? '#f0f9ff' : 'var(--color-surface)',
                    border: selectedPatient?.id === visit.id ? '1px solid #bae6fd' : '1px solid var(--border-light)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '0.9375rem' }}>{visit.patient.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {visit.reason || 'Routine Checkup'}
                    </div>
                  </div>
                  <ChevronRight size={16} color="var(--color-text-muted)" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Vitals Entry Engine */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
        {selectedPatient ? (
          <div style={{ padding: 'var(--space-6)', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px', paddingBottom: '24px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#e0e7ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={24} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>{selectedPatient.patient.name}</h2>
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  <span>DOB: {new Date(selectedPatient.patient.dob).toLocaleDateString()}</span>
                  <span>ID: {selectedPatient.patient.id}</span>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveVitals} style={{ flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
                
                {/* Blood Pressure */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Activity size={16} color="#ef4444" /> Blood Pressure
                  </label>
                  <input 
                    required type="text" placeholder="e.g. 120/80" 
                    value={vitals.bp} onChange={e => setVitals({...vitals, bp: e.target.value})}
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)', fontSize: '1rem', outlineColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Heart Rate */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <HeartPulse size={16} color="#ec4899" /> Heart Rate (bpm)
                  </label>
                  <input 
                    required type="number" placeholder="e.g. 75" 
                    value={vitals.hr} onChange={e => setVitals({...vitals, hr: e.target.value})}
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)', fontSize: '1rem', outlineColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Temperature */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Thermometer size={16} color="#f59e0b" /> Temperature (°F)
                  </label>
                  <input 
                    required type="number" step="0.1" placeholder="e.g. 98.6" 
                    value={vitals.temp} onChange={e => setVitals({...vitals, temp: e.target.value})}
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)', fontSize: '1rem', outlineColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* SpO2 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Droplet size={16} color="#0ea5e9" /> SpO2 (%)
                  </label>
                  <input 
                    required type="number" placeholder="e.g. 98" 
                    value={vitals.spo2} onChange={e => setVitals({...vitals, spo2: e.target.value})}
                    style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-light)', fontSize: '1rem', outlineColor: 'var(--color-primary)' }}
                  />
                </div>

              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={isSubmitting}
                style={{ width: '100%', padding: '16px', fontSize: '1.125rem', borderRadius: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              >
                {isSubmitting ? <Loader2 className="spin" size={24} /> : 'Save & Flag "Ready for Doctor"'}
              </button>
            </form>

          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
            <Activity size={48} opacity={0.2} style={{ marginBottom: '16px' }} />
            <div style={{ fontSize: '1.125rem', fontWeight: 500 }}>Select a patient to begin triage</div>
            <div style={{ fontSize: '0.875rem', marginTop: '4px' }}>Capture vitals to prepare the doctor's AI context</div>
          </div>
        )}
      </div>

    </div>
  );
}
