'use client';

import React, { useState } from 'react';
import { Fingerprint, CheckCircle2, ArrowRight, Loader2, Hospital } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function KioskPage() {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('IDLE'); // IDLE, LOADING, SUCCESS, ERROR
  const [visitInfo, setVisitInfo] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newDob, setNewDob] = useState('1995-01-01');
  const [bloodGroup, setBloodGroup] = useState('O+');

  const handleKeyPress = (digit) => {
    if (phone.length < 15) {
      setPhone(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPhone(prev => prev.slice(0, -1));
  };

  const handleCheckIn = async () => {
    if (phone.length < 5) return;
    setStatus('LOADING');
    try {
      const res = await fetch('/api/kiosk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      
      if (res.ok) {
        setVisitInfo(data);
        setStatus('SUCCESS');
        setTimeout(() => {
          setStatus('IDLE');
          setPhone('');
          setVisitInfo(null);
        }, 10000); // Reset after 10s
      } else {
        setErrorMessage(data.error || 'Check-in failed');
        setStatus('ERROR');
        setTimeout(() => {
          setStatus('IDLE');
          setErrorMessage('');
        }, 5000);
      }
    } catch (e) {
      setErrorMessage('Network error. Please go to front desk.');
      setStatus('ERROR');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', backgroundColor: '#0f172a', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* Left side banner */}
      <div style={{ flex: 1, backgroundColor: 'var(--color-primary)', display: 'flex', flexDirection: 'column', padding: '64px', justifyContent: 'center' }}>
        <Hospital size={80} color="white" style={{ marginBottom: '32px' }} />
        <h1 style={{ fontSize: '4rem', fontWeight: 800, lineHeight: 1.1, marginBottom: '24px' }}>Welcome to<br/>MediLink</h1>
        <p style={{ fontSize: '1.5rem', opacity: 0.9, lineHeight: 1.4 }}>Fast, autonomous check-in.<br/>Skip the queue at the front desk.</p>
      </div>

      {/* Right side interactive panel */}
      <div style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px' }}>
        <AnimatePresence mode="wait">
          
          {status === 'IDLE' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              style={{ width: '100%', maxWidth: '480px' }}
            >
              <h2 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '8px' }}>Check In</h2>
              <p style={{ fontSize: '1.25rem', color: '#94a3b8', marginBottom: '48px' }}>Enter your registered phone number</p>
              
              <div style={{ backgroundColor: '#1e293b', border: '2px solid #334155', borderRadius: '16px', padding: '24px', fontSize: '2rem', textAlign: 'center', letterSpacing: '4px', marginBottom: '32px', minHeight: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {phone || <span style={{ color: '#475569' }}>Phone Number</span>}
              </div>

              {/* Numpad */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                  <button 
                    key={num} 
                    onClick={() => handleKeyPress(num.toString())}
                    style={{ padding: '24px', fontSize: '2rem', backgroundColor: '#1e293b', border: 'none', borderRadius: '16px', color: 'white', cursor: 'pointer', transition: 'background 0.2s' }}
                    onMouseDown={e => e.currentTarget.style.backgroundColor = '#334155'}
                    onMouseUp={e => e.currentTarget.style.backgroundColor = '#1e293b'}
                  >
                    {num}
                  </button>
                ))}
                <button 
                  onClick={handleBackspace}
                  style={{ padding: '24px', fontSize: '1.5rem', backgroundColor: '#1e293b', border: 'none', borderRadius: '16px', color: '#ef4444', cursor: 'pointer' }}
                >
                  DEL
                </button>
                <button 
                  onClick={() => handleKeyPress('0')}
                  style={{ padding: '24px', fontSize: '2rem', backgroundColor: '#1e293b', border: 'none', borderRadius: '16px', color: 'white', cursor: 'pointer' }}
                >
                  0
                </button>
                <button 
                  onClick={() => handleKeyPress('+')}
                  style={{ padding: '24px', fontSize: '2rem', backgroundColor: '#1e293b', border: 'none', borderRadius: '16px', color: 'white', cursor: 'pointer' }}
                >
                  +
                </button>
              </div>

              <button 
                onClick={handleCheckIn}
                disabled={phone.length < 5}
                style={{ width: '100%', padding: '24px', fontSize: '1.5rem', backgroundColor: phone.length >= 5 ? 'var(--color-primary)' : '#334155', color: 'white', border: 'none', borderRadius: '16px', cursor: phone.length >= 5 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', transition: 'all 0.2s' }}
              >
                Continue <ArrowRight size={28} />
              </button>
            </motion.div>
          )}

          {status === 'LOADING' && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Loader2 size={64} className="spin" color="var(--color-primary)" style={{ marginBottom: '24px' }} />
              <h2 style={{ fontSize: '2rem' }}>Verifying Identity...</h2>
            </motion.div>
          )}

          {status === 'ERROR' && (
            <motion.div key="error" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center', backgroundColor: '#7f1d1d', padding: '48px', borderRadius: '24px', width: '100%', maxWidth: '480px' }}>
              <Fingerprint size={64} color="#fca5a5" style={{ margin: '0 auto 24px' }} />
              <h2 style={{ fontSize: '2rem', marginBottom: '16px', color: '#fef2f2' }}>Identification Failed</h2>
              <p style={{ fontSize: '1.25rem', color: '#fecdd3', marginBottom: '24px' }}>{errorMessage}</p>
              {errorMessage.includes('not found') && (
                <button
                  onClick={() => setStatus('REGISTRATION')}
                  style={{
                    width: '100%',
                    padding: '16px',
                    fontSize: '1.2rem',
                    backgroundColor: '#10b981',
                    border: 'none',
                    borderRadius: '16px',
                    color: 'white',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    transition: 'all 0.2s'
                  }}
                >
                  Register as a New Patient
                </button>
              )}
            </motion.div>
          )}

          {status === 'REGISTRATION' && (
            <motion.div 
              key="registration"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              style={{ width: '100%', maxWidth: '480px' }}
            >
              <h2 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '8px' }}>New Registration</h2>
              <p style={{ fontSize: '1.25rem', color: '#94a3b8', marginBottom: '32px' }}>Fill in your basic medical details</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '32px' }}>
                {/* Name */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 600 }}>FULL NAME</label>
                  <input 
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Enter full name"
                    style={{ width: '100%', padding: '16px', fontSize: '1.1rem', backgroundColor: '#1e293b', border: '2px solid #334155', borderRadius: '12px', color: 'white', outline: 'none' }}
                  />
                </div>

                {/* DOB */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 600 }}>DATE OF BIRTH</label>
                  <input 
                    type="date"
                    value={newDob}
                    onChange={(e) => setNewDob(e.target.value)}
                    style={{ width: '100%', padding: '16px', fontSize: '1.1rem', backgroundColor: '#1e293b', border: '2px solid #334155', borderRadius: '12px', color: 'white', outline: 'none' }}
                  />
                </div>

                {/* Blood Group */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: '#94a3b8', marginBottom: '8px', fontWeight: 600 }}>BLOOD GROUP</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map(bg => (
                      <button
                        key={bg}
                        type="button"
                        onClick={() => setBloodGroup(bg)}
                        style={{
                          padding: '12px',
                          fontSize: '1rem',
                          backgroundColor: bloodGroup === bg ? 'var(--color-primary)' : '#1e293b',
                          border: bloodGroup === bg ? 'none' : '2px solid #334155',
                          borderRadius: '8px',
                          color: 'white',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          transition: 'all 0.1s'
                        }}
                      >
                        {bg}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <button 
                  onClick={() => setStatus('IDLE')}
                  style={{ flex: 1, padding: '20px', fontSize: '1.1rem', backgroundColor: '#334155', color: 'white', border: 'none', borderRadius: '16px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    if (!newName || !newDob) return;
                    setStatus('LOADING');
                    try {
                      const res = await fetch('/api/kiosk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          phone,
                          registerNew: true,
                          name: newName,
                          dob: newDob,
                          bloodGroup
                        })
                      });
                      const data = await res.json();
                      if (res.ok) {
                        setVisitInfo(data);
                        setStatus('SUCCESS');
                        setTimeout(() => {
                          setStatus('IDLE');
                          setPhone('');
                          setNewName('');
                          setVisitInfo(null);
                        }, 10000);
                      } else {
                        setErrorMessage(data.error || 'Registration failed');
                        setStatus('ERROR');
                      }
                    } catch (e) {
                      setErrorMessage('Network error during registration.');
                      setStatus('ERROR');
                    }
                  }}
                  disabled={!newName || !newDob}
                  style={{ flex: 2, padding: '20px', fontSize: '1.1rem', backgroundColor: (newName && newDob) ? '#10b981' : '#334155', color: 'white', border: 'none', borderRadius: '16px', cursor: (newName && newDob) ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}
                >
                  Submit & Check-in
                </button>
              </div>
            </motion.div>
          )}

          {status === 'SUCCESS' && visitInfo && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ width: '100%', maxWidth: '500px', backgroundColor: '#064e3b', padding: '48px', borderRadius: '24px', textAlign: 'center' }}>
              <CheckCircle2 size={80} color="#34d399" style={{ margin: '0 auto 32px' }} />
              <h2 style={{ fontSize: '2.5rem', marginBottom: '8px', color: 'white' }}>Welcome back,</h2>
              <h1 style={{ fontSize: '3rem', fontWeight: 800, marginBottom: '32px', color: '#a7f3d0' }}>{visitInfo.visit.patient.name}</h1>
              
              <div style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '24px', borderRadius: '16px', textAlign: 'left', marginBottom: '32px' }}>
                <div style={{ fontSize: '1rem', color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Your Destination</div>
                <div style={{ fontSize: '1.5rem', color: 'white', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Triage Nurse Station</span>
                  <span>Room 102</span>
                </div>
              </div>

              <p style={{ fontSize: '1.25rem', color: '#a7f3d0' }}>
                Estimated Wait: <strong>{visitInfo.waitTimeEstimate} mins</strong>
              </p>
              
              <div style={{ marginTop: '48px', height: '4px', width: '100%', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                <motion.div 
                  initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: 10, ease: 'linear' }}
                  style={{ height: '100%', backgroundColor: '#34d399' }}
                />
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
