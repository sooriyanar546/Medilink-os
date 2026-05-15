'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, MessageCircle, FileText, Lock, ChevronRight, ShieldCheck, CheckCircle2, Navigation, HeartHandshake, BellRing, Sparkles, Loader2, Smartphone, RefreshCw, AlertTriangle } from 'lucide-react';
import { useHospitalStore } from '@/store/useHospitalStore';

export default function PatientMode() {
  const { data: session } = useSession();
  const { queue, messages, loadMessages, isLoadingMessages } = useHospitalStore();
  const patientId = session?.user?.patientId || session?.user?.id || 'pt_michael_chen';
  const [isStressReduction, setIsStressReduction] = useState(false);
  const [translatedReport, setTranslatedReport] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [pharmacyAlert, setPharmacyAlert] = useState(null);

  const [isSimulatingLab, setIsSimulatingLab] = useState(false);

  const fetchReports = async () => {
    setIsLoadingReport(true);
    try {
      const res = await fetch(`/api/lab-reports?patientId=${patientId}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setTranslatedReport(data[0]); // Show the most recent one
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingReport(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [patientId]);

  const simulateLabPush = async () => {
    setIsSimulatingLab(true);
    try {
      const res = await fetch('/api/lab-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          patientId: patientId,
          testName: 'Complete Blood Count (CBC)', 
          rawData: { WBC: "15.2 x10^9/L", RBC: "4.5 x10^12/L", Hemoglobin: "13.2 g/dL" }
        })
      });
      const data = await res.json();
      if (data.success) {
        setTranslatedReport(data.labReport);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSimulatingLab(false);
    }
  };

  // Fetch real messages and setup Pusher WebSocket
  useEffect(() => {
    loadMessages(patientId);
    
    // Subscribe to global queue updates
    useHospitalStore.getState().initializePusher();

    const { getPusherClient } = require('@/lib/pusher');
    const pusher = getPusherClient();
    
    if (!pusher || !pusher.subscribe) {
      console.warn('Pusher disabled. Falling back to 5-second polling for messages.');
      const interval = setInterval(() => loadMessages(patientId), 5000);
      return () => clearInterval(interval);
    }

    const channelName = `patient-${patientId}`;
    const channel = pusher.subscribe(channelName);
    
    channel.bind('message-received', (data) => {
      console.log('Real-time SMS received!', data);
      loadMessages(patientId);
    });

    channel.bind('prescription-ready', (data) => {
      console.log('Prescription is ready!', data);
      setPharmacyAlert(data);
    });

    return () => {
      channel.unbind('message-received');
      channel.unbind('prescription-ready');
      pusher.unsubscribe(channelName);
    };
  }, [patientId]);
  
  // Find current user in the queue
  const myIndex = queue.findIndex(p => p.id === patientId);
  const queuePosition = myIndex !== -1 ? myIndex + 1 : 0;
  const isConsulting = myIndex === 0 && queue[0].status === 'consulting';
  const isComplete = myIndex === -1; // If not in queue, assumed complete
  
  // Calculate wait time (just summing wait times of people ahead for simplicity, or using their defined waitTime)
  const waitTime = myIndex !== -1 ? queue[myIndex].waitTime : 0;
  const isDelayed = waitTime > 15 && !isConsulting && !isComplete;

  // Dynamic styling based on Stress Reduction Mode
  const baseFontSize = isStressReduction ? '1.1rem' : 'var(--font-size-sm)';
  const headingSize = isStressReduction ? '2rem' : 'var(--font-size-2xl)';
  const cardPadding = isStressReduction ? 'var(--space-8)' : 'var(--space-6)';

  return (
    <div style={{ transition: 'all 0.3s ease', fontSize: baseFontSize }}>
      
      {/* Header & Stress Toggle */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: headingSize }}>
            {isComplete ? 'Visit Complete' : isConsulting ? 'Consulting Now' : 'My Care Journey'}
          </h1>
          {!isStressReduction && <p className="page-description">
            {isComplete ? 'You are all set, Michael.' : 'Welcome back, Michael. Here is your live visit status.'}
          </p>}
        </div>
        
        <button 
          onClick={() => setIsStressReduction(!isStressReduction)}
          className={`btn ${isStressReduction ? 'btn-primary' : 'btn-outline'}`}
          style={{ borderRadius: '50px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: isStressReduction ? '#1e3a8a' : 'transparent' }}
        >
          <HeartHandshake size={18} />
          {isStressReduction ? 'Stress Reduction On' : 'Simplify View'}
        </button>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: isStressReduction ? '1fr' : '3fr 2fr', gap: 'var(--space-8)' }}>
        
        {/* Left Column: Live Queue & Journey */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          {/* Pharmacy Alert */}
          <AnimatePresence>
            {pharmacyAlert && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="card" 
                style={{ backgroundColor: '#f0fdf4', border: '2px solid #22c55e', color: '#166534', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <CheckCircle2 size={32} color="#22c55e" />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Medication Ready for Pickup</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem' }}>Your prescription has been filled and is ready at Pharmacy Counter 1.</p>
                  </div>
                </div>
                <button onClick={() => setPharmacyAlert(null)} className="btn btn-primary" style={{ backgroundColor: '#166534' }}>Acknowledge</button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Smart Arrival / Adaptive Wait Banner */}
          <div className="card" style={{ 
            backgroundColor: isConsulting ? 'var(--color-success)' : isDelayed ? '#f0f9ff' : 'var(--color-primary)', 
            color: isConsulting ? 'white' : isDelayed ? '#0369a1' : 'white', 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: cardPadding,
            border: isDelayed ? '1px solid #bae6fd' : 'none'
          }}>
            <div>
              <div style={{ fontSize: 'var(--font-size-sm)', opacity: isDelayed ? 1 : 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', fontWeight: 600 }}>
                {isComplete ? 'Status' : isConsulting ? 'Current Status' : 'Live Wait Time'}
              </div>
              <div style={{ fontSize: isStressReduction ? '4rem' : '3rem', fontWeight: 700, lineHeight: 1 }}>
                {isComplete ? 'Done' : isConsulting ? 'In Room' : waitTime} <span style={{ fontSize: '1.25rem', fontWeight: 500, opacity: isDelayed ? 1 : 0.8 }}>{isComplete || isConsulting ? '' : 'mins'}</span>
              </div>
            </div>
            
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--font-size-sm)', opacity: isDelayed ? 1 : 0.8, marginBottom: '4px', fontWeight: 600 }}>Queue Position</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                {isComplete ? '--' : isConsulting ? 'Next' : `#${queuePosition}`}
              </div>
              {!isStressReduction && !isComplete && !isConsulting && (
                <div style={{ fontSize: 'var(--font-size-xs)', marginTop: '4px', backgroundColor: isDelayed ? 'rgba(2,132,199,0.1)' : 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '50px' }}>
                  Doctor is seeing #{queuePosition - 1}
                </div>
              )}
            </div>
          </div>

          {/* Adaptive Emotional Reassurance (Shown if delayed) */}
          {isDelayed && (
            <div className="card" style={{ backgroundColor: '#fffbeb', border: '1px solid #fef08a', padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <Sparkles color="#ca8a04" size={24} style={{ marginTop: '2px' }} />
                <div>
                  <h4 style={{ color: '#854d0e', fontWeight: 600, fontSize: 'var(--font-size-base)', marginBottom: '4px' }}>We appreciate your patience</h4>
                  <p style={{ color: '#a16207', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
                    Dr. Patel is handling an unexpected complex case, causing a slight delay. You have plenty of time to grab a coffee from the cafeteria on Floor 1. We will text you 5 minutes before your turn.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step-by-step Journey */}
          {!isStressReduction && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Live Flow Navigation</div>
              </div>
              <div style={{ position: 'relative', paddingLeft: 'var(--space-6)', marginTop: 'var(--space-2)' }}>
                
                <div style={{ position: 'absolute', left: '11px', top: '24px', bottom: '24px', width: '2px', backgroundColor: 'var(--border-light)' }}></div>

                <div style={{ position: 'relative', marginBottom: 'var(--space-6)' }}>
                  <div style={{ position: 'absolute', left: '-29px', top: '2px', backgroundColor: 'var(--color-surface)', zIndex: 1 }}>
                    <CheckCircle2 size={24} color="var(--color-success)" fill="#d1fae5" />
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>Check-in & Vitals</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Completed at 9:15 AM</div>
                </div>

                <div style={{ position: 'relative', marginBottom: 'var(--space-6)' }}>
                  <div style={{ position: 'absolute', left: '-29px', top: '2px', backgroundColor: 'var(--color-surface)', zIndex: 1 }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--color-primary)', border: '4px solid var(--color-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: '8px', height: '8px', backgroundColor: 'white', borderRadius: '50%', animation: 'pulse 2s infinite' }}></div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>Cardiology Waiting Area</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>You are here.</div>
                </div>

                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '-29px', top: '2px', backgroundColor: 'var(--color-surface)', zIndex: 1 }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: '2px solid var(--border-light)' }}></div>
                  </div>
                  <div style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>Consultation (Dr. Patel)</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <Navigation size={12} /> Room 402 • Floor 4
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Quick Actions (Always visible, enlarged in Stress Mode) */}
          <div className="card">
            <div className="card-header">
              <div className="card-title"><MessageCircle size={20} style={{ marginRight: '8px' }} /> I need help with...</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
              <button className="btn btn-outline" style={{ justifyContent: 'center', padding: '12px', fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Finding Room 402</button>
              <button className="btn btn-outline" style={{ justifyContent: 'center', padding: '12px', fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Wheelchair Request</button>
              <button className="btn btn-outline" style={{ justifyContent: 'center', padding: '12px', fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Talk to a Nurse</button>
            </div>
          </div>

        </div>

        {/* Right Column: Communication Hub & AI Features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          {/* Smart Communication Hub (Live WhatsApp/SMS Feed) */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '400px', border: '1px solid #e2e8f0' }}>
            <div className="card-header" style={{ padding: 'var(--space-4)', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', margin: 0 }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Smartphone color="#0ea5e9" size={20} /> 
                Live Communications
              </div>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Hospital Updates</span>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column-reverse', gap: '12px' }}>
              <AnimatePresence>
                {isLoadingMessages && messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>Loading messages...</div>
                ) : messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>No messages yet.</div>
                ) : (
                  messages.map((msg, i) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      style={{
                        backgroundColor: msg.channel === 'WHATSAPP' ? '#dcf8c6' : 'white',
                        padding: '12px 16px',
                        borderRadius: '16px',
                        borderBottomLeftRadius: '4px',
                        alignSelf: 'flex-start',
                        maxWidth: '90%',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        border: '1px solid rgba(0,0,0,0.05)',
                      }}
                    >
                      <div style={{ fontSize: '0.9375rem', color: '#0f172a', lineHeight: 1.4 }}>
                        {msg.content}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.6875rem', color: '#64748b' }}>
                        <span>{msg.channel}</span>
                        <span>
                          {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* AI Health Companion (Continuity Engine) */}
          <div className="card" style={{ border: '2px solid var(--color-primary-light)', background: 'linear-gradient(to bottom, #f0f9ff, #ffffff)' }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-2)' }}>
              <div className="card-title">
                <BellRing color="var(--color-primary-light)" size={20} style={{ marginRight: '8px' }} /> 
                Health Companion
              </div>
            </div>
            <div style={{ paddingTop: 'var(--space-2)' }}>
              <p style={{ fontSize: isStressReduction ? '1.2rem' : 'var(--font-size-sm)', color: 'var(--color-text-main)', fontWeight: 500, lineHeight: 1.5, marginBottom: 'var(--space-4)' }}>
                I noticed you haven't booked your follow-up diabetes screening from last month. Would you like to schedule that while you are here today?
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button className="btn btn-primary" style={{ flex: 1, fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Yes, Book Now</button>
                <button className="btn btn-outline" style={{ flex: 1, fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Remind Me Later</button>
              </div>
            </div>
          </div>

          {/* AI Lab Report Translation (Hidden in Stress Reduction Mode) */}
          {!isStressReduction && (
            <div className="card" style={{ borderTop: '4px solid var(--color-info)' }}>
              <div className="card-header" style={{ marginBottom: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
                  <FileText color="var(--color-info)" size={20} style={{ marginRight: '8px' }} /> 
                  My Translated Report
                </div>
                <button className="btn btn-outline" onClick={simulateLabPush} disabled={isSimulatingLab} style={{ fontSize: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {isSimulatingLab ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Simulate LIMS Push
                </button>
              </div>
              
              {isLoadingReport && !translatedReport ? (
                <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                  <Loader2 size={24} className="spin" style={{ marginBottom: '8px', color: 'var(--color-info)' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>Loading lab results...</span>
                </div>
              ) : translatedReport ? (
                <div style={{ paddingTop: 'var(--space-2)', animation: 'fadeIn 0.5s ease-out' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600 }}>{translatedReport.testName}</h3>
                    <span className={`badge ${translatedReport.severity === 'NORMAL' ? 'badge-success' : translatedReport.severity === 'LOW' ? 'badge-info' : 'badge-danger'}`}>
                      {translatedReport.severity}
                    </span>
                  </div>
                  <div style={{ backgroundColor: '#fefce8', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}>
                    <p style={{ fontSize: 'var(--font-size-sm)', color: '#854d0e', lineHeight: 1.5 }}>
                      <strong style={{ display: 'block', marginBottom: '4px' }}>Plain English Translation:</strong>
                      {translatedReport.plainEnglish}
                    </p>
                  </div>
                  {translatedReport.recommendation && (
                    <div style={{ backgroundColor: '#f0f9ff', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}>
                      <p style={{ fontSize: 'var(--font-size-sm)', color: '#0369a1', lineHeight: 1.5 }}>
                        <strong style={{ display: 'block', marginBottom: '4px' }}>AI Recommendation:</strong>
                        {translatedReport.recommendation}
                      </p>
                    </div>
                  )}
                  <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'space-between' }}>
                    Ask Doctor about this <ChevronRight size={16} />
                  </button>
                </div>
              ) : (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                  No recent lab reports found. Click simulate to test the AI integration.
                </div>
              )}
            </div>
          )}

          {/* Blockchain Locker */}
          <div className="card" style={{ background: 'linear-gradient(to bottom right, #f8fafc, #f1f5f9)' }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-2)' }}>
              <div className="card-title">
                <Lock color="#475569" size={20} style={{ marginRight: '8px' }} /> 
                Secure Vault (ABHA)
              </div>
            </div>
            {!isStressReduction && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                Lifetime secure vault. 100% encrypted. Only you hold the key.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: 'var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ width: '32px', height: '32px', backgroundColor: '#e0e7ff', color: '#4338ca', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Prescription History</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: 'var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ width: '32px', height: '32px', backgroundColor: '#dcfce3', color: '#166534', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>ABHA Network Active</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
