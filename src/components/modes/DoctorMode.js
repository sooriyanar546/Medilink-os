'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, AlertCircle, Sparkles, BrainCircuit, Activity, Clock, ShieldAlert, History, ActivitySquare, HeartPulse, Loader2 } from 'lucide-react';
import { useHospitalStore } from '@/store/useHospitalStore';
import { PulseDot, StatCard, AnimatedCard } from '@/components/ui/MotionKit';

export default function DoctorMode() {
  const { queue, adminMetrics, completeConsultation, loadQueue, isLoadingQueue, initializePusher } = useHospitalStore();
  const currentPatient = queue.length > 0 ? queue[0] : null;

  // Load live queue from database on mount and start Pusher
  useEffect(() => { 
    loadQueue(); 
    initializePusher();
  }, []);

  // AI Scribe State
  const [transcript, setTranscript] = useState("");
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [structuredNote, setStructuredNote] = useState(null);
  
  // Voice Scribe State
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let currentTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);
        };

        recognition.onerror = (event) => {
          console.error("Speech recognition error", event.error);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (!recognitionRef.current) {
        alert("Your browser does not support live voice transcription. Please use Chrome, Edge, or Safari.");
        return;
      }
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleProcessAI = async () => {
    setIsProcessingAI(true);
    try {
      const res = await fetch('/api/ai/scribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transcript,
          visitId: currentPatient?.visitId || currentPatient?.id || 'demo_visit_id',
          vitals: currentPatient?.vitals || null
        })
      });
      const data = await res.json();
      setStructuredNote(data);
    } catch (err) {
      console.error("Failed to fetch AI", err);
    } finally {
      setIsProcessingAI(false);
    }
  };
  return (
    <>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Doctor Workspace</h1>
          <p className="page-description" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Mic size={14} color="var(--color-primary)" /> Ambient Listening Active • Dr. Sarah Jenkins
          </p>
        </div>
        
        {/* Doctor Wellness System Alert */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 400, damping: 30 }}
          style={{ backgroundColor: '#fff1f2', border: '1px solid #fecdd3', padding: '8px 16px', borderRadius: 'var(--radius-full)', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <HeartPulse size={16} color="#e11d48" />
          <span style={{ fontSize: 'var(--font-size-sm)', color: '#be123c', fontWeight: 500 }}>
            {adminMetrics.consultationsCompletedToday} consultations completed. Suggested 10-min pause after this patient.
          </span>
        </motion.div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr 2fr 1fr', gap: 'var(--space-6)' }}>
        
        {/* Left Column: Live Queue & Clinical Priority */}
        <div className="card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ padding: 'var(--space-4)', marginBottom: 0, backgroundColor: 'var(--color-surface-hover)' }}>
            <div className="card-title">Live Queue</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            
            {queue.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}
              >
                ✓ Queue cleared.
              </motion.div>
            )}

            <AnimatePresence>
              {queue.map((patient, index) => (
                <motion.div
                  key={patient.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20, height: 0, padding: 0, overflow: 'hidden' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  style={{ 
                    padding: 'var(--space-4)', 
                    borderBottom: 'var(--border-light)', 
                    borderLeft: patient.status === 'consulting' ? '3px solid var(--color-success)' : patient.critical ? '3px solid var(--color-danger)' : '3px solid transparent', 
                    backgroundColor: patient.status === 'consulting' ? 'var(--color-surface)' : patient.critical ? '#fffafa' : 'transparent' 
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: patient.status === 'consulting' ? 600 : 500, color: patient.critical ? '#991b1b' : 'var(--color-text-main)', fontSize: 'var(--font-size-sm)' }}>{patient.name}</span>
                    <motion.span
                      className={`badge ${patient.status === 'consulting' ? 'badge-success' : patient.critical ? 'badge-danger' : 'badge-warning'}`}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: index * 0.05 + 0.1 }}
                    >
                      {patient.status === 'consulting' ? 'Consulting' : patient.critical ? 'Critical Labs' : `Waiting (${patient.waitTime}m)`}
                    </motion.span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: patient.critical ? '#b91c1c' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {patient.critical && <AlertCircle size={12} />}
                    {patient.id} • {patient.reason}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

          </div>
        </div>

        {/* Center Column: Ambient Consultation Mode */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', paddingBottom: 'var(--space-4)', borderBottom: 'var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--color-primary-light)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                {currentPatient ? currentPatient.name.split(' ').map(n => n[0]).join('') : '--'}
              </div>
              <div>
                <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text-main)', lineHeight: 1.2 }}>{currentPatient ? currentPatient.name : 'No Active Patient'}</h2>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Male, 45 yrs • {currentPatient ? currentPatient.reason : ''}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <PulseDot color="#10b981" size={8} />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ambient Sync Active</span>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 'var(--space-6)', flex: 1, flexDirection: 'column' }}>
            
            {/* Raw Transcript Area */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Raw Transcript (Voice Input)</span>
                  <button 
                    onClick={toggleListening}
                    style={{ 
                      padding: '4px 12px', 
                      fontSize: '12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px', 
                      borderRadius: 'var(--radius-full)',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: isListening ? '#fee2e2' : '#f1f5f9',
                      color: isListening ? '#ef4444' : '#64748b',
                      fontWeight: 600,
                      transition: 'all 0.2s'
                    }}
                  >
                    {isListening ? (
                      <><PulseDot color="#ef4444" size={8} /> Recording...</>
                    ) : (
                      <><Mic size={14} /> Start Mic</>
                    )}
                  </button>
                </div>
                <button 
                  onClick={handleProcessAI} 
                  disabled={isProcessingAI || !transcript}
                  className="btn btn-outline" 
                  style={{ padding: '4px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {isProcessingAI ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                  {isProcessingAI ? 'AI Thinking...' : 'Structure with AI'}
                </button>
              </div>
              <textarea 
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit', resize: 'vertical' }}
                placeholder="Doctor voice transcript appears here..."
              />
            </div>

            <AnimatePresence mode="wait">
              {structuredNote && (
                <motion.div
                  key="note"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
                >
                  <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={14} /> Clinical Summary (SOAP)
                  </div>
                  
                  {/* SOAP Content Blocks */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    <div style={{ backgroundColor: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                      <span style={{ fontSize: '10px', color: '#166534', fontWeight: 600, display: 'block', marginBottom: '4px' }}>SUBJECTIVE</span>
                      <span style={{ fontSize: '13px', color: '#14532d' }}>{structuredNote.note?.subjective || structuredNote.subjective}</span>
                    </div>
                    <div style={{ backgroundColor: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                      <span style={{ fontSize: '10px', color: '#166534', fontWeight: 600, display: 'block', marginBottom: '4px' }}>OBJECTIVE</span>
                      <span style={{ fontSize: '13px', color: '#14532d' }}>{structuredNote.note?.objective || structuredNote.objective || 'None noted'}</span>
                    </div>
                    <div style={{ backgroundColor: '#eff6ff', padding: '12px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                      <span style={{ fontSize: '10px', color: '#1e40af', fontWeight: 600, display: 'block', marginBottom: '4px' }}>ASSESSMENT</span>
                      <span style={{ fontSize: '13px', color: '#1e3a8a', fontWeight: 500 }}>{structuredNote.note?.assessment || structuredNote.assessment}</span>
                    </div>
                    <div style={{ backgroundColor: '#fefce8', padding: '12px', borderRadius: '8px', border: '1px solid #fef08a' }}>
                      <span style={{ fontSize: '10px', color: '#854d0e', fontWeight: 600, display: 'block', marginBottom: '4px' }}>PLAN</span>
                      <span style={{ fontSize: '13px', color: '#713f12' }}>{structuredNote.note?.plan || structuredNote.plan}</span>
                    </div>
                  </div>

                  {/* Medications Table */}
                  <div style={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border-light)', fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                      RECOMMENDED MEDICATIONS
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f1f5f9', color: '#64748b', textAlign: 'left' }}>
                          <th style={{ padding: '8px 12px', fontWeight: 500 }}>Drug Name</th>
                          <th style={{ padding: '8px 12px', fontWeight: 500 }}>Dosage</th>
                          <th style={{ padding: '8px 12px', fontWeight: 500 }}>Frequency</th>
                          <th style={{ padding: '8px 12px', fontWeight: 500 }}>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(structuredNote.note?.medications || structuredNote.medications || []).map((med, i) => (
                          <tr key={i} style={{ borderTop: '1px solid var(--border-light)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 500, color: '#0f172a' }}>{med.drugName}</td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>{med.dosage}</td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>{med.frequency}</td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>{med.duration}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Metadata & Sign-off */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                    <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600, backgroundColor: '#fee2e2', padding: '4px 8px', borderRadius: '4px' }}>
                      Status: {structuredNote.note?.status || structuredNote.status || 'DRAFT'}
                    </span>
                    {(structuredNote.note?.requiresPhysicianSignature || structuredNote.requires_physician_signature) && (
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        * Requires your signature
                      </span>
                    )}
                  </div>
                </motion.div>
              )}

              {!structuredNote && !isProcessingAI && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-6)', minHeight: '80px' }}
                >
                  Waiting for transcript to process...
                </motion.div>
              )}

              {isProcessingAI && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-primary)', padding: 'var(--space-6)', minHeight: '80px' }}
                >
                  <Loader2 size={24} className="spin" style={{ marginBottom: '8px' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>AI is structuring clinical note...</span>
                </motion.div>
              )}
            </AnimatePresence>

          </div>

          <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-4)', borderTop: 'var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Voice commands active: "Next patient", "Order test", "Sign note"
            </span>
            <button 
              className="btn btn-primary" 
              onClick={completeConsultation}
              disabled={!currentPatient}
            >
              Sign & Next Patient
            </button>
          </div>
        </div>

        {/* Right Column: Contextual AI Memory */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          <div className="card" style={{ backgroundColor: '#fafaf9', border: '1px solid #e7e5e4' }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ fontSize: 'var(--font-size-sm)' }}>
                <BrainCircuit color="var(--color-primary)" size={16} />
                Contextual AI Memory
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Historical Pattern Detected</div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: '#44403c', lineHeight: 1.4 }}>
                  Patient reported identical palpitations <strong>6 months ago</strong>. ECG at that time showed Sinus Tachycardia.
                </p>
              </div>

              <div style={{ paddingTop: 'var(--space-3)', borderTop: '1px dashed #d6d3d1' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Medication Adherence</div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: '#44403c', lineHeight: 1.4 }}>
                  Patient missed 4 doses of Amlodipine this week based on pharmacy refill data.
                </p>
              </div>

            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ fontSize: 'var(--font-size-sm)' }}>
                <History color="var(--color-text-muted)" size={16} />
                Recent Vitals
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div style={{ backgroundColor: 'var(--color-surface-hover)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>BP</div>
                <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: currentPatient?.vitals?.bp ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                  {currentPatient?.vitals?.bp || '--'}
                </div>
              </div>
              <div style={{ backgroundColor: 'var(--color-surface-hover)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>HR</div>
                <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: currentPatient?.vitals?.hr ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                  {currentPatient?.vitals?.hr ? `${currentPatient.vitals.hr} bpm` : '--'}
                </div>
              </div>
              <div style={{ backgroundColor: 'var(--color-surface-hover)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Temp</div>
                <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: currentPatient?.vitals?.temp ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                  {currentPatient?.vitals?.temp ? `${currentPatient.vitals.temp} °F` : '--'}
                </div>
              </div>
              <div style={{ backgroundColor: 'var(--color-surface-hover)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>SpO2</div>
                <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: currentPatient?.vitals?.spo2 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
                  {currentPatient?.vitals?.spo2 ? `${currentPatient.vitals.spo2}%` : '--'}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
