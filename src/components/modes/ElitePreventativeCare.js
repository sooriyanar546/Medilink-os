'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bot, Sparkles, Cpu, Sliders, Sun, CloudRain, Wind, Navigation, MapPin, 
  Activity, Heart, Moon, Zap, Coffee, Sunrise, Sunset, Apple, Droplet, 
  Layers, User, Dna, Eye, FileText, FlaskConical, Database, Mic, Volume2, 
  Play, Square, Pill, Package, ShoppingCart, UserCheck, Video, RotateCcw, 
  Clock, Trophy, Percent, ChevronRight, CheckCircle2, AlertTriangle, Shield,
  Terminal, BarChart2, Info, ChevronDown, Check, PlayCircle, ShieldAlert,
  PlusCircle, Save, Loader2, RefreshCw, Wifi, WifiOff
} from 'lucide-react';
import { triggerNativeHaptic } from '@/lib/native';
import { useHospitalStore } from '@/store/useHospitalStore';

// Audio chimes helper
const playChime = (type = 'success') => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    if (type === 'success') {
      osc.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      gain.gain.setValueAtTime(0.08, audioContext.currentTime);
      osc.start();
      osc.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.15); // E5
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.45);
      osc.stop(audioContext.currentTime + 0.45);
    } else if (type === 'alert') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(293.66, audioContext.currentTime); // D4
      gain.gain.setValueAtTime(0.12, audioContext.currentTime);
      osc.start();
      osc.frequency.setValueAtTime(220.00, audioContext.currentTime + 0.15); // A3
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      osc.stop(audioContext.currentTime + 0.5);
    } else {
      osc.frequency.setValueAtTime(440.00, audioContext.currentTime); // A4
      gain.gain.setValueAtTime(0.04, audioContext.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      osc.stop(audioContext.currentTime + 0.1);
    }
  } catch (e) {
    console.warn('AudioContext blocked or failed:', e);
  }
};

export default function ElitePreventativeCare({ onClose }) {
  const showToast = useHospitalStore(state => state.showToast);
  const { data: session } = useSession();

  // ─── Live Vitals Data Layer ────────────────────────────────────────────────
  // Fetches the 30 most recent vital logs from /api/vitals on mount.
  // Seeds biometrics state from the most recent record so the UI reflects
  // real patient data instead of static defaults.
  const [vitalHistory, setVitalHistory] = useState([]);         // Full log array from DB
  const [isLoadingVitals, setIsLoadingVitals] = useState(false);
  const [vitalsError, setVitalsError] = useState(null);
  const [showVitalLogger, setShowVitalLogger] = useState(false); // Floating logger panel
  const [isSavingVital, setIsSavingVital] = useState(false);
  const [vitalSaveSuccess, setVitalSaveSuccess] = useState(false);

  // Form fields for the vital logger panel
  const [vitalForm, setVitalForm] = useState({
    heartRate: '',
    bp_systolic: '',
    bp_diastolic: '',
    spo2: '',
    weight: '',
    glucose: '',
    temperature: '',
    notes: '',
  });

  // Fetch vital history on mount
  const fetchVitals = useCallback(async () => {
    if (!session?.user) return;
    setIsLoadingVitals(true);
    setVitalsError(null);
    try {
      const res = await fetch('/api/vitals?limit=30');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const logs = json.data || [];
      setVitalHistory(logs);

      // Seed biometrics UI from the most recent log entry if available
      if (logs.length > 0) {
        const latest = logs[0];
        setBiometrics(prev => ({
          rhr:         latest.heartRate     ?? prev.rhr,
          hrv:         prev.hrv,            // HRV not tracked in VitalLog — keep computed
          sleep:       prev.sleep,
          immuneScore: prev.immuneScore,
        }));
        // Update slider with latest weight-derived nutrition proxy if available
        if (latest.weight) {
          setSliders(prev => ({ ...prev, nutritionScore: Math.min(100, Math.round(latest.weight)) }));
        }
      }
    } catch (err) {
      console.error('[ElitePreventativeCare] fetchVitals error:', err);
      setVitalsError(err.message);
    } finally {
      setIsLoadingVitals(false);
    }
  }, [session?.user]);

  useEffect(() => {
    fetchVitals();
  }, [fetchVitals]);

  // POST a new vital log to /api/vitals
  const handleLogVitals = async (e) => {
    e?.preventDefault();
    if (isSavingVital) return;

    // Validate at least one field filled
    const hasValue = Object.entries(vitalForm)
      .filter(([k]) => k !== 'notes')
      .some(([, v]) => v !== '');
    if (!hasValue) {
      showToast('Please enter at least one vital measurement.', 'error');
      return;
    }

    setIsSavingVital(true);
    setVitalSaveSuccess(false);
    try {
      const payload = {
        ...(vitalForm.heartRate    && { heartRate:    parseInt(vitalForm.heartRate) }),
        ...(vitalForm.bp_systolic  && { bp_systolic:  parseInt(vitalForm.bp_systolic) }),
        ...(vitalForm.bp_diastolic && { bp_diastolic: parseInt(vitalForm.bp_diastolic) }),
        ...(vitalForm.spo2         && { spo2:         parseInt(vitalForm.spo2) }),
        ...(vitalForm.weight       && { weight:       parseFloat(vitalForm.weight) }),
        ...(vitalForm.glucose      && { glucose:      parseFloat(vitalForm.glucose) }),
        ...(vitalForm.temperature  && { temperature:  parseFloat(vitalForm.temperature) }),
        ...(vitalForm.notes        && { notes:        vitalForm.notes }),
      };

      const res = await fetch('/api/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const saved = await res.json();

      // Optimistic UI: prepend to local history without re-fetch
      setVitalHistory(prev => [saved, ...prev]);

      // Update biometric synthesizer UI with new readings (server-authoritative timestamp)
      if (saved.heartRate) {
        setBiometrics(prev => ({ ...prev, rhr: saved.heartRate }));
      }

      // Award longevity points for consistent tracking
      setLongevityPoints(prev => prev + 50);

      // Reset form and show success
      setVitalForm({ heartRate: '', bp_systolic: '', bp_diastolic: '', spo2: '', weight: '', glucose: '', temperature: '', notes: '' });
      setVitalSaveSuccess(true);
      setTimeout(() => { setVitalSaveSuccess(false); setShowVitalLogger(false); }, 2000);

      playChime('success');
      try { triggerNativeHaptic('success'); } catch (_) {}
      showToast('✅ Vitals saved to your health record.', 'success');
    } catch (err) {
      console.error('[ElitePreventativeCare] handleLogVitals error:', err);
      showToast(`Failed to save vitals: ${err.message}`, 'error');
    } finally {
      setIsSavingVital(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────

  // Main Navigation tabs: dashboard | specs
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Dashboard Sub-navigation: overview | exposome | biometrics | nutrition
  const [subTab, setSubTab] = useState('overview');

  // Specs sub-sections: graph | schema | algorithm | alerts
  const [specsSubTab, setSpecsSubTab] = useState('graph');

  // Pillar 1: Aether AI Orchestrator State
  const [chatTone, setChatTone] = useState('Bio-hacker'); 
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    {
      sender: 'Aether AI',
      text: 'Exposome, Biometrics, and Chrono-Nutrient engines synchronized. Ready to modulate recovery protocol.',
      timestamp: 'Just now'
    }
  ]);

  // Pillar 2: Exposome Shield State
  const [location, setLocation] = useState('Sahara Desert'); 
  const [exposome, setExposome] = useState({
    uvIndex: 11.2,
    aqi: 90,
    pollen: 'Low (Dust)',
    humidity: 8,
    temp: '41°C'
  });

  // Pillar 3: Biometric Synthesizer State
  const [isBiometricAnomaly, setIsBiometricAnomaly] = useState(false);
  const [biometrics, setBiometrics] = useState({
    rhr: 62,
    hrv: 68,
    sleep: 7.8,
    immuneScore: 94
  });

  // Pillar 4: Chrono-Diet State
  const [chronotype, setChronotype] = useState('Lark'); 

  // Pillar 6: Digital Twin Longevity Simulator Sliders
  const [sliders, setSliders] = useState({
    sleepHours: 8,
    nutritionScore: 85,
    stressLevel: 25
  });

  // Pillar 7: Closed-loop Biomarkers State
  const [biomarkers, setBiomarkers] = useState([
    { name: 'Cortisol (Saliva)', value: '18.4 ug/dL', status: 'Elevated' },
    { name: 'hs-CRP (Inflammation)', value: '1.2 mg/L', status: 'Optimal' },
    { name: 'Omega-3 Index', value: '7.2%', status: 'Sub-Optimal (Target: >8%)' }
  ]);
  const [isIngestingBiomarkers, setIsIngestingBiomarkers] = useState(false);

  // Pillar 8: Voice Fatigue Auditor State
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceAnalysisResult, setVoiceAnalysisResult] = useState(null);
  const voiceTimerRef = useRef(null);

  // Pillar 9: Smart Cabinet Micronutrients State
  const [compoundingFormula, setCompoundingFormula] = useState([]);

  // Pillar 10: Mobility Assessment State
  const [isMobilityScanning, setIsMobilityScanning] = useState(false);
  const [mobilityScanProgress, setMobilityScanProgress] = useState(0);
  const [mobilityResult, setMobilityResult] = useState(null);

  // Pillar 11: Epigenetic Age Clock
  const [longevityPoints, setLongevityPoints] = useState(2450);

  // Handle Location-based weather updates
  useEffect(() => {
    if (location === 'Sahara Desert') {
      setExposome({ uvIndex: 11.2, aqi: 90, pollen: 'Low (Dust)', humidity: 8, temp: '41°C' });
    } else if (location === 'New Delhi') {
      setExposome({ uvIndex: 5.2, aqi: 280, pollen: 'High (Weeds)', humidity: 65, temp: '34°C' });
    } else { // Tokyo
      setExposome({ uvIndex: 3.5, aqi: 24, pollen: 'High (Cedar)', humidity: 62, temp: '22°C' });
    }
    recalculateFormula();
  }, [location, sliders.stressLevel]);

  // Recalculate supplements based on location, weather, and stress
  const recalculateFormula = () => {
    let list = [
      { ingredient: 'CoQ10', dose: '100mg', reason: 'Mitochondrial efficiency & cardiac defense' },
      { ingredient: 'L-Theanine', dose: '150mg', reason: 'Alpha brainwave support' },
      { ingredient: 'Vitamin D3', dose: '5000 IU', reason: 'Bone & Immune homeostasis' }
    ];

    if (location === 'New Delhi') {
      list.push({ ingredient: 'N-Acetylcysteine (NAC)', dose: '600mg', reason: 'Oxidative shield (Severe AQI defense)' });
      list.push({ ingredient: 'Selenium', dose: '100mcg', reason: 'Heavy metal detoxification support' });
    } else if (location === 'Sahara Desert') {
      list.push({ ingredient: 'Astaxanthin', dose: '6mg', reason: 'Internal sunscreen / cellular UV protection' });
      list.push({ ingredient: 'Electrolyte Minerals', dose: '400mg', reason: 'Low humidity rehydration support' });
    } else {
      list.push({ ingredient: 'Zinc Picolinate', dose: '15mg', reason: 'T-cell synthesis' });
    }

    if (sliders.stressLevel > 60) {
      list.push({ ingredient: 'Ashwagandha KSM-66', dose: '300mg', reason: 'HPA-axis salivary cortisol suppression' });
    }
    setCompoundingFormula(list);
  };

  // Toggle Anomaly
  const handleToggleBiometricAnomaly = () => {
    setIsBiometricAnomaly(prev => {
      const state = !prev;
      if (state) {
        setBiometrics({ rhr: 71, hrv: 42, sleep: 5.2, immuneScore: 68 });
        playChime('alert');
        try { triggerNativeHaptic('warning'); } catch (err) {}
      } else {
        setBiometrics({ rhr: 62, hrv: 68, sleep: 7.8, immuneScore: 94 });
        playChime('success');
        try { triggerNativeHaptic('light'); } catch (err) {}
      }
      return state;
    });
  };

  // AI Chat submission
  const handleSendPrompt = (e) => {
    e?.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = { sender: 'User', text: chatInput, timestamp: 'Just now' };
    setChatMessages(prev => [...prev, userMsg]);
    const input = chatInput;
    setChatInput('');
    playChime('click');

    setTimeout(() => {
      let responseText = '';
      const lowerInput = input.toLowerCase();

      if (lowerInput.includes('biometric') || lowerInput.includes('hrv') || lowerInput.includes('immune')) {
        responseText = isBiometricAnomaly 
          ? `[System Audit - ${chatTone} Mode]: Critical HRV dip detected. Recommending ashwagandha compounding and extending your sleep window by 90 minutes. Metabolic sequencing active.`
          : `[System Audit - ${chatTone} Mode]: HRV and Resting Heart Rate remain within 1.2 standard deviations of baseline. Immune Index is healthy at 94%. No anomaly alerts.`;
      } else if (lowerInput.includes('location') || lowerInput.includes('weather') || lowerInput.includes('aqi') || lowerInput.includes('pollution')) {
        responseText = `[Environmental Shield - ${chatTone} Mode]: Current Exposome tracks location ${location} with UV Index ${exposome.uvIndex} and AQI ${exposome.aqi}. Compounding Formula auto-modulated to defend against localized environmental stresses.`;
      } else if (lowerInput.includes('supplement') || lowerInput.includes('cabinet') || lowerInput.includes('micronutrient')) {
        responseText = `[Micronutrient Compounding - ${chatTone} Mode]: Supplement compounding cabinet contains ${compoundingFormula.map(x => x.ingredient).join(', ')}. Next batch formulation dispatched for weekly encapsulation.`;
      } else {
        responseText = `[AI Advisor - ${chatTone} Mode]: Acknowledged. Processing health inputs. All sub-agents (Nutrition, Dermatological, Circadian, Exposome) are active and feeding into Orchestration Hub.`;
      }

      setChatMessages(prev => [...prev, {
        sender: 'Aether AI',
        text: responseText,
        timestamp: 'Just now'
      }]);
      playChime('success');
      try { triggerNativeHaptic('light'); } catch (err) {}
    }, 1000);
  };

  // Import Biomarkers
  const handleImportBiomarkers = () => {
    setIsIngestingBiomarkers(true);
    playChime('click');
    
    setTimeout(() => {
      setBiomarkers([
        { name: 'Cortisol (Saliva)', value: '11.2 ug/dL', status: 'Optimal (Normalized)' },
        { name: 'hs-CRP (Inflammation)', value: '0.8 mg/L', status: 'Optimal' },
        { name: 'Omega-3 Index', value: '8.4%', status: 'Optimal (Success Target)' }
      ]);
      setSliders(prev => ({ ...prev, stressLevel: 25 }));
      setLongevityPoints(prev => prev + 150);
      setIsIngestingBiomarkers(false);
      playChime('success');
      try { triggerNativeHaptic('success'); } catch (err) {}
    }, 2000);
  };

  // Recording Simulator
  const handleStartVoiceRecording = () => {
    if (isRecordingVoice) {
      clearInterval(voiceTimerRef.current);
      setIsRecordingVoice(false);
      setRecordingSeconds(0);
      
      const fatigueScore = Math.min(99, Math.round(30 + (sliders.stressLevel * 0.6) + Math.random() * 10));
      let burnoutLevel = 'Low';
      if (fatigueScore > 75) burnoutLevel = 'Critical (Cortisol Spike)';
      else if (fatigueScore > 50) burnoutLevel = 'Moderate';

      setVoiceAnalysisResult({
        jitter: '0.78%',
        onsetSpeed: '184ms',
        tremorFriction: '0.12%',
        fatigueIndex: `${fatigueScore}%`,
        burnoutRisk: burnoutLevel
      });
      playChime('success');
      try { triggerNativeHaptic('success'); } catch (err) {}
    } else {
      setIsRecordingVoice(true);
      setRecordingSeconds(0);
      playChime('click');
      try { triggerNativeHaptic('light'); } catch (err) {}
      
      voiceTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => {
          if (prev >= 4) {
            clearInterval(voiceTimerRef.current);
            setIsRecordingVoice(false);
            const fatigueScore = Math.min(99, Math.round(30 + (sliders.stressLevel * 0.6) + Math.random() * 10));
            let burnoutLevel = 'Low';
            if (fatigueScore > 75) burnoutLevel = 'Critical (Cortisol Spike)';
            else if (fatigueScore > 50) burnoutLevel = 'Moderate';

            setVoiceAnalysisResult({
              jitter: '0.82%',
              onsetSpeed: '190ms',
              tremorFriction: '0.14%',
              fatigueIndex: `${fatigueScore}%`,
              burnoutRisk: burnoutLevel
            });
            playChime('success');
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
  };

  // Mobility squat scan
  const handleStartMobilityScan = () => {
    setIsMobilityScanning(true);
    setMobilityScanProgress(0);
    setMobilityResult(null);
    playChime('click');

    const interval = setInterval(() => {
      setMobilityScanProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsMobilityScanning(false);
          setMobilityResult({
            score: '84/100',
            posture: 'Anterior pelvic tilt (4°)',
            ankleAngle: 'Ankle Dorsiflexion (Left: 31° vs 38°)',
            hipMobility: 'Symmetrical',
            routine: '3m Correction: Calf Stretches & Hip Mobilizations'
          });
          setLongevityPoints(prevPoints => prevPoints + 100);
          playChime('success');
          try { triggerNativeHaptic('success'); } catch (err) {}
          return 100;
        }
        return prev + 10;
      });
    }, 300);
  };

  const calculateBiologicalAge = () => {
    const baseAge = 35.0;
    const sleepModifier = (8 - sliders.sleepHours) * 1.2;
    const nutritionModifier = (85 - sliders.nutritionScore) * 0.08;
    const stressModifier = (sliders.stressLevel - 25) * 0.12;
    const result = baseAge + sleepModifier + nutritionModifier + stressModifier;
    return result.toFixed(1);
  };

  const bioAge = calculateBiologicalAge();
  const rawBioAgeDiff = parseFloat(bioAge) - 35.0;
  const bioAgeDiff = rawBioAgeDiff >= 0 ? `+${rawBioAgeDiff.toFixed(1)}y` : `${rawBioAgeDiff.toFixed(1)}y`;
  const isHealthyTwin = rawBioAgeDiff <= 0;

  return (
    <div className="dashboard-root" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 9999,
      overflowY: 'auto',
      backgroundColor: '#070a13',
      backgroundImage: 'radial-gradient(circle at top, #0f162e 0%, #05080f 100%)',
      color: '#f8fafc',
      fontFamily: 'Inter, sans-serif',
      padding: '24px',
      transition: 'all 0.5s ease',
    }}>
      {/* Dynamic Embedded Styles for Slider and Visualizations */}
      <style dangerouslySetInnerHTML={{__html: `
        /* Premium responsive card wrapper */
        .premium-card {
          background: rgba(22, 30, 49, 0.65);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 24px;
          padding: 32px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }

        /* Premium custom sliders */
        input[type=range].custom-slider {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range].custom-slider:focus {
          outline: none;
        }
        input[type=range].custom-slider::-webkit-slider-runnable-track {
          width: 100%;
          height: 6px;
          cursor: pointer;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 99px;
        }
        input[type=range].custom-slider::-webkit-slider-thumb {
          height: 18px;
          width: 18px;
          border-radius: 50%;
          cursor: pointer;
          -webkit-appearance: none;
          margin-top: -6px;
          box-shadow: 0 0 10px rgba(255,255,255,0.2);
          transition: transform 0.15s, background-color 0.15s;
        }
        input[type=range].custom-slider.slider-green::-webkit-slider-thumb {
          background: #10b981;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
        }
        input[type=range].custom-slider.slider-pink::-webkit-slider-thumb {
          background: #f43f5e;
          box-shadow: 0 0 12px rgba(244, 63, 94, 0.5);
        }
        input[type=range].custom-slider::-webkit-slider-thumb:hover {
          transform: scale(1.25);
        }

        /* Animated voice wave visualizer */
        .wave-container {
          display: flex;
          align-items: center;
          gap: 3px;
          height: 28px;
        }
        .wave-bar {
          width: 3px;
          height: 4px;
          background-color: #f43f5e;
          border-radius: 10px;
          transition: height 0.15s ease;
        }
        .wave-active .wave-bar {
          animation: wavePulse 1.2s infinite ease-in-out;
        }
        .wave-active .wave-bar:nth-child(2) { animation-delay: 0.15s; }
        .wave-active .wave-bar:nth-child(3) { animation-delay: 0.3s; }
        .wave-active .wave-bar:nth-child(4) { animation-delay: 0.45s; }
        .wave-active .wave-bar:nth-child(5) { animation-delay: 0.6s; }

        @keyframes wavePulse {
          0%, 100% { height: 6px; }
          50% { height: 26px; }
        }

        /* Sci-Fi Camera scanner styles */
        .scanner-view {
          position: relative;
          overflow: hidden;
          background: rgba(0,0,0,0.4);
          border: 1px solid rgba(6, 182, 212, 0.2);
          border-radius: 16px;
        }
        .scanner-line {
          position: absolute;
          left: 0;
          width: 100%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #06b6d4, transparent);
          box-shadow: 0 0 8px #06b6d4;
          animation: scanLine 2s infinite linear;
          pointer-events: none;
        }
        @keyframes scanLine {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }

        /* Custom scrollbar for message threads */
        .premium-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .premium-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .premium-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 99px;
        }
        .premium-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        /* Pulsing node styles for SVG */
        @keyframes svgPulse {
          0% { r: 3px; opacity: 1; }
          100% { r: 9px; opacity: 0; }
        }
        .pulse-ring {
          animation: svgPulse 1.8s infinite ease-out;
        }

        /* Responsive Mobile Styles */
        @media (max-width: 768px) {
          .dashboard-root {
            padding: 12px !important;
          }
          .premium-card {
            padding: 16px !important;
            border-radius: 16px !important;
          }
          .navbar-header {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 16px !important;
            text-align: center !important;
          }
          .navbar-header > div {
            justify-content: center !important;
            flex-wrap: wrap !important;
          }
          .subnav-container {
            justify-content: flex-start !important;
            overflow-x: auto !important;
            padding-bottom: 8px !important;
            gap: 8px !important;
            width: 100% !important;
            white-space: nowrap !important;
            -webkit-overflow-scrolling: touch !important;
          }
          .subnav-container button {
            flex-shrink: 0 !important;
          }
          .responsive-grid {
            grid-template-columns: 1fr !important;
            gap: 20px !important;
          }
          .biomarker-grid {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
          .responsive-flex {
            flex-direction: column !important;
            align-items: center !important;
            text-align: center !important;
            gap: 16px !important;
          }
          .specs-container {
            grid-template-columns: 1fr !important;
            gap: 20px !important;
            padding: 16px !important;
            border-radius: 16px !important;
          }
          .specs-sidebar {
            border-right: none !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
            padding-right: 0 !important;
            padding-bottom: 16px !important;
          }
        }

        @media (max-width: 480px) {
          .product-line {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 12px !important;
          }
        }
      `}} />

      {/* Top Navbar */}
      <div className="navbar-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        paddingBottom: '16px',
        marginBottom: '32px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #10b981, #06b6d4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 25px rgba(16, 185, 129, 0.25)'
          }}>
            <Dna color="white" size={24} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em', background: 'linear-gradient(to right, #10b981, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              AETHERIS
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Longevity Autopilot System
            </p>
          </div>
        </div>

        {/* Main Tabs */}
        <div style={{ display: 'flex', gap: '6px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '4px', borderRadius: '99px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button 
            onClick={() => { playChime('click'); setActiveTab('dashboard'); }}
            style={{
              padding: '8px 20px',
              borderRadius: '99px',
              fontSize: '13px',
              fontWeight: 700,
              backgroundColor: activeTab === 'dashboard' ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
              color: activeTab === 'dashboard' ? '#10b981' : '#94a3b8',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            <BarChart2 size={14} />
            Autopilot Vitality
          </button>
          <button 
            onClick={() => { playChime('click'); setActiveTab('specs'); }}
            style={{
              padding: '8px 20px',
              borderRadius: '99px',
              fontSize: '13px',
              fontWeight: 700,
              backgroundColor: activeTab === 'specs' ? 'rgba(6, 182, 212, 0.12)' : 'transparent',
              color: activeTab === 'specs' ? '#22d3ee' : '#94a3b8',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            <Terminal size={14} />
            System Sandbox
          </button>
        </div>

        {/* Log Vitals CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Live sync status indicator */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: '99px',
            background: vitalsError
              ? 'rgba(239,68,68,0.08)'
              : isLoadingVitals
                ? 'rgba(255,255,255,0.04)'
                : 'rgba(16,185,129,0.08)',
            border: `1px solid ${vitalsError ? 'rgba(239,68,68,0.2)' : isLoadingVitals ? 'rgba(255,255,255,0.1)' : 'rgba(16,185,129,0.2)'}`,
            fontSize: 11, fontWeight: 600,
            color: vitalsError ? '#f87171' : isLoadingVitals ? '#94a3b8' : '#10b981',
          }}>
            {isLoadingVitals
              ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Syncing...</>
              : vitalsError
                ? <><WifiOff size={11} /> Offline</>
                : <><Wifi size={11} /> {vitalHistory.length} logs synced</>
            }
          </div>

          <motion.button
            onClick={() => { setShowVitalLogger(true); playChime('click'); }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '10px 18px', borderRadius: '99px', fontSize: '13px', fontWeight: 700,
              background: 'linear-gradient(135deg, #10b981, #06b6d4)',
              color: 'white', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 4px 16px rgba(16,185,129,0.3)',
            }}
          >
            <PlusCircle size={14} /> Log Vitals
          </motion.button>

          <button
            onClick={() => { playChime('alert'); onClose(); }}
            style={{
              padding: '10px 20px', borderRadius: '99px', fontSize: '13px', fontWeight: 700,
              backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.2)', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            Exit Dashboard
          </button>
        </div>
      </div>

      {/* ─── LIVE VITALS LOGGER MODAL ──────────────────────────────────────── */}
      <AnimatePresence>
        {showVitalLogger && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 99999,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(16px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '24px',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowVitalLogger(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              style={{
                width: '100%', maxWidth: 520,
                background: 'linear-gradient(145deg, #0f1628, #131e36)',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 24, padding: 32,
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 60px rgba(16,185,129,0.06)',
              }}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 20px rgba(16,185,129,0.3)',
                }}>
                  <Activity size={20} color="white" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                    Log Today's Vitals
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                    Saved to your secure health record with server timestamp
                  </p>
                </div>
                <button onClick={() => setShowVitalLogger(false)} style={{
                  marginLeft: 'auto', background: 'none', border: 'none',
                  color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1,
                }}>×</button>
              </div>

              {vitalSaveSuccess ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ textAlign: 'center', padding: '24px 0' }}
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 12px' }} />
                  </motion.div>
                  <p style={{ color: '#10b981', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                    Vitals Saved & Synced ✓
                  </p>
                  <p style={{ color: '#64748b', fontSize: '0.8125rem', marginTop: 6 }}>
                    +50 Longevity Points earned
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleLogVitals}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                    {[
                      { key: 'heartRate',    label: 'Heart Rate',    unit: 'bpm',  type: 'number', min: 30,  max: 250 },
                      { key: 'spo2',         label: 'SpO₂',          unit: '%',    type: 'number', min: 50,  max: 100 },
                      { key: 'bp_systolic',  label: 'BP Systolic',   unit: 'mmHg', type: 'number', min: 50,  max: 300 },
                      { key: 'bp_diastolic', label: 'BP Diastolic',  unit: 'mmHg', type: 'number', min: 20,  max: 200 },
                      { key: 'glucose',      label: 'Blood Glucose', unit: 'mg/dL',type: 'number', min: 10,  max: 999 },
                      { key: 'weight',       label: 'Weight',        unit: 'kg',   type: 'number', min: 1,   max: 400 },
                      { key: 'temperature',  label: 'Temperature',   unit: '°C',   type: 'number', min: 30,  max: 45  },
                    ].map(({ key, label, unit, type, min, max }) => (
                      <div key={key}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {label} <span style={{ color: '#475569', fontWeight: 400 }}>({unit})</span>
                        </label>
                        <input
                          type={type}
                          min={min}
                          max={max}
                          value={vitalForm[key]}
                          onChange={(e) => setVitalForm(prev => ({ ...prev, [key]: e.target.value }))}
                          placeholder={`e.g. ${key === 'heartRate' ? '72' : key === 'spo2' ? '98' : key === 'bp_systolic' ? '120' : key === 'bp_diastolic' ? '80' : key === 'glucose' ? '95' : key === 'weight' ? '70' : '36.6'}`}
                          style={{
                            width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 10, color: '#f1f5f9', fontSize: '0.9375rem', fontFamily: 'inherit',
                            outline: 'none', transition: 'border-color 0.15s',
                          }}
                          onFocus={(e) => e.target.style.borderColor = 'rgba(16,185,129,0.5)'}
                          onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Notes field — full width */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Notes <span style={{ color: '#475569', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <textarea
                      value={vitalForm.notes}
                      onChange={(e) => setVitalForm(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="e.g. Measured post-exercise, fasting state, morning reading..."
                      rows={2}
                      style={{
                        width: '100%', padding: '10px 12px', boxSizing: 'border-box', resize: 'none',
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10, color: '#f1f5f9', fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none',
                      }}
                      onFocus={(e) => e.target.style.borderColor = 'rgba(16,185,129,0.5)'}
                      onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                    />
                  </div>

                  {/* Recent history strip */}
                  {vitalHistory.length > 0 && (
                    <div style={{ marginBottom: 20, padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
                      <p style={{ margin: '0 0 8px', fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Last recorded · {new Date(vitalHistory[0].measuredAt).toLocaleDateString()}
                      </p>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {vitalHistory[0].heartRate   && <span style={{ fontSize: '0.8rem', color: '#f43f5e' }}>❤ {vitalHistory[0].heartRate} bpm</span>}
                        {vitalHistory[0].bp_systolic && <span style={{ fontSize: '0.8rem', color: '#60a5fa' }}>🩸 {vitalHistory[0].bp_systolic}/{vitalHistory[0].bp_diastolic} mmHg</span>}
                        {vitalHistory[0].spo2        && <span style={{ fontSize: '0.8rem', color: '#10b981' }}>💨 {vitalHistory[0].spo2}% SpO₂</span>}
                        {vitalHistory[0].glucose     && <span style={{ fontSize: '0.8rem', color: '#f59e0b' }}>🩸 {vitalHistory[0].glucose} mg/dL</span>}
                      </div>
                    </div>
                  )}

                  <motion.button
                    type="submit"
                    disabled={isSavingVital}
                    whileHover={{ scale: isSavingVital ? 1 : 1.02 }}
                    whileTap={{ scale: isSavingVital ? 1 : 0.98 }}
                    style={{
                      width: '100%', padding: '13px',
                      background: isSavingVital ? '#374151' : 'linear-gradient(135deg, #10b981, #06b6d4)',
                      color: 'white', border: 'none', borderRadius: 12, fontSize: '0.9375rem',
                      fontWeight: 700, cursor: isSavingVital ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: isSavingVital ? 'none' : '0 8px 24px rgba(16,185,129,0.3)',
                      transition: 'all 0.2s',
                    }}
                  >
                    {isSavingVital
                      ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Saving to health record...</>
                      : <><Save size={16} /> Save Vitals to Record</>
                    }
                  </motion.button>

                  <p style={{ textAlign: 'center', fontSize: '0.7rem', color: '#374151', marginTop: 10 }}>
                    🔒 Timestamp is server-generated · Stored in your encrypted health record
                  </p>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sub-Navigation for dashboard tabs */}
      {activeTab === 'dashboard' && (
        <div className="subnav-container" style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '12px',
          marginBottom: '36px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          paddingBottom: '16px'
        }}>
          {[
            { id: 'overview', label: 'Biological Twin', icon: User, color: '#10b981' },
            { id: 'exposome', label: 'Environmental Shield', icon: Sun, color: '#f59e0b' },
            { id: 'biometrics', label: 'Biometrics & Telemetry', icon: Activity, color: '#f43f5e' },
            { id: 'nutrition', label: 'Circadian Metabolic', icon: Coffee, color: '#8b5cf6' }
          ].map((item) => {
            const IconComponent = item.icon;
            const isSelected = subTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { playChime('click'); setSubTab(item.id); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 22px',
                  borderRadius: '16px',
                  fontSize: '14px',
                  fontWeight: 600,
                  backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                  color: isSelected ? item.color : '#64748b',
                  border: isSelected ? `1px solid rgba(255,255,255,0.06)` : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.25s ease',
                  boxShadow: isSelected ? `0 4px 20px ${item.color}08` : 'none'
                }}
              >
                <IconComponent size={16} color={isSelected ? item.color : '#64748b'} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      {/* DASHBOARD CONTENT FIELDS */}
      {activeTab === 'dashboard' && (
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <AnimatePresence mode="wait">
            
            {/* SUB-TAB 1: Overview */}
            {subTab === 'overview' && (
              <motion.div 
                key="overview"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="responsive-grid"
                style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px' }}
              >
                {/* Left Column: Digital Twin */}
                <div className="premium-card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '24px'
                }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <User size={20} color="#06b6d4" />
                      Biological Twin Projection
                    </h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                      Dynamic biological velocity simulation based on lifestyle modifiers.
                    </p>
                  </div>

                  <div className="responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: '24px', alignItems: 'center' }}>
                    
                    {/* SVG Biological Twin Avatar */}
                    <div style={{ 
                      position: 'relative', 
                      height: '240px', 
                      backgroundColor: 'rgba(0,0,0,0.3)', 
                      borderRadius: '16px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      border: '1px solid rgba(255,255,255,0.03)',
                      overflow: 'hidden'
                    }}>
                      <svg width="100" height="200" viewBox="0 0 100 140" style={{ filter: 'drop-shadow(0 0 12px rgba(6,182,212,0.15))' }}>
                        <defs>
                          <filter id="svgGlow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                          </filter>
                        </defs>
                        {/* Glowing Body Outline */}
                        <g opacity="0.85">
                          {/* Head */}
                          <circle cx="50" cy="22" r="10" fill="none" stroke={isHealthyTwin ? '#10b981' : '#f59e0b'} strokeWidth="1.5" />
                          {/* Neck & Spine */}
                          <path d="M 50,32 L 50,80" stroke={isHealthyTwin ? '#10b981' : '#f59e0b'} strokeWidth="1.5" strokeLinecap="round" />
                          {/* Chest / Ribs */}
                          <path d="M 40,44 L 60,44 M 38,53 L 62,53 M 40,62 L 60,62" stroke={isHealthyTwin ? '#10b981' : '#f59e0b'} strokeWidth="1" opacity="0.6" />
                          {/* Hips */}
                          <path d="M 44,80 L 56,80" stroke={isHealthyTwin ? '#10b981' : '#f59e0b'} strokeWidth="1.5" />
                          {/* Arms */}
                          <path d="M 38,38 Q 28,52 24,70 M 62,38 Q 72,52 76,70" fill="none" stroke={isHealthyTwin ? '#10b981' : '#f59e0b'} strokeWidth="1.5" strokeLinecap="round" />
                          {/* Legs */}
                          <path d="M 45,80 Q 40,105 38,130 M 55,80 Q 60,105 62,130" fill="none" stroke={isHealthyTwin ? '#10b981' : '#f59e0b'} strokeWidth="1.5" strokeLinecap="round" />
                        </g>

                        {/* Interactive hotspot nodes */}
                        {/* Brain */}
                        <circle cx="50" cy="22" r="3" fill="#06b6d4" filter="url(#svgGlow)" />
                        <circle cx="50" cy="22" r="3" fill="none" stroke="#06b6d4" strokeWidth="1" className="pulse-ring" />

                        {/* Heart */}
                        <circle cx="50" cy="46" r="3.5" fill="#f43f5e" filter="url(#svgGlow)" />
                        <circle cx="50" cy="46" r="3.5" fill="none" stroke="#f43f5e" strokeWidth="1" className="pulse-ring" />

                        {/* Gut */}
                        <circle cx="50" cy="68" r="3" fill="#a855f7" filter="url(#svgGlow)" />
                        
                        {/* Joints */}
                        <circle cx="45" cy="80" r="2.5" fill="#3b82f6" />
                        <circle cx="55" cy="80" r="2.5" fill="#3b82f6" />
                      </svg>
                      
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '4px 10px',
                        borderRadius: '99px',
                        backgroundColor: isHealthyTwin ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: isHealthyTwin ? '#10b981' : '#f59e0b',
                        border: `1px solid ${isHealthyTwin ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase'
                      }}>
                        {isHealthyTwin ? 'Age Deceleration' : 'Age Acceleration'}
                      </div>
                    </div>
 
                    {/* Age project readout & sliders */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.04)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Projected Bio-Age</div>
                        <div style={{ fontSize: '2rem', fontWeight: 900, color: isHealthyTwin ? '#10b981' : '#f43f5e', marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                          {bioAge}y 
                          <span style={{ fontSize: '13px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', backgroundColor: isHealthyTwin ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)', color: isHealthyTwin ? '#10b981' : '#f43f5e' }}>{bioAgeDiff}</span>
                        </div>
                      </div>

                      {/* Sliders Container */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: '#94a3b8', fontWeight: 500 }}>Sleep Window</span>
                            <span style={{ color: '#10b981', fontWeight: 700 }}>{sliders.sleepHours} hrs</span>
                          </div>
                          <input 
                            type="range" min="4" max="10" step="0.5" 
                            className="custom-slider slider-green"
                            value={sliders.sleepHours} 
                            onChange={(e) => { setSliders(prev => ({ ...prev, sleepHours: parseFloat(e.target.value) })); }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: '#94a3b8', fontWeight: 500 }}>Systemic Stress</span>
                            <span style={{ color: '#f43f5e', fontWeight: 700 }}>{sliders.stressLevel}%</span>
                          </div>
                          <input 
                            type="range" min="0" max="100" 
                            className="custom-slider slider-pink"
                            value={sliders.stressLevel} 
                            onChange={(e) => { setSliders(prev => ({ ...prev, stressLevel: parseInt(e.target.value) })); }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Epigenetic Score Card */}
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(6, 182, 212, 0.04))',
                    border: '1px solid rgba(16, 185, 129, 0.15)',
                    borderRadius: '16px',
                    padding: '16px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(234,179,8,0.1)', display: 'flex', alignItems: 'center', justifyCenter: 'center', display: 'flex', justifyContent: 'center' }}>
                        <Trophy color="#f59e0b" size={18} style={{ alignSelf: 'center' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.02em' }}>Epigenetic Clock Speed</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
                          0.82y/y <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 700, marginLeft: '4px' }}>(Decelerated Rate)</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.02em' }}>Longevity Score</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#06b6d4', marginTop: '2px' }}>{longevityPoints} <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>pts</span></div>
                    </div>
                  </div>
                </div>

                {/* Right Column: AI Chat */}
                <div className="premium-card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Bot size={20} color="#10b981" />
                        Aether AI Assistant
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Proactive longevity coordinator.</p>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', backgroundColor: 'rgba(0,0,0,0.25)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      {['Bio-hacker', 'Calm', 'Clinical'].map((t) => (
                        <button
                          key={t}
                          onClick={() => { playChime('click'); setChatTone(t); }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: chatTone === t ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                            color: chatTone === t ? '#10b981' : '#64748b',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Chat Messages */}
                  <div className="premium-scroll" style={{
                    height: '210px',
                    overflowY: 'auto',
                    backgroundColor: 'rgba(0,0,0,0.18)',
                    borderRadius: '16px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    fontSize: '0.88rem',
                    border: '1px solid rgba(255,255,255,0.02)'
                  }}>
                    {chatMessages.map((msg, i) => (
                      <div key={i} style={{
                        alignSelf: msg.sender === 'User' ? 'flex-end' : 'flex-start',
                        background: msg.sender === 'User' 
                          ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.15) 100%)' 
                          : 'linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(5, 150, 105, 0.06) 100%)',
                        border: msg.sender === 'User' ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(16, 185, 129, 0.15)',
                        padding: '10px 14px',
                        borderRadius: msg.sender === 'User' ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                        maxWidth: '85%',
                        color: msg.sender === 'User' ? '#93c5fd' : '#a7f3d0',
                        lineHeight: '1.4'
                      }}>
                        <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '3px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{msg.sender}</div>
                        <div>{msg.text}</div>
                      </div>
                    ))}
                  </div>

                  {/* Input Form */}
                  <form onSubmit={handleSendPrompt} style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Audit biometrics, environment shielding..."
                      style={{
                        flex: 1,
                        backgroundColor: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '12px',
                        color: '#f8fafc',
                        fontSize: '13px',
                        padding: '10px 16px',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#10b981'}
                      onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.06)'}
                    />
                    <button 
                      type="submit"
                      style={{
                        backgroundColor: '#10b981',
                        border: 'none',
                        borderRadius: '12px',
                        color: '#070a13',
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
                      }}
                    >
                      Send
                    </button>
                  </form>

                  {/* Quick Prompts */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Synthesize Diagnostics', text: 'Run daily diagnostic synthesis' },
                      { label: 'Analyze HRV Dip', text: 'Evaluate HRV immune dip risk' }
                    ].map((p, idx) => (
                      <button 
                        key={idx}
                        type="button" 
                        onClick={() => { setChatInput(p.text); }}
                        style={{ 
                          fontSize: '11px', 
                          fontWeight: 600,
                          background: 'rgba(255,255,255,0.02)', 
                          border: '1px solid rgba(255,255,255,0.06)', 
                          borderRadius: '8px', 
                          color: '#94a3b8', 
                          padding: '6px 12px', 
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { e.target.style.borderColor = '#10b981'; e.target.style.color = '#10b981'; }}
                        onMouseLeave={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.06)'; e.target.style.color = '#94a3b8'; }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* SUB-TAB 2: Exposome */}
            {subTab === 'exposome' && (
              <motion.div 
                key="exposome"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="responsive-grid"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
              >
                {/* Climate Exposome Shield */}
                <div className="premium-card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '24px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Sun size={20} color="#f59e0b" />
                        Exposome Environment Shield
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Real-time location weather variables.</p>
                    </div>
                    {/* Styled Selector */}
                    <div style={{ position: 'relative' }}>
                      <select 
                        value={location} 
                        onChange={(e) => { playChime('click'); setLocation(e.target.value); }}
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          color: '#f8fafc',
                          borderRadius: '10px',
                          fontSize: '12px',
                          padding: '6px 14px',
                          cursor: 'pointer',
                          fontWeight: 700,
                          outline: 'none',
                          appearance: 'none',
                          paddingRight: '30px'
                        }}
                      >
                        <option value="Sahara Desert">Sahara Desert</option>
                        <option value="New Delhi">New Delhi</option>
                        <option value="Tokyo">Tokyo</option>
                      </select>
                      <ChevronDown size={12} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    </div>
                  </div>

                  {/* Grid Metrics */}
                  <div className="biomarker-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {[
                      { label: 'UV Radiation', val: exposome.uvIndex, status: exposome.uvIndex > 8 ? 'Extreme Risk' : 'Moderate', color: exposome.uvIndex > 8 ? '#f43f5e' : '#10b981' },
                      { label: 'Air Quality (AQI)', val: exposome.aqi, status: exposome.aqi > 150 ? 'Hazardous' : 'Excellent', color: exposome.aqi > 150 ? '#f43f5e' : '#10b981' },
                      { label: 'Relative Humidity', val: `${exposome.humidity}%`, status: exposome.humidity < 20 ? 'Arid Dryness' : 'Hydrated', color: '#06b6d4' },
                      { label: 'Active Allergen', val: exposome.pollen, status: 'Weekly Index', color: '#8b5cf6' }
                    ].map((item, idx) => (
                      <div key={idx} style={{ 
                        background: 'rgba(255,255,255,0.02)', 
                        padding: '16px', 
                        borderRadius: '16px', 
                        border: '1px solid rgba(255,255,255,0.03)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{item.label}</span>
                        <span style={{ fontSize: '1.6rem', fontWeight: 900, color: item.color }}>{item.val}</span>
                        <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 700 }}>{item.status}</span>
                      </div>
                    ))}
                  </div>

                  {/* Warning recommendation block */}
                  <div style={{
                    fontSize: '0.85rem',
                    padding: '16px',
                    borderRadius: '16px',
                    backgroundColor: exposome.aqi > 150 || exposome.uvIndex > 8 ? 'rgba(244, 63, 94, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                    border: `1px solid ${exposome.aqi > 150 || exposome.uvIndex > 8 ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)'}`,
                    color: exposome.aqi > 150 || exposome.uvIndex > 8 ? '#fecdd3' : '#a7f3d0',
                    lineHeight: '1.5',
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'flex-start'
                  }}>
                    <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: '2px', color: exposome.aqi > 150 || exposome.uvIndex > 8 ? '#f43f5e' : '#10b981' }} />
                    <div>
                      {location === 'New Delhi' && "Severe AQI environment flagged. Compounding formulation modulated with additional antioxidants (NAC & Selenium). Restrict heavy outdoor ventilation."}
                      {location === 'Sahara Desert' && "Low atmospheric humidity & high UV levels detected. Matcher updated: apply heavy ceramide barriers, SPF 50 Mineral screen, and scale hydration to 4.5L."}
                      {location === 'Tokyo' && "Optimal ambient conditions. Standard circadian metadata active. Ideal daylight exposure window is currently open."}
                    </div>
                  </div>
                </div>

                {/* Skincare Product Matcher */}
                <div className="premium-card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '24px'
                }}>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Droplet size={20} color="#06b6d4" />
                      Dynamic Product Matcher
                    </h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Dermal barriers matched to real-time microclimate shifts.</p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {[
                      {
                        title: exposome.humidity < 20 ? 'Ceramide Lipid Hydration Cream' : 'Niacinamide Oil-Control Gel',
                        subtitle: 'Dermal Barrier Moisturizer Formulation',
                        tag: exposome.humidity < 20 ? 'Barrier Shield' : 'Oil Balancer',
                        color: exposome.humidity < 20 ? '#06b6d4' : '#10b981'
                      },
                      {
                        title: exposome.uvIndex > 8 ? 'Broad-Spectrum SPF 50 Mineral' : 'Daily Broad-Spectrum SPF 30 Serum',
                        subtitle: 'Ultraviolet Filter Shield',
                        tag: exposome.uvIndex > 8 ? 'Heavy Defense' : 'Daily Moderate',
                        color: exposome.uvIndex > 8 ? '#f59e0b' : '#3b82f6'
                      },
                      {
                        title: exposome.humidity < 20 ? '4.5 Liters (Target)' : '2.5 Liters (Standard)',
                        subtitle: 'Systemic Hydration Intake',
                        tag: 'Systemic Moisture',
                        color: '#06b6d4'
                      }
                    ].map((p, idx) => (
                      <div key={idx} className="product-line" style={{
                        background: 'rgba(255,255,255,0.02)',
                        padding: '16px 20px',
                        borderRadius: '16px',
                        border: '1px solid rgba(255,255,255,0.03)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'transform 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'none'}
                      >
                        <div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>{p.title}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '3px' }}>{p.subtitle}</div>
                        </div>
                        <span style={{ 
                          fontSize: '10px', 
                          fontWeight: 800,
                          backgroundColor: `${p.color}15`, 
                          color: p.color, 
                          padding: '4px 10px', 
                          borderRadius: '99px',
                          border: `1px solid ${p.color}25`
                        }}>
                          {p.tag}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* SUB-TAB 3: Biometrics */}
            {subTab === 'biometrics' && (
              <motion.div 
                key="biometrics"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}
              >
                <div className="responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                  
                  {/* Wearable Biometrics */}
                  <div className="premium-card" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Activity size={20} color="#f43f5e" />
                          Wearable Telemetry
                        </h3>
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Ingesting live metrics from HealthKit & Oura.</p>
                      </div>
                      
                      {/* Styled Toggle Button */}
                      <button 
                        onClick={handleToggleBiometricAnomaly}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '99px',
                          fontSize: '11px',
                          fontWeight: 800,
                          backgroundColor: isBiometricAnomaly ? '#f43f5e' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isBiometricAnomaly ? '#f43f5e' : 'rgba(255,255,255,0.08)'}`,
                          color: '#f8fafc',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          boxShadow: isBiometricAnomaly ? '0 0 12px rgba(244, 63, 94, 0.4)' : 'none'
                        }}
                      >
                        {isBiometricAnomaly ? 'ANOMALY TRIGGERED' : 'SIMULATE ANOMALY'}
                      </button>
                    </div>

                    <div className="biomarker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                      {[
                        { label: 'Resting HR', val: biometrics.rhr, unit: 'bpm', color: isBiometricAnomaly ? '#f43f5e' : '#10b981' },
                        { label: 'HRV', val: biometrics.hrv, unit: 'ms', color: isBiometricAnomaly ? '#f43f5e' : '#10b981' },
                        { label: 'Sleep Window', val: biometrics.sleep, unit: 'hrs', color: '#3b82f6' }
                      ].map((item, idx) => (
                        <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', padding: '14px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.03)', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>{item.label}</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: item.color, marginTop: '6px' }}>
                            {item.val} <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{item.unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Wave Status Bar */}
                    <div style={{ 
                      height: '50px', 
                      width: '100%', 
                      position: 'relative', 
                      overflow: 'hidden', 
                      backgroundColor: 'rgba(0,0,0,0.25)', 
                      borderRadius: '12px', 
                      border: '1px solid rgba(255,255,255,0.03)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '0 16px',
                      justifyContent: 'space-between'
                    }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: isBiometricAnomaly ? '#f43f5e' : '#10b981', display: 'inline-block' }} />
                        <span style={{ fontSize: '12px', color: isBiometricAnomaly ? '#f43f5e' : '#10b981', fontWeight: 800 }}>
                          {isBiometricAnomaly ? 'Critical Immune Baseline Dip detected' : 'All Vital Telemetry Signals Stable'}
                        </span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 700 }}>94% SENSITIVITY</span>
                    </div>
                  </div>

                  {/* Voice Fatigue Auditor */}
                  <div className="premium-card" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                  }}>
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Mic size={20} color="#f43f5e" />
                        Voice Fatigue Auditor
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Acoustic tremoring analyzer mapping cortisol indicators.</p>
                    </div>

                    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', padding: '16px', background: 'rgba(0,0,0,0.18)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.02)' }}>
                      <button 
                        onClick={handleStartVoiceRecording}
                        style={{
                          width: '52px',
                          height: '52px',
                          borderRadius: '50%',
                          backgroundColor: isRecordingVoice ? '#f43f5e' : 'rgba(244, 63, 94, 0.12)',
                          border: '2px solid #f43f5e',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          cursor: 'pointer',
                          position: 'relative',
                          flexShrink: 0,
                          transition: 'all 0.2s',
                          boxShadow: isRecordingVoice ? '0 0 15px rgba(244, 63, 94, 0.4)' : 'none'
                        }}
                      >
                        {isRecordingVoice ? <Square size={16} fill="white" /> : <Mic size={20} color="#f43f5e" />}
                      </button>

                      <div style={{ flex: 1 }}>
                        {isRecordingVoice ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 850, color: '#f43f5e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              Recording voice tremors...
                              <div className="wave-container wave-active">
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                              </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Speaking window: {recordingSeconds}s / 4s</div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: '1.4' }}>
                            Click to record, speak a diagnostic phrase, and audit vocal friction to index fatigue.
                          </div>
                        )}
                      </div>
                    </div>

                    {voiceAnalysisResult && (
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: '1fr 1fr', 
                        gap: '10px', 
                        background: 'rgba(255,255,255,0.02)', 
                        padding: '16px', 
                        borderRadius: '16px', 
                        fontSize: '0.8rem', 
                        border: '1px solid rgba(255,255,255,0.03)' 
                      }}>
                        <div><strong style={{ color: '#64748b' }}>Acoustic Jitter:</strong> <span style={{ color: '#f8fafc', fontWeight: 700, marginLeft: '4px' }}>{voiceAnalysisResult.jitter}</span></div>
                        <div><strong style={{ color: '#64748b' }}>Onset Velocity:</strong> <span style={{ color: '#f8fafc', fontWeight: 700, marginLeft: '4px' }}>{voiceAnalysisResult.onsetSpeed}</span></div>
                        <div><strong style={{ color: '#64748b' }}>Fatigue Index:</strong> <span style={{ color: '#f43f5e', fontWeight: 700, marginLeft: '4px' }}>{voiceAnalysisResult.fatigueIndex}</span></div>
                        <div><strong style={{ color: '#64748b' }}>Burnout Risk:</strong> <span style={{ color: '#f43f5e', fontWeight: 700, marginLeft: '4px' }}>{voiceAnalysisResult.burnoutRisk}</span></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Ingested Blood Panel */}
                <div className="premium-card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FlaskConical size={20} color="#06b6d4" />
                        Blood Assay Biomarkers
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Ingested diagnostic assays and biomarker readings.</p>
                    </div>
                    <button 
                      onClick={handleImportBiomarkers}
                      disabled={isIngestingBiomarkers}
                      style={{
                        padding: '8px 18px',
                        borderRadius: '99px',
                        fontSize: '12px',
                        fontWeight: 700,
                        backgroundColor: 'rgba(6, 182, 212, 0.12)',
                        color: '#22d3ee',
                        border: '1px solid rgba(6, 182, 212, 0.25)',
                        cursor: isIngestingBiomarkers ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {isIngestingBiomarkers ? 'Syncing LIMS Panel...' : 'Import Blood Assay'}
                    </button>
                  </div>

                  <div className="biomarker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                    {biomarkers.map((b, i) => (
                      <div key={i} style={{ 
                        display: 'flex', 
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '16px', 
                        background: 'rgba(255,255,255,0.02)', 
                        borderRadius: '16px', 
                        border: '1px solid rgba(255,255,255,0.03)' 
                      }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>{b.name}</span>
                        <span style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 900 }}>{b.value}</span>
                        <span style={{ 
                          fontSize: '10px', 
                          color: b.status.includes('Optimal') ? '#10b981' : '#f59e0b', 
                          fontWeight: 700,
                          backgroundColor: b.status.includes('Optimal') ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          width: 'max-content'
                        }}>
                          {b.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* SUB-TAB 4: Nutrition */}
            {subTab === 'nutrition' && (
              <motion.div 
                key="nutrition"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="responsive-grid"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  
                  {/* Circadian Fasting & Diet */}
                  <div className="premium-card" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Coffee size={20} color="#8b5cf6" />
                          Circadian Fasting
                        </h3>
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Circadian metabolics & intake limitations.</p>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <select 
                          value={chronotype} 
                          onChange={(e) => { playChime('click'); setChronotype(e.target.value); }}
                          style={{
                            backgroundColor: '#0f172a',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#f8fafc',
                            borderRadius: '10px',
                            fontSize: '12px',
                            padding: '6px 14px',
                            cursor: 'pointer',
                            fontWeight: 700,
                            outline: 'none',
                            appearance: 'none',
                            paddingRight: '30px'
                          }}
                        >
                          <option value="Lark">Lark Chronotype</option>
                          <option value="Owl">Owl Chronotype</option>
                        </select>
                        <ChevronDown size={12} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                      </div>
                    </div>

                    <div className="responsive-flex" style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                      {/* Circular Progress Meter */}
                      <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0 }}>
                        <svg width="80" height="80" viewBox="0 0 80 80">
                          {/* Background Track */}
                          <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
                          {/* Progress Circle (Circumference = 2 * pi * r = 201) */}
                          <circle 
                            cx="40" cy="40" r="32" 
                            fill="none" 
                            stroke="#8b5cf6" 
                            strokeWidth="6" 
                            strokeDasharray="201" 
                            strokeDashoffset={201 - (201 * (14.5 / 16))}
                            strokeLinecap="round"
                            transform="rotate(-90 40 40)"
                          />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>
                          <span>14.5h</span>
                          <span style={{ fontSize: '8px', color: '#64748b' }}>of 16h</span>
                        </div>
                      </div>

                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span style={{ color: '#94a3b8' }}>Caffeine Cut-off Boundary:</span>
                          <span style={{ color: '#ca8a04', fontWeight: 800 }}>
                            {chronotype === 'Lark' ? '12:00 PM (Standard)' : '3:00 PM (Shifted)'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.45', padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.15)' }}>
                          <strong>Sequence priority:</strong> Ingest fibrous greens first to slow glucose absorption, then lipids & proteins, and conclude with clean carbohydrates.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Mobility Squat Scan */}
                  <div className="premium-card" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                  }}>
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <UserCheck size={20} color="#06b6d4" />
                        Kinematic Joint Screen
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Dynamic musculoskeletal evaluation checkpoints.</p>
                    </div>

                    {isMobilityScanning ? (
                      /* Sci-Fi Camera Scanner overlay */
                      <div className="scanner-view" style={{ height: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                        <div className="scanner-line"></div>
                        {/* Camera Corner Brackets */}
                        <div style={{ position: 'absolute', top: 12, left: 16, width: 10, height: 10, borderLeft: '2px solid #06b6d4', borderTop: '2px solid #06b6d4' }} />
                        <div style={{ position: 'absolute', top: 12, right: 16, width: 10, height: 10, borderRight: '2px solid #06b6d4', borderTop: '2px solid #06b6d4' }} />
                        <div style={{ position: 'absolute', bottom: 12, left: 16, width: 10, height: 10, borderLeft: '2px solid #06b6d4', borderBottom: '2px solid #06b6d4' }} />
                        <div style={{ position: 'absolute', bottom: 12, right: 16, width: 10, height: 10, borderRight: '2px solid #06b6d4', borderBottom: '2px solid #06b6d4' }} />
                        
                        <div style={{ fontSize: '0.85rem', color: '#06b6d4', fontWeight: 800, letterSpacing: '0.04em' }}>SCREENING JOINTS: SQUAT SEQUENCE</div>
                        <div style={{ width: '70%', height: '4px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: `${mobilityScanProgress}%`, height: '100%', backgroundColor: '#06b6d4', transition: 'width 0.3s' }}></div>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={handleStartMobilityScan}
                        style={{
                          padding: '12px',
                          background: 'rgba(6, 182, 212, 0.1)',
                          border: '1px solid rgba(6, 182, 212, 0.25)',
                          borderRadius: '12px',
                          color: '#22d3ee',
                          fontWeight: 800,
                          fontSize: '13px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <Video size={16} /> Run 30s Squat Kinematics Scan
                      </button>
                    )}

                    {mobilityResult && (
                      <div style={{ 
                        fontSize: '0.8rem', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '6px', 
                        background: 'rgba(255,255,255,0.02)', 
                        padding: '16px', 
                        borderRadius: '16px', 
                        border: '1px solid rgba(255,255,255,0.03)' 
                      }}>
                        <div><strong style={{ color: '#06b6d4' }}>Mobility Rating:</strong> <span style={{ color: '#f8fafc', marginLeft: '4px' }}>{mobilityResult.score}</span></div>
                        <div><strong style={{ color: '#06b6d4' }}>Alignment Deficit:</strong> <span style={{ color: '#f8fafc', marginLeft: '4px' }}>{mobilityResult.posture}</span></div>
                        <div><strong style={{ color: '#06b6d4' }}>Ankle Restriction:</strong> <span style={{ color: '#f8fafc', marginLeft: '4px' }}>{mobilityResult.ankleAngle}</span></div>
                        <div style={{ marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px', color: '#a7f3d0', fontWeight: 600, display: 'flex', gap: '6px' }}>
                          <Info size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                          <span>{mobilityResult.routine}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Micronutrient Compounding Cabinet */}
                <div className="premium-card" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '24px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '14px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Pill size={20} color="#10b981" />
                        Compounding Cabinet
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Custom weekly capsule formulation batching.</p>
                    </div>
                    <span style={{ 
                      backgroundColor: 'rgba(16,185,129,0.12)', 
                      color: '#10b981', 
                      fontWeight: 800, 
                      fontSize: '10px', 
                      padding: '4px 10px', 
                      borderRadius: '99px',
                      border: '1px solid rgba(16,185,129,0.2)' 
                    }}>
                      Active Formula
                    </span>
                  </div>

                  <div className="premium-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '240px', overflowY: 'auto' }}>
                    {compoundingFormula.map((c, i) => (
                      <div key={i} style={{ 
                        padding: '12px 16px', 
                        background: 'rgba(16, 185, 129, 0.03)', 
                        border: '1px solid rgba(16, 185, 129, 0.1)', 
                        borderRadius: '12px', 
                        fontSize: '0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: '#a7f3d0' }}>
                          <span>{c.ingredient}</span>
                          <span style={{ color: '#10b981' }}>{c.dose}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{c.reason}</div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      playChime('success');
                      showToast("Fulfillment center webhook fired. Your next personalized 7-day capsule batch has been compounded!", "success");
                      try { triggerNativeHaptic('success'); } catch (err) {}
                    }}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '12px',
                      backgroundColor: '#10b981',
                      border: 'none',
                      color: '#070a13',
                      fontWeight: 800,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      marginTop: 'auto',
                      transition: 'all 0.2s',
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                    }}
                  >
                    <ShoppingCart size={15} /> Order Custom Compounded Batch
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      )}

      {/* SYSTEM ARCHITECTURE & LOGS TIER */}
      {activeTab === 'specs' && (
        <div className="specs-container" style={{ 
          maxWidth: '1100px', 
          margin: '0 auto', 
          display: 'grid', 
          gridTemplateColumns: '260px 1fr', 
          gap: '32px',
          background: 'rgba(22, 30, 49, 0.5)', 
          backdropFilter: 'blur(20px)',
          padding: '32px', 
          borderRadius: '24px', 
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
        }}>
          {/* Side Menu in Specs */}
          <div className="specs-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: '20px' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>Sandbox Logs</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>Production architectures configured in Antigravity.</p>
            </div>
            {[
              { id: 'graph', label: 'Topology Flow Map', icon: Database },
              { id: 'schema', label: 'Prisma DB Blueprint', icon: FileText },
              { id: 'algorithm', label: 'Biometric Anomaly Logic', icon: Cpu },
              { id: 'alerts', label: 'Exposome Router Logic', icon: Sun }
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = specsSubTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { playChime('click'); setSpecsSubTab(item.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 600,
                    backgroundColor: isSelected ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                    color: isSelected ? '#22d3ee' : '#94a3b8',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Icon size={14} color={isSelected ? '#22d3ee' : '#94a3b8'} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Console Code Output Window */}
          <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              backgroundColor: '#020617',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              flexDirection: 'column',
              height: '420px',
              overflow: 'hidden'
            }}>
              {/* Window Bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', backgroundColor: 'rgba(255,255,255,0.01)' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#eab308' }} />
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                </div>
                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', fontWeight: 600 }}>
                  {specsSubTab === 'graph' && 'topology-map.txt'}
                  {specsSubTab === 'schema' && 'schema.prisma'}
                  {specsSubTab === 'algorithm' && 'biometrics-zscore.ts'}
                  {specsSubTab === 'alerts' && 'exposome-router.ts'}
                </span>
                <span style={{ fontSize: '9px', backgroundColor: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>UTF-8</span>
              </div>

              {/* Code text content area */}
              <pre className="premium-scroll" style={{
                flex: 1,
                padding: '16px',
                fontSize: '12px',
                color: '#34d399',
                overflow: 'auto',
                fontFamily: '"Fira Code", monospace',
                lineHeight: '1.6',
                margin: 0,
                backgroundColor: '#030712'
              }}>
                {specsSubTab === 'graph' && (
                  <code style={{ color: '#22d3ee' }}>{`[Client Wearables (Fitbit/Oura)] ──────┐
                                         ├─> [Biometric Agent] (Anomaly checking) ──┐
[Exposome Sensors (GPS / UV / AQI)] ────┘                                         │
                                                                                  v
[Local Food / Micro-diet DB] ───────────> [Nutrition Agent] (Circadian window) ──> [Central Orchestrator Hub (Aetheris)]
                                                                                  ^
[Genetics & Biomarker Profiles] ────────> [Dermal Agent] (Product matching) ──────┤
                                                                                  │
[Voice Commands & Mic Recording] ───────> [Audio Analytics Agent] (Fatigue) ──────┘
                                                                                  │
                                                                                  v
                                                                        [HITL Clinical Layer]
                                                                                  │
                                                                                  v
                                                                        [Micronutrient Fulfillment Webhook]
                                                                        [Rendered Dynamic User Interface]`}</code>
                )}

                {specsSubTab === 'schema' && (
                  <code>{`// Preventative Care Data Models

model LongevityProfile {
  id                 String              @id @default(uuid())
  patientId          String              @unique
  chronologicalAge   Float
  biologicalAge      Float               @default(35.0)
  agingVelocity      Float               @default(1.0) // y/y score
  complianceScore    Int                 @default(100)
  chronotype         String              @default("Lark")
  wearableToken      String?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  biometricMetrics   BiometricMetric[]
  exposomeReadings   ExposomeReading[]
  compoundingFormula CompoundingFormula?
  diagnosticAssays   DiagnosticAssay[]
}

model BiometricMetric {
  id                 String           @id @default(uuid())
  profileId          String
  profile            LongevityProfile @relation(fields: [profileId], references: [id])
  timestamp          DateTime         @default(now())
  rhr                Int              // Resting Heart Rate
  hrv                Int              // Heart Rate Variability
  sleepHours         Float
  deepSleepPercent   Float
  anomalyFlag        Boolean          @default(false)
  immuneScore        Int              @default(100)
}`}</code>
                )}

                {specsSubTab === 'algorithm' && (
                  <code style={{ color: '#93c5fd' }}>{`export interface WearableTelemetry {
  heartRateVariability: number[]; // Rolling 7-day HRV values in ms
  restingHeartRate: number[];     // Rolling 7-day RHR values in bpm
}

export interface AnomalyReport {
  isAnomaly: boolean;
  hrvZScore: number;
  rhrZScore: number;
  immuneDipRisk: number; // Percentage risk (0-100)
}

export function detectBiometricAnomaly(telemetry: WearableTelemetry): AnomalyReport {
  const hrvValues = telemetry.heartRateVariability;
  const rhrValues = telemetry.restingHeartRate;
  
  if (hrvValues.length < 5 || rhrValues.length < 5) {
    return { isAnomaly: false, hrvZScore: 0, rhrZScore: 0, immuneDipRisk: 0 };
  }

  // Calculate Mean and Standard Deviation for HRV (Baseline)
  const hrvMean = hrvValues.slice(0, -1).reduce((a, b) => a + b, 0) / (hrvValues.length - 1);
  const hrvStdDev = Math.sqrt(
    hrvValues.slice(0, -1).reduce((sum, val) => sum + Math.pow(val - hrvMean, 2), 0) / (hrvValues.length - 2)
  );

  // Calculate Mean and Standard Deviation for RHR
  const rhrMean = rhrValues.slice(0, -1).reduce((a, b) => a + b, 0) / (rhrValues.length - 1);
  const rhrStdDev = Math.sqrt(
    rhrValues.slice(0, -1).reduce((sum, val) => sum + Math.pow(val - rhrMean, 2), 0) / (rhrValues.length - 2)
  );

  const currentHrv = hrvValues[hrvValues.length - 1];
  const currentRhr = rhrValues[rhrValues.length - 1];

  // Z-Score calculations
  const hrvZScore = hrvStdDev > 0 ? (currentHrv - hrvMean) / hrvStdDev : 0;
  const rhrZScore = rhrStdDev > 0 ? (currentRhr - rhrMean) / rhrStdDev : 0;

  // Anomaly conditions: HRV collapsed (-1.5 SD) and RHR elevated (+1.5 SD)
  const isAnomaly = hrvZScore < -1.5 && rhrZScore > 1.5;

  let immuneDipRisk = 0;
  if (isAnomaly) {
    immuneDipRisk = Math.min(99, Math.round(50 + Math.abs(hrvZScore) * 15 + Math.abs(rhrZScore) * 10));
  }

  return { isAnomaly, hrvZScore, rhrZScore, immuneDipRisk };
}`}</code>
                )}

                {specsSubTab === 'alerts' && (
                  <code style={{ color: '#f59e0b' }}>{`export interface ExposomeContext {
  uvIndex: number;
  airQualityIndex: number;
  humidityPercent: number;
  ambientTemperatureCelsius: number;
}

export interface ExposomeAction {
  shieldRecommendation: string;
  supplementCompoundingAdditions: string[];
  hydrationTargetLiters: number;
}

export function routeExposomeAlerts(context: ExposomeContext): ExposomeAction {
  const action: ExposomeAction = {
    shieldRecommendation: "Climate parameters standard. Maintain normal circadian exposure.",
    supplementCompoundingAdditions: [],
    hydrationTargetLiters: 2.5
  };

  // Severe air pollution rule
  if (context.airQualityIndex > 150) {
    action.shieldRecommendation = "⚠️ High PM2.5 detected. Shut indoor seals, activate HEPA scrubbers, avoid outdoor training.";
    action.supplementCompoundingAdditions.push("N-Acetylcysteine (NAC) 600mg", "Selenium 100mcg");
  }

  // Extreme UV exposure rule
  if (context.uvIndex > 8.0) {
    action.shieldRecommendation = "⚠️ Extreme UV Hazard. Apply Broad-spectrum SPF 50 Mineral screen, limit exposure between 11 AM - 3 PM.";
    action.supplementCompoundingAdditions.push("Astaxanthin 6mg");
  }

  return action;
}`}</code>
                )}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
