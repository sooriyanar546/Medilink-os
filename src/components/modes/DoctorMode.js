'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, AlertCircle, Sparkles, BrainCircuit, Activity, Clock, ShieldAlert, History, ActivitySquare, HeartPulse, Loader2, CheckCircle2 } from 'lucide-react';
import { useHospitalStore } from '@/store/useHospitalStore';
import { useHospitalQueue } from '@/hooks/useHospitalQueue';
import { PulseDot, StatCard, AnimatedCard } from '@/components/ui/MotionKit';
import { triggerNativeHaptic } from '@/lib/native';

const clinicalTemplates = [
  {
    name: "🫀 Cardiology (Palpitations)",
    text: "Patient presents with fluttering chest sensations for 2 days, worse at night. Denies chest pain or shortness of breath. Pulse is elevated at 98 bpm, blood pressure is 132/85. Prescribing Amlodipine 5mg once daily for 14 days to stabilize blood pressure. Also request dynamic ambulatory Holter ECG monitoring. Review in 2 weeks."
  },
  {
    name: "🌡️ Pediatrics (Fever)",
    text: "Mother reports toddler has 101.5 F fever since yesterday, with mild rhinorrhea and dry cough. Child is drinking fluids but is lethargic. Chest clear, throat erythematous. Prescribing Paracetamol Suspension 120mg/5ml, take 5ml every 6 hours as needed for fever. Advised sponging, hydration, and return immediately if breathing is shallow or lethargy deepens."
  },
  {
    name: "🧠 Neurology (Migraine)",
    text: "Patient complains of throbbing unilateral headache (left temporal) for 24 hours, associated with photophobia and nausea. Reports identical headache 6 months ago. Normal neurology exam, normal BP. Prescribing Sumatriptan 50mg once daily at onset of headache, and Ibuprofen 400mg twice daily with meals for 3 days. Recommend absolute rest in a quiet, dark room."
  }
];

const getClinicalCodes = (note) => {
  const diag = (note?.note?.assessment || note?.assessment || "").toLowerCase();
  const meds = note?.note?.medications || note?.medications || [];

  let icdCode = "ICD-10: R51.9 (Headache, Unspecified)";
  if (diag.includes("tension") || diag.includes("cephalgia")) {
    icdCode = "ICD-10: G44.209 (Tension-type Headache, Unspecified)";
  } else if (diag.includes("hypertension") || diag.includes("blood pressure")) {
    icdCode = "ICD-10: I10 (Essential Hypertension)";
  } else if (diag.includes("fever") || diag.includes("pediatric")) {
    icdCode = "ICD-10: R50.9 (Fever, Unspecified)";
  } else if (diag.includes("cardiac") || diag.includes("palpitations")) {
    icdCode = "ICD-10: R00.2 (Palpitations, Unspecified)";
  } else if (diag.includes("migraine")) {
    icdCode = "ICD-10: G43.909 (Migraine, Unspecified, Not Intractable)";
  }

  const mappedMeds = meds.map(m => {
    const name = m.drugName.toLowerCase();
    let rxNorm = "RxNorm: 312289 (Acetaminophen 500mg)";
    if (name.includes("amlodipine")) {
      rxNorm = "RxNorm: 197361 (Amlodipine 5mg)";
    } else if (name.includes("paracetamol") || name.includes("acetaminophen")) {
      rxNorm = m.dosage.includes("120mg") ? "RxNorm: 307689 (Paracetamol 120mg/5ml Oral Suspension)" : "RxNorm: 312289 (Paracetamol 500mg Tab)";
    } else if (name.includes("sumatriptan")) {
      rxNorm = "RxNorm: 313170 (Sumatriptan 50mg Tab)";
    } else if (name.includes("ibuprofen")) {
      rxNorm = "RxNorm: 310965 (Ibuprofen 400mg Tab)";
    }
    return { ...m, rxNorm };
  });

  return { icdCode, mappedMeds };
};

export default function DoctorMode() {
  const { queue, isLoadingQueue, loadQueue } = useHospitalQueue();
  const { adminMetrics, completeConsultation, showToast } = useHospitalStore();
  const currentPatient = queue.length > 0 ? queue[0] : null;

  // AI Scribe State
  const [transcript, setTranscript] = useState("");
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [structuredNote, setStructuredNote] = useState(null);
  
  // Voice Scribe State & Advanced Command Orchestrator Stacks
  const [isListening, setIsListening] = useState(false);
  const [cleanTranscript, setCleanTranscript] = useState("");
  const [activeVoiceCommand, setActiveVoiceCommand] = useState(null);
  const [labOrders, setLabOrders] = useState([]);
  
  const recognitionRef = useRef(null);
  const cleanTranscriptRef = useRef("");
  const processedIndexRef = useRef(0);

  const codes = structuredNote ? getClinicalCodes(structuredNote) : null;

  useEffect(() => {
    if (activeVoiceCommand) {
      const timer = setTimeout(() => {
        setActiveVoiceCommand(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [activeVoiceCommand]);

  const playChime = () => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(830.61, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.08);
      gain2.gain.setValueAtTime(0.12, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      
      osc1.start(now);
      osc1.stop(now + 0.3);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.58);
    } catch (e) {
      console.error("Audio chime failed", e);
    }
  };

  const checkForVoiceCommands = (segmentText) => {
    const text = segmentText.trim();
    if (!text) return;
    
    const hasWakeWord = /medilink|doctor command/i.test(text);
    if (!hasWakeWord) {
      const baseline = cleanTranscriptRef.current;
      const updated = baseline ? `${baseline.trim()} ${text}.` : `${text}.`;
      cleanTranscriptRef.current = updated;
      setCleanTranscript(updated);
      setTranscript(updated);
      return;
    }
    
    // Parse voice commands
    // 1. Prescribe command
    const prescribeMatch = text.match(/(?:medilink|doctor command)\s+prescribe\s+([\w\s\-]+?)\s+(\d+(?:\s*(?:mg|g|ml|mcg|caps|tabs))?)\s+([\w\s]+?)(?:\s+for\s+(\d+\s*days?))?$/i);
    if (prescribeMatch) {
      const drugName = prescribeMatch[1].trim();
      const dosage = prescribeMatch[2].trim();
      const frequency = prescribeMatch[3].trim();
      const duration = prescribeMatch[4] ? prescribeMatch[4].trim() : "7 days";
      
      const newMed = {
        drugName: drugName.charAt(0).toUpperCase() + drugName.slice(1),
        dosage,
        frequency: frequency.toUpperCase(),
        duration
      };
      
      const initialNote = {
        note: {
          subjective: "Patient interview in progress...",
          objective: "Observations recorded via ambient speech",
          assessment: "Consultation in progress",
          plan: "Treatment plan being formulated",
          medications: [],
          status: "DRAFT",
          requiresPhysicianSignature: true
        }
      };
      
      setStructuredNote(prev => {
        const current = prev || initialNote;
        const existingMeds = current.note?.medications || current.medications || [];
        const updatedMeds = [...existingMeds, newMed];
        return {
          ...current,
          medications: updatedMeds,
          note: {
            ...(current.note || {}),
            medications: updatedMeds
          }
        };
      });
      
      setActiveVoiceCommand({
        type: 'prescribe',
        message: `Prescribed ${newMed.drugName} ${newMed.dosage} ${newMed.frequency} for ${newMed.duration}`
      });
      
      playChime();
      triggerNativeHaptic('success');
      showToast(`Voice Command: Prescribed ${newMed.drugName}!`, 'success');
      return;
    }
    
    // 2. Diagnose command
    const diagnoseMatch = text.match(/(?:medilink|doctor command)\s+diagnose\s+([\w\s\-]+)/i);
    if (diagnoseMatch) {
      const condition = diagnoseMatch[1].trim();
      const capitalizedCondition = condition.charAt(0).toUpperCase() + condition.slice(1);
      
      const initialNote = {
        note: {
          subjective: "Patient interview in progress...",
          objective: "Observations recorded via ambient speech",
          assessment: capitalizedCondition,
          plan: "Treatment plan being formulated",
          medications: [],
          status: "DRAFT",
          requiresPhysicianSignature: true
        }
      };
      
      setStructuredNote(prev => {
        const current = prev || initialNote;
        return {
          ...current,
          assessment: capitalizedCondition,
          note: {
            ...(current.note || {}),
            assessment: capitalizedCondition
          }
        };
      });
      
      setActiveVoiceCommand({
        type: 'diagnose',
        message: `Diagnosed: ${capitalizedCondition}`
      });
      
      playChime();
      triggerNativeHaptic('success');
      showToast(`Voice Command: Diagnosed ${capitalizedCondition}!`, 'success');
      return;
    }
    
    // 3. Order Lab command
    const orderLabMatch = text.match(/(?:medilink|doctor command)\s+order\s+lab\s+([\w\s\-]+)/i);
    if (orderLabMatch) {
      const test = orderLabMatch[1].trim().toUpperCase();
      
      setLabOrders(prev => [...prev, test]);
      
      setActiveVoiceCommand({
        type: 'order_lab',
        message: `Lab Ordered: ${test}`
      });
      
      playChime();
      triggerNativeHaptic('success');
      showToast(`Voice Command: Ordered Lab ${test}!`, 'success');
      return;
    }
    
    // 4. Sign note command
    const signMatch = text.match(/(?:medilink|doctor command)\s+sign\s+(?:note|consultation)\s+and\s+next\s+patient/i);
    if (signMatch) {
      setActiveVoiceCommand({
        type: 'sign_off',
        message: "Signing note and moving to next patient..."
      });
      
      playChime();
      triggerNativeHaptic('success');
      handleSignConsultation();
      return;
    }
    
    // 5. Unrecognized Command
    setActiveVoiceCommand({
      type: 'error',
      message: `Command not recognized: "${text}"`
    });
    triggerNativeHaptic('error');
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const segmentText = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              if (i >= processedIndexRef.current) {
                processedIndexRef.current = i + 1;
                checkForVoiceCommands(segmentText);
              }
            } else {
              interimTranscript += segmentText;
            }
          }
          
          setTranscript(() => {
            const clean = cleanTranscriptRef.current;
            return clean ? `${clean.trim()} ${interimTranscript}`.trim() : interimTranscript.trim();
          });
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
      cleanTranscriptRef.current = transcript;
      setCleanTranscript(transcript);
      processedIndexRef.current = 0;
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleProcessAI = async () => {
    setIsProcessingAI(true);
    showToast("Structuring raw voice transcript with AI...", "info");
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
      showToast("Clinical SOAP note generated by Llama-3!", "success");
    } catch (err) {
      console.error("Failed to fetch AI", err);
      showToast("Failed to structure note with AI.", "error");
    } finally {
      setIsProcessingAI(false);
    }
  };

  const handleSignConsultation = async () => {
    showToast("Signing consultation...", "info");
    await completeConsultation();
    showToast("Consultation signed and completed!", "success");
    setTranscript("");
    setCleanTranscript("");
    cleanTranscriptRef.current = "";
    setStructuredNote(null);
    setLabOrders([]);
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

      <div className="doctor-grid">
        
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

              <AnimatePresence>
                {isListening && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: '40px' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '4px', 
                      backgroundColor: '#fee2e2', 
                      borderRadius: 'var(--radius-md)', 
                      border: '1px solid #fca5a5',
                      overflow: 'hidden',
                      marginBottom: '8px'
                    }}
                  >
                    <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600, marginRight: '8px' }}>
                      AMBIENT VOICE CAPTURE ACTIVE
                    </span>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((bar) => {
                      const delay = Math.random() * 0.4;
                      const duration = 0.4 + Math.random() * 0.6;
                      return (
                        <motion.div
                          key={bar}
                          animate={{ 
                            height: ['6px', '24px', '6px'] 
                          }}
                          transition={{ 
                            duration: duration,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: delay
                          }}
                          style={{ 
                            width: '3px', 
                            backgroundColor: '#ef4444', 
                            borderRadius: '2px' 
                          }}
                        />
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              <textarea 
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit', resize: 'vertical' }}
                placeholder="Doctor voice transcript appears here..."
              />

              {/* Scribe Simulation Templates */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', alignSelf: 'center', marginRight: '4px', fontWeight: 500 }}>
                  Simulate Consultation:
                </span>
                {clinicalTemplates.map((tpl, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setTranscript(tpl.text);
                      showToast(`Loaded ${tpl.name.split(' ')[1]} template!`, "info");
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-primary-light)',
                      backgroundColor: 'var(--color-info-bg)',
                      color: 'var(--color-primary)',
                      cursor: 'pointer',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.backgroundColor = 'var(--color-primary-light)';
                      e.target.style.color = 'white';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.backgroundColor = 'var(--color-info-bg)';
                      e.target.style.color = 'var(--color-primary)';
                    }}
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
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

                  {/* Lab Orders Box */}
                  {labOrders.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{ backgroundColor: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', padding: '12px', marginTop: '4px' }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#166534', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <BrainCircuit size={14} color="#166534" />
                        ACTIVE LAB ORDERS
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {labOrders.map((lab, idx) => (
                          <span 
                            key={idx} 
                            style={{ 
                              backgroundColor: '#d1fae5', 
                              color: '#065f46', 
                              border: '1px solid #a7f3d0', 
                              padding: '4px 10px', 
                              borderRadius: 'var(--radius-full)', 
                              fontSize: '11px', 
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                            {lab}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Clinical Coding Box */}
                  <div style={{ backgroundColor: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <BrainCircuit size={14} color="#166534" />
                        CLINICAL CODES & BILLING COMPLIANCE
                      </div>
                      <span className="badge badge-success" style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 8px' }}>
                        <CheckCircle2 size={10} /> Coded & Verified
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#14532d', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div>
                        <strong>Primary Diagnosis:</strong> <code style={{ backgroundColor: 'rgba(22, 101, 52, 0.08)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#15803d', fontWeight: 'bold' }}>{codes?.icdCode}</code>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <strong style={{ fontSize: '11px' }}>RxNorm Medication Mappings:</strong>
                        <ul style={{ margin: '2px 0 0 0', paddingLeft: '16px', fontSize: '11px', color: '#166534', listStyleType: 'disc' }}>
                          {codes?.mappedMeds.map((med, idx) => (
                            <li key={idx} style={{ marginTop: '2px' }}>
                              <span style={{ fontWeight: 500 }}>{med.drugName} ({med.dosage})</span>: <code style={{ backgroundColor: 'rgba(22, 101, 52, 0.08)', padding: '1px 4px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '10px', color: '#15803d', fontWeight: 'bold' }}>{med.rxNorm}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Metadata & Sign-off */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '8px' }}>
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
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <BrainCircuit size={13} color="var(--color-primary)" />
              <span style={{ fontWeight: 500 }}>Ambient Command Scribe Active.</span>
              Try: <code style={{ backgroundColor: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', color: 'var(--color-primary)', fontWeight: 600 }}>"MediLink, prescribe Ibuprofen 400mg BID"</code> or <code style={{ backgroundColor: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', color: 'var(--color-primary)', fontWeight: 600 }}>"order lab CBC"</code>
            </span>
            <button 
              className="btn btn-primary" 
              onClick={handleSignConsultation}
              disabled={!currentPatient}
            >
              Sign & Next Patient
            </button>
          </div>
        </div>

        {/* Right Column: Contextual AI Memory */}
        <div className="doctor-right-column" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
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

          {/* Doctor Operations & Recovery Analytics Widget */}
          <div className="card" style={{ borderLeft: '4px solid #3b82f6', background: 'linear-gradient(to bottom, #f8fafc, #ffffff)' }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ActivitySquare color="#3b82f6" size={16} />
                Physician Operations & Recovery Analytics
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Dynamic SVG Circular Load Gauge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ position: 'relative', width: '60px', height: '60px' }}>
                  <svg width="60" height="60" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#e2e8f0" strokeWidth="3px" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#3b82f6" strokeWidth="3px" 
                            strokeDasharray="72, 100" strokeDashoffset="0" strokeLinecap="round" />
                  </svg>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', color: '#1e3a8a' }}>
                    72%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e293b' }}>Shift Capacity Engaged</div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', lineHeight: 1.3 }}>72% workload buffer actively prevents clinician burnout.</div>
                </div>
              </div>

              {/* Recovery SLA stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', borderTop: '1px dashed #e2e8f0', paddingTop: '10px' }}>
                <div style={{ backgroundColor: '#f0fdf4', padding: '8px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: '9px', color: '#166534', textTransform: 'uppercase', fontWeight: 600 }}>Recovery Rate</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#15803d', marginTop: '2px' }}>94%</div>
                </div>
                <div style={{ backgroundColor: '#eff6ff', padding: '8px', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
                  <div style={{ fontSize: '9px', color: '#1e40af', textTransform: 'uppercase', fontWeight: 600 }}>Consult Time</div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1d4ed8', marginTop: '2px' }}>6.2m <span style={{ fontSize: '9px', fontWeight: 'normal' }}>avg</span></div>
                </div>
              </div>

              <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #e2e8f0', paddingTop: '8px' }}>
                <span>Patient Trust Rating:</span>
                <span style={{ fontWeight: 'bold', color: '#15803d' }}>★ 4.98 (Optimal)</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Glassmorphic Active Voice Command Confirmation Popover */}
      <AnimatePresence>
        {activeVoiceCommand && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{
              position: 'fixed',
              top: '24px',
              right: '24px',
              zIndex: 9999,
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: activeVoiceCommand.type === 'error' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '16px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              maxWidth: '360px'
            }}
          >
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: activeVoiceCommand.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {activeVoiceCommand.type === 'error' ? (
                <AlertCircle size={18} color="#ef4444" />
              ) : (
                <Sparkles size={18} color="#10b981" />
              )}
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {activeVoiceCommand.type === 'error' ? 'Voice Command Error' : 'Voice Command Executed'}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-main)', marginTop: '2px' }}>
                {activeVoiceCommand.message}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
