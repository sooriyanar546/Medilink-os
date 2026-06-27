'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, Activity, TrendingDown, TrendingUp, Cpu, HeartPulse, BrainCircuit, Users, Navigation, Flame, Zap, CheckCircle2, FileText, AlertTriangle, RefreshCw, Bed, Check, X, Plus, Settings, Heart, Calendar, Clock, UserCheck, UserX, Coffee, Stethoscope, Pill, Shield, ClipboardList, ChevronDown } from 'lucide-react';
import { useHospitalQueue } from '@/hooks/useHospitalQueue';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useHospitalStore } from '@/store/useHospitalStore';
import { motion, AnimatePresence } from 'framer-motion';
import { triggerNativeHaptic } from '@/lib/native';

export default function AdminMode() {
  const { queue } = useHospitalQueue();
  const { adminMetrics, isLoadingMetrics } = useOperationalMetrics();
  const { showToast, completeConsultation } = useHospitalStore();

  // Derived operational health indicators from live metrics
  const systemRiskPct = adminMetrics.flaggedClaims > 3 ? 'HIGH' : adminMetrics.flaggedClaims > 1 ? 'MODERATE' : 'LOW';
  const systemRiskValue = adminMetrics.flaggedClaims > 3 ? Math.min(85, adminMetrics.flaggedClaims * 15) : adminMetrics.flaggedClaims > 1 ? Math.min(45, adminMetrics.flaggedClaims * 12) : Math.max(4, adminMetrics.flaggedClaims * 8);
  const riskColor = systemRiskPct === 'HIGH' ? '#ef4444' : systemRiskPct === 'MODERATE' ? '#f59e0b' : '#166534';
  const riskBg = systemRiskPct === 'HIGH' ? '#fef2f2' : systemRiskPct === 'MODERATE' ? '#fffbeb' : '#f0fdf4';
  const riskBorder = systemRiskPct === 'HIGH' ? '#fecaca' : systemRiskPct === 'MODERATE' ? '#fde68a' : '#bbf7d0';

  const [currentTime, setCurrentTime] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [billingClaims, setBillingClaims] = useState([]);
  const [isLoadingClaims, setIsLoadingClaims] = useState(true);
  const [isSimulatingClaim, setIsSimulatingClaim] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [remediatedRooms, setRemediatedRooms] = useState({});

  // Staff Roster & Shift Scheduling State
  const [staff, setStaff] = useState([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [staffWardFilter, setStaffWardFilter] = useState('ALL');
  const [isUpdatingShift, setIsUpdatingShift] = useState(null); // shiftId being updated
  const [showAddShiftForm, setShowAddShiftForm] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    staffId: '',
    ward: 'ICU',
    shiftStart: '',
    shiftEnd: '',
    notes: ''
  });
  const [isSchedulingShift, setIsSchedulingShift] = useState(false);
  const WARDS = ['ICU', 'ER', 'GENERAL', 'ISOLATION', 'PHARMACY', 'CASHIER'];

  // Ward Beds Management & Acuity Triage States
  const [beds, setBeds] = useState([]);
  const [isLoadingBeds, setIsLoadingBeds] = useState(true);
  const [selectedBed, setSelectedBed] = useState(null);
  const [activeWardFilter, setActiveWardFilter] = useState('ALL');
  const [editStatus, setEditStatus] = useState('AVAILABLE');
  const [editNotes, setEditNotes] = useState('');
  const [editVentilator, setEditVentilator] = useState(false);
  const [editPatientId, setEditPatientId] = useState('');
  const [isSavingBed, setIsSavingBed] = useState(false);

  // Patient Discharge & Bed-Turnaround States
  const [dischargeData, setDischargeData] = useState([]);
  const [maintenanceBeds, setMaintenanceBeds] = useState([]);
  const [housekeepingMetrics, setHousekeepingMetrics] = useState({ avgTurnaroundMins: 0, activeCleaningCount: 0, completedTurnaroundCount: 0 });
  const [isLoadingDischarge, setIsLoadingDischarge] = useState(true);
  const [activeCleanerInput, setActiveCleanerInput] = useState({});

  const calculateAcuity = (vitals, reason = '') => {
    if (!vitals) return { score: 0, details: ['No vitals recorded'], classification: 'STABLE' };
    
    let score = 0;
    const details = [];

    // Systolic BP: e.g. "120/80" or "90/60"
    let sbp = null;
    if (vitals.bp && typeof vitals.bp === 'string') {
      const parts = vitals.bp.split('/');
      if (parts.length > 0) {
        const parsedSbp = parseInt(parts[0]);
        if (!isNaN(parsedSbp)) sbp = parsedSbp;
      }
    } else if (vitals.sbp) {
      sbp = parseInt(vitals.sbp);
    }

    if (sbp !== null && sbp <= 100) {
      score += 1;
      details.push('Hypotension (Systolic BP ≤ 100 mmHg)');
    }

    // Heart Rate
    const hr = parseInt(vitals.hr || vitals.heartRate);
    if (!isNaN(hr) && hr >= 110) {
      score += 1;
      details.push('Tachycardia (HR ≥ 110 bpm)');
    }

    // Oxygen Saturation
    const spo2 = parseInt(vitals.spo2 || vitals.spO2 || vitals.oxygenSaturation);
    if (!isNaN(spo2) && spo2 <= 93) {
      score += 1;
      details.push('Hypoxemia (SpO2 ≤ 93%)');
    }

    // Temperature (SIRS criteria)
    const temp = parseFloat(vitals.temp || vitals.temperature);
    if (!isNaN(temp) && (temp >= 101.5 || temp <= 95.0)) {
      score += 1;
      details.push(`Temp anomaly (${temp}°F)`);
    }

    // Chief Complaint Severity
    const criticalComplaintKeywords = ['chest pain', 'radiating', 'palpitations', 'cardiac', 'shortness of breath', 'difficulty breathing', 'unconscious', 'stroke', 'fracture', 'trauma'];
    const complaintLower = reason?.toLowerCase() || '';
    const isCriticalComplaint = criticalComplaintKeywords.some(keyword => complaintLower.includes(keyword));
    if (isCriticalComplaint) {
      score += 1;
      details.push('Critical Chief Complaint');
    }

    let classification = 'STABLE';
    if (score >= 3) classification = 'CRITICAL';
    else if (score === 2) classification = 'HIGH RISK';

    return { score, details, classification };
  };

  const playChime = () => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.1, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1109.73, now + 0.08);
      gain2.gain.setValueAtTime(0.1, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      
      osc1.start(now);
      osc1.stop(now + 0.25);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.45);
    } catch (e) {
      console.error("Audio chime failed", e);
    }
  };

  const fetchBeds = async () => {
    try {
      const res = await fetch('/api/beds');
      if (!res.ok) throw new Error('Failed to fetch beds');
      const data = await res.json();
      if (Array.isArray(data)) {
        setBeds(data);
      }
    } catch (err) {
      console.error('Error fetching beds:', err);
    } finally {
      setIsLoadingBeds(false);
    }
  };

  const handleAutoDispatch = async (patient) => {
    const acuity = calculateAcuity(patient.vitals, patient.reason);
    let recommendedWardType = 'GENERAL';
    if (acuity.score >= 3) {
      recommendedWardType = 'ICU';
    } else if (acuity.score === 2) {
      recommendedWardType = 'ER';
    }

    // Find first available bed of the recommended type
    let targetBed = beds.find(b => b.wardType === recommendedWardType && b.status === 'AVAILABLE');
    
    // Fallback search in order of criticality if recommended type is full
    if (!targetBed) {
      if (recommendedWardType === 'ICU') {
        targetBed = beds.find(b => ['ER', 'GENERAL', 'ISOLATION'].includes(b.wardType) && b.status === 'AVAILABLE');
      } else if (recommendedWardType === 'ER') {
        targetBed = beds.find(b => ['GENERAL', 'ICU', 'ISOLATION'].includes(b.wardType) && b.status === 'AVAILABLE');
      } else {
        targetBed = beds.find(b => ['ISOLATION', 'ER', 'ICU'].includes(b.wardType) && b.status === 'AVAILABLE');
      }
    }

    if (!targetBed) {
      useHospitalStore.getState().showToast(`No available beds found for auto-dispatch! All wards are currently full.`, 'error');
      try {
        await triggerNativeHaptic('error');
      } catch (e) {}
      return;
    }

    try {
      const showToast = useHospitalStore.getState().showToast;
      const res = await fetch('/api/beds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ALLOCATE',
          bedId: targetBed.id,
          patientId: patient.id
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Auto-dispatched ${patient.name} to ${targetBed.name} (${targetBed.wardType}) successfully!`, 'success');
        playChime();
        try {
          await triggerNativeHaptic('success');
        } catch (e) {}
        
        fetchBeds();
        useHospitalStore.getState().loadQueue();
      } else {
        showToast(`Auto-dispatch failed: ${data.error}`, 'error');
      }
    } catch (err) {
      console.error(err);
      useHospitalStore.getState().showToast(`Error performing auto-dispatch`, 'error');
    }
  };

  const handleOpenBedModal = (bed) => {
    setSelectedBed(bed);
    setEditStatus(bed.status);
    setEditNotes(bed.notes || '');
    setEditVentilator(bed.ventilator);
    setEditPatientId(bed.patientId || '');
  };

  const handleSaveBedConfig = async () => {
    if (!selectedBed) return;
    setIsSavingBed(true);
    const showToast = useHospitalStore.getState().showToast;
    try {
      let res;
      let success = false;
      let errorMsg = '';

      if (editStatus === 'AVAILABLE' && selectedBed.status === 'OCCUPIED') {
        res = await fetch('/api/beds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RELEASE', bedId: selectedBed.id })
        });
        const data = await res.json();
        success = data.success;
        errorMsg = data.error;
      } else if (editStatus === 'OCCUPIED' && editPatientId && selectedBed.patientId !== editPatientId) {
        res = await fetch('/api/beds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ALLOCATE', bedId: selectedBed.id, patientId: editPatientId })
        });
        const data = await res.json();
        success = data.success;
        errorMsg = data.error;

        if (success && (editVentilator !== selectedBed.ventilator || editNotes !== selectedBed.notes)) {
          await fetch('/api/beds', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bedId: selectedBed.id, ventilator: editVentilator, notes: editNotes })
          });
        }
      } else {
        res = await fetch('/api/beds', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bedId: selectedBed.id,
            status: editStatus,
            ventilator: editVentilator,
            notes: editNotes
          })
        });
        const data = await res.json();
        success = data.success;
        errorMsg = data.error;
      }

      if (success) {
        showToast(`Bed ${selectedBed.name} updated successfully!`, 'success');
        playChime();
        try {
          await triggerNativeHaptic('success');
        } catch (e) {}
        setSelectedBed(null);
        fetchBeds();
        useHospitalStore.getState().loadQueue();
      } else {
        showToast(`Failed to update bed: ${errorMsg}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving bed configurations', 'error');
    } finally {
      setIsSavingBed(false);
    }
  };

  const handleQuickRelease = async (bedId) => {
    const showToast = useHospitalStore.getState().showToast;
    try {
      const res = await fetch('/api/beds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RELEASE', bedId })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Bed released successfully', 'success');
        playChime();
        try {
          await triggerNativeHaptic('success');
        } catch (e) {}
        fetchBeds();
        useHospitalStore.getState().loadQueue();
      } else {
        showToast(`Failed to release bed: ${data.error}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error releasing bed', 'error');
    }
  };

  const fetchDischargeData = async () => {
    try {
      const res = await fetch('/api/beds/discharge');
      if (!res.ok) throw new Error('Failed to fetch discharge data');
      const data = await res.json();
      setDischargeData(data.dischargeTracker || []);
      setMaintenanceBeds(data.maintenanceBeds || []);
      setHousekeepingMetrics(data.metrics || { avgTurnaroundMins: 0, activeCleaningCount: 0, completedTurnaroundCount: 0 });
    } catch (err) {
      console.error('Error fetching discharge metrics:', err);
    } finally {
      setIsLoadingDischarge(false);
    }
  };

  const handleAssignTransporter = async (bedId) => {
    const showToast = useHospitalStore.getState().showToast;
    try {
      const res = await fetch('/api/beds/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ASSIGN_TRANSPORTER', bedId })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Transporter scheduled for patient escort!', 'success');
        playChime();
        try { await triggerNativeHaptic('success'); } catch (e) {}
        fetchDischargeData();
        fetchBeds();
      } else {
        showToast(`Failed to assign transporter: ${data.error}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error scheduling transporter', 'error');
    }
  };

  const handleTriggerDischarge = async (bedId, patientName) => {
    const showToast = useHospitalStore.getState().showToast;
    try {
      const res = await fetch('/api/beds/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TRIGGER_DISCHARGE', bedId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Patient ${patientName} successfully discharged! Bed has entered maintenance sanitization.`, 'success');
        playChime();
        try { await triggerNativeHaptic('success'); } catch (e) {}
        fetchDischargeData();
        fetchBeds();
        useHospitalStore.getState().loadQueue();
      } else {
        showToast(`Discharge failed: ${data.error}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error triggering discharge', 'error');
    }
  };

  const handleAssignCleaner = async (bedId) => {
    const showToast = useHospitalStore.getState().showToast;
    const cleaner = activeCleanerInput[bedId] || 'Crew Alpha';
    try {
      const res = await fetch('/api/beds/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ASSIGN_CLEANER', bedId, cleanerName: cleaner })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Cleaning task claimed by ${cleaner}!`, 'success');
        playChime();
        try { await triggerNativeHaptic('success'); } catch (e) {}
        fetchDischargeData();
        fetchBeds();
      } else {
        showToast(`Failed to assign cleaner: ${data.error}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error claiming cleaning task', 'error');
    }
  };

  const handleCompleteCleaning = async (bedId, bedName) => {
    const showToast = useHospitalStore.getState().showToast;
    try {
      const res = await fetch('/api/beds/discharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'COMPLETE_CLEANING', bedId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Bed ${bedName} sanitization complete! Turnaround logged: ${data.turnaroundMins}m. Bed is now AVAILABLE.`, 'success');
        playChime();
        try { await triggerNativeHaptic('success'); } catch (e) {}
        fetchDischargeData();
        fetchBeds();
      } else {
        showToast(`Sanitization completion failed: ${data.error}`, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error completing sanitization', 'error');
    }
  };

  const getElapsedMins = (startStr) => {
    if (!startStr) return 0;
    const elapsedMs = new Date().getTime() - new Date(startStr).getTime();
    return Math.max(1, Math.round(elapsedMs / 60000));
  };

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
    const showToast = useHospitalStore.getState().showToast;
    try {
      // Step 1: Find a real completed visit that has a clinical note but no claim yet
      const queueData = useHospitalStore.getState().queue;
      const visitsRes = await fetch('/api/visits?status=COMPLETED');
      const allVisits = visitsRes.ok ? await visitsRes.json() : [];

      // Find a completed visit without an existing billing claim
      const targetVisit = allVisits.find(v => v.status === 'COMPLETED') || allVisits[0];

      if (!targetVisit) {
        showToast('No completed visits found. Complete a patient consultation first to generate a billing claim.', 'error');
        return;
      }

      const res = await fetch('/api/billing-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: targetVisit.id,
          amount: 8500,
          tpaName: 'National Health Insurance'
        })
      });
      const data = await res.json();
      if (data.success) {
        setBillingClaims(prev => [data.billingClaim, ...prev]);
        showToast(`AI-audited billing claim generated for visit ${targetVisit.id.slice(0, 8)}...`, 'success');
      } else {
        showToast(data.error || 'Failed to generate billing claim.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error generating billing claim.', 'error');
    } finally {
      setIsSimulatingClaim(false);
    }
  };

  const fetchStaff = async () => {
    try {
      const res = await fetch('/api/staff');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setStaff(data);
      }
    } catch (e) {
      console.error('Error fetching staff:', e);
    } finally {
      setIsLoadingStaff(false);
    }
  };

  const handleUpdateShiftStatus = async (shiftId, newStatus) => {
    setIsUpdatingShift(shiftId);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UPDATE_SHIFT_STATUS', shiftId, status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Shift status updated to ${newStatus}`, 'success');
        playChime();
        fetchStaff();
      } else {
        showToast(data.error || 'Failed to update shift', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error updating shift status', 'error');
    } finally {
      setIsUpdatingShift(null);
    }
  };

  const handleScheduleShift = async (e) => {
    e.preventDefault();
    if (!shiftForm.staffId || !shiftForm.shiftStart || !shiftForm.shiftEnd) return;
    setIsSchedulingShift(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SCHEDULE_SHIFT', ...shiftForm })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Shift scheduled for ${data.shift.staff.name}!`, 'success');
        playChime();
        setShowAddShiftForm(false);
        setShiftForm({ staffId: '', ward: 'ICU', shiftStart: '', shiftEnd: '', notes: '' });
        fetchStaff();
      } else {
        showToast(data.error || 'Failed to schedule shift', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error scheduling shift', 'error');
    } finally {
      setIsSchedulingShift(false);
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
    fetchBeds();
    fetchDischargeData();
    fetchStaff();
    const interval = setInterval(() => {
      fetchAuditLogs();
      fetchStaff();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchBeds();
    fetchDischargeData();
  }, [queue]);

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
        
        {/* Global System Health Indicator — Live from /api/metrics */}
        <div style={{ backgroundColor: riskBg, border: `1px solid ${riskBorder}`, padding: '8px 16px', borderRadius: '50px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Activity size={16} color={riskColor} />
            <span style={{ fontSize: 'var(--font-size-sm)', color: riskColor, fontWeight: 600 }}>
              System Risk: {systemRiskPct} ({systemRiskValue}%)
            </span>
          </div>
          <div style={{ width: '1px', height: '20px', backgroundColor: riskBorder }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HeartPulse size={16} color="#059669" />
            <span style={{ fontSize: 'var(--font-size-sm)', color: '#065f46', fontWeight: 600 }}>
              {isLoadingMetrics ? 'Loading...' : `Global Experience: ${adminMetrics.experienceScore ?? 100}/100`}
            </span>
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

          {/* Interactive Ward Bed Matrix Panel */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bed size={18} color="var(--color-primary)" />
                Ward Bed Occupancy Matrix
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                {beds.filter(b => b.status === 'OCCUPIED').length} / {beds.length} Occupied
              </span>
            </div>

            {/* Ward Filter Tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {['ALL', 'ICU', 'ER', 'GENERAL', 'ISOLATION'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveWardFilter(tab)}
                  className="btn"
                  style={{
                    fontSize: '11px',
                    padding: '4px 10px',
                    backgroundColor: activeWardFilter === tab ? 'var(--color-primary)' : 'transparent',
                    borderColor: activeWardFilter === tab ? 'var(--color-primary)' : 'var(--border-light)',
                    color: activeWardFilter === tab ? 'white' : 'var(--color-text-main)',
                    borderRadius: '50px'
                  }}
                >
                  {tab} ({tab === 'ALL' ? beds.length : beds.filter(b => b.wardType === tab).length})
                </button>
              ))}
            </div>

            {/* Beds Grid */}
            {isLoadingBeds ? (
              <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '24px' }}>Loading beds...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: '12px' }}>
                {beds
                  .filter(b => activeWardFilter === 'ALL' || b.wardType === activeWardFilter)
                  .map((bed) => {
                    const statusColor = 
                      bed.status === 'AVAILABLE' ? '#10b981' :
                      bed.status === 'OCCUPIED' ? '#3b82f6' :
                      bed.status === 'MAINTENANCE' ? '#f59e0b' :
                      '#8b5cf6';

                    const bgGradient = 
                      bed.status === 'AVAILABLE' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.02))' :
                      bed.status === 'OCCUPIED' ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(59, 130, 246, 0.02))' :
                      bed.status === 'MAINTENANCE' ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.02))' :
                      'linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(139, 92, 246, 0.02))';

                    const borderStyle = `1px solid ${
                      bed.status === 'AVAILABLE' ? 'rgba(16, 185, 129, 0.3)' :
                      bed.status === 'OCCUPIED' ? 'rgba(59, 130, 246, 0.3)' :
                      bed.status === 'MAINTENANCE' ? 'rgba(245, 158, 11, 0.3)' :
                      'rgba(139, 92, 246, 0.3)'
                    }`;

                    return (
                      <motion.div
                        key={bed.id}
                        whileHover={{ scale: 1.02 }}
                        onClick={() => handleOpenBedModal(bed)}
                        style={{
                          background: bgGradient,
                          border: borderStyle,
                          borderRadius: '12px',
                          padding: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          minHeight: '110px',
                          position: 'relative',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--color-text-main)' }}>{bed.name}</span>
                          <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{bed.wardType}</span>
                        </div>

                        {bed.ventilator && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                            <motion.span 
                              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                              transition={{ repeat: Infinity, duration: 2 }}
                              style={{ width: '6px', height: '6px', backgroundColor: '#ef4444', borderRadius: '50%' }}
                            />
                            <span style={{ fontSize: '9px', fontWeight: 700, color: '#ef4444' }}>VENT ACTIVE</span>
                          </div>
                        )}

                        <div style={{ marginTop: '8px' }}>
                          {bed.status === 'OCCUPIED' && bed.patient ? (
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {bed.patient.name}
                              </div>
                              <div style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>
                                qSOFA: {calculateAcuity(bed.patient.visits?.[0]?.vitals, bed.patient.visits?.[0]?.reason).score}/5
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: '10px', color: statusColor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: '6px', height: '6px', backgroundColor: statusColor, borderRadius: '50%' }} />
                              {bed.status}
                            </div>
                          )}
                        </div>

                        {bed.notes && (
                          <div style={{ position: 'absolute', bottom: '6px', right: '8px', fontSize: '10px' }} title={bed.notes}>
                            📝
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Housekeeping & Bed Turnaround Coordinator Panel */}
          <div className="card" style={{ border: '1px solid rgba(245, 158, 11, 0.2)', backgroundColor: '#fffbf0' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b45309' }}>
                <RefreshCw size={18} color="#b45309" />
                Housekeeping & Bed Turnaround
              </div>
              <span className="badge" style={{ backgroundColor: '#fef3c7', color: '#b45309', fontSize: '10px' }}>
                Avg Turnaround: {housekeepingMetrics.avgTurnaroundMins || 0}m
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {maintenanceBeds.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '16px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  No beds currently require turnover cleaning.
                </div>
              ) : (
                maintenanceBeds.map((bed) => {
                  const elapsedMins = getElapsedMins(bed.maintenanceStart);
                  const isClaimed = !!bed.cleanerName;

                  return (
                    <div
                      key={bed.id}
                      style={{
                        backgroundColor: 'white',
                        border: `1px solid ${isClaimed ? '#bbf7d0' : '#fef08a'}`,
                        borderRadius: '10px',
                        padding: '12px',
                        boxShadow: 'var(--shadow-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ fontSize: '13px', color: 'var(--color-text-main)' }}>{bed.name}</strong>
                          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginLeft: '6px' }}>({bed.wardType})</span>
                        </div>
                        <span
                          className="badge"
                          style={{
                            backgroundColor: isClaimed ? '#dcfce7' : '#fef9c3',
                            color: isClaimed ? '#15803d' : '#854d0e',
                            fontSize: '9px',
                            fontWeight: 700
                          }}
                        >
                          {isClaimed ? 'Cleaning In Progress' : 'Awaiting Cleanup'}
                        </span>
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        <div>Elapsed turnaround: <strong>{elapsedMins} min</strong></div>
                        <div style={{ fontSize: '10px', marginTop: '2px', fontStyle: 'italic' }}>Notes: {bed.notes || 'No instructions.'}</div>
                      </div>

                      {isClaimed ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--color-text-main)' }}>
                            Staff: <strong>{bed.cleanerName}</strong>
                          </span>
                          <button
                            onClick={() => handleCompleteCleaning(bed.id, bed.name)}
                            className="btn btn-primary"
                            style={{
                              fontSize: '11px',
                              padding: '5px 10px',
                              backgroundColor: '#10b981',
                              borderColor: '#10b981',
                              color: 'white',
                              borderRadius: '6px'
                            }}
                          >
                            Complete Sanitization
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                          <input
                            type="text"
                            placeholder="Cleaner Name (e.g. Crew A)"
                            value={activeCleanerInput[bed.id] || ''}
                            onChange={(e) => setActiveCleanerInput({ ...activeCleanerInput, [bed.id]: e.target.value })}
                            style={{
                              flex: 1,
                              padding: '5px 8px',
                              fontSize: '11px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: 'white',
                              color: 'var(--color-text-main)'
                            }}
                          />
                          <button
                            onClick={() => handleAssignCleaner(bed.id)}
                            className="btn"
                            style={{
                              fontSize: '11px',
                              padding: '5px 10px',
                              backgroundColor: 'var(--color-primary)',
                              borderColor: 'var(--color-primary)',
                              color: 'white',
                              borderRadius: '6px'
                            }}
                          >
                            Claim Task
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
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

          {/* Triage Dispatch Advisor Panel */}
          <div className="card" style={{ border: '1px solid rgba(239, 68, 68, 0.2)', backgroundColor: '#fff8f8' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b91c1c' }}>
                <ShieldAlert size={20} color="#b91c1c" />
                Triage Dispatch Advisor
              </div>
              <span className="badge" style={{ backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '10px' }}>
                Live Acuity Scanner
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {queue.filter(p => p.status === 'waiting').length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '16px' }}>
                  No waiting patients in OPD queue.
                </div>
              ) : (
                queue.filter(p => p.status === 'waiting').map((patient) => {
                  const acuity = calculateAcuity(patient.vitals, patient.reason);
                  const isCritical = acuity.score >= 3;
                  const isHighRisk = acuity.score === 2;

                  let badgeBg = '#f0fdf4';
                  let badgeText = '#166534';
                  let recWard = 'General Ward';
                  let recWardType = 'GENERAL';

                  if (isCritical) {
                    badgeBg = '#fee2e2';
                    badgeText = '#991b1b';
                    recWard = 'ICU Ward Bed';
                    recWardType = 'ICU';
                  } else if (isHighRisk) {
                    badgeBg = '#fef3c7';
                    badgeText = '#92400e';
                    recWard = 'ER Bay Bed';
                    recWardType = 'ER';
                  }

                  const availableBedsCount = beds.filter(b => b.wardType === recWardType && b.status === 'AVAILABLE').length;

                  return (
                    <div
                      key={patient.visitId}
                      style={{
                        backgroundColor: 'white',
                        border: `1px solid ${isCritical ? '#fca5a5' : isHighRisk ? '#fde047' : '#cbd5e1'}`,
                        borderRadius: '10px',
                        padding: '12px',
                        boxShadow: 'var(--shadow-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text-main)' }}>
                            {patient.name}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                            Pos #{patient.queuePosition}
                          </span>
                        </div>
                        <span
                          className="badge"
                          style={{
                            backgroundColor: badgeBg,
                            color: badgeText,
                            fontSize: '9px',
                            fontWeight: 700
                          }}
                        >
                          {acuity.classification} (Score: {acuity.score}/5)
                        </span>
                      </div>

                      <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ color: 'var(--color-text-main)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <span>BP: <strong style={{ color: (parseInt(patient.vitals?.bp?.split('/')?.[0]) <= 100) ? '#dc2626' : 'inherit' }}>{patient.vitals?.bp || 'N/A'}</strong></span>
                          <span>HR: <strong style={{ color: (parseInt(patient.vitals?.hr) >= 110) ? '#dc2626' : 'inherit' }}>{patient.vitals?.hr || 'N/A'} bpm</strong></span>
                          <span>SpO2: <strong style={{ color: (parseInt(patient.vitals?.spo2) <= 93) ? '#dc2626' : 'inherit' }}>{patient.vitals?.spo2 || 'N/A'}%</strong></span>
                          <span>Temp: <strong style={{ color: (parseFloat(patient.vitals?.temp) >= 101.5 || parseFloat(patient.vitals?.temp) <= 95) ? '#dc2626' : 'inherit' }}>{patient.vitals?.temp || 'N/A'}°F</strong></span>
                        </div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Complaint: <strong>{patient.reason}</strong>
                        </div>
                        {acuity.details.length > 0 && (
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                            {acuity.details.map((d, i) => (
                              <span key={i} style={{ fontSize: '9px', backgroundColor: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: '4px' }}>
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <div style={{ fontSize: '11px' }}>
                          <span style={{ color: 'var(--color-text-muted)' }}>Rec: </span>
                          <strong style={{ color: isCritical ? '#991b1b' : isHighRisk ? '#92400e' : 'var(--color-text-main)' }}>{recWard}</strong>
                          <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '4px' }}>
                            ({availableBedsCount} available)
                          </span>
                        </div>
                        <button
                          onClick={() => handleAutoDispatch(patient)}
                          className="btn btn-primary"
                          style={{
                            fontSize: '11px',
                            padding: '6px 12px',
                            backgroundColor: isCritical ? '#b91c1c' : isHighRisk ? '#d97706' : 'var(--color-primary)',
                            borderColor: isCritical ? '#b91c1c' : isHighRisk ? '#d97706' : 'var(--color-primary)',
                            color: 'white',
                            borderRadius: '6px'
                          }}
                        >
                          Auto-Dispatch
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Discharge Coordinator Panel */}
          <div className="card" style={{ border: '1px solid rgba(59, 130, 246, 0.2)', backgroundColor: '#f0f7ff' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1d4ed8' }}>
                <Users size={18} color="#1d4ed8" />
                Coordinated Discharge Control
              </div>
              <span className="badge" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8', fontSize: '10px' }}>
                Checkout Monitor
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {isLoadingDischarge ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '16px' }}>
                  Loading discharge lists...
                </div>
              ) : dischargeData.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '16px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                  No active patients checked into inpatient beds.
                </div>
              ) : (
                dischargeData.map((data) => {
                  const milestones = data.milestones;
                  
                  return (
                    <div
                      key={data.bedId}
                      style={{
                        backgroundColor: 'white',
                        border: `1px solid ${data.readyForDischarge ? '#10b981' : 'rgba(59, 130, 246, 0.3)'}`,
                        borderRadius: '10px',
                        padding: '12px',
                        boxShadow: 'var(--shadow-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text-main)' }}>
                            {data.patientName}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                            Bed: <strong>{data.bedName}</strong> ({data.wardType})
                          </span>
                        </div>
                        <span
                          className="badge"
                          style={{
                            backgroundColor: data.readyForDischarge ? '#dcfce7' : '#eff6ff',
                            color: data.readyForDischarge ? '#15803d' : '#2563eb',
                            fontSize: '9px',
                            fontWeight: 700
                          }}
                        >
                          {data.readyForDischarge ? 'READY FOR DISCHARGE' : 'AWAITING CLEARANCE'}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', backgroundColor: '#f8fafc', padding: '8px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', opacity: milestones.clinicalClearance ? 1 : 0.4 }}>
                          <span style={{ fontSize: '16px' }}>📝</span>
                          <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-main)', marginTop: '2px' }}>Clinical Note</span>
                          <span style={{ fontSize: '10px', color: milestones.clinicalClearance ? '#10b981' : '#ef4444', fontWeight: 'bold', marginTop: '2px' }}>
                            {milestones.clinicalClearance ? '✓ Done' : 'Pending'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', opacity: milestones.pharmacyClearance ? 1 : 0.4 }}>
                          <span style={{ fontSize: '16px' }}>💊</span>
                          <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-main)', marginTop: '2px' }}>Pharmacy Rx</span>
                          <span style={{ fontSize: '10px', color: milestones.pharmacyClearance ? '#10b981' : '#ef4444', fontWeight: 'bold', marginTop: '2px' }}>
                            {milestones.pharmacyClearance ? '✓ Dispensed' : 'Pending'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', opacity: milestones.billingClearance ? 1 : 0.4 }}>
                          <span style={{ fontSize: '16px' }}>💳</span>
                          <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-main)', marginTop: '2px' }}>Billing Claim</span>
                          <span style={{ fontSize: '10px', color: milestones.billingClearance ? '#10b981' : '#ef4444', fontWeight: 'bold', marginTop: '2px' }}>
                            {milestones.billingClearance ? '✓ Cleared' : 'Unpaid'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', opacity: milestones.transporterClearance ? 1 : 0.4 }}>
                          <span style={{ fontSize: '16px' }}>♿</span>
                          <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-text-main)', marginTop: '2px' }}>Transporter</span>
                          <span style={{ fontSize: '10px', color: milestones.transporterClearance ? '#10b981' : '#ef4444', fontWeight: 'bold', marginTop: '2px' }}>
                            {milestones.transporterClearance ? '✓ Escort' : 'Needed'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
                        {!milestones.transporterClearance && (
                          <button
                            onClick={() => handleAssignTransporter(data.bedId)}
                            className="btn btn-outline"
                            style={{
                              fontSize: '11px',
                              padding: '5px 10px',
                              borderColor: 'var(--color-primary)',
                              color: 'var(--color-primary)',
                              borderRadius: '6px'
                            }}
                          >
                            Assign Escort Transporter
                          </button>
                        )}
                        <button
                          onClick={() => handleTriggerDischarge(data.bedId, data.patientName)}
                          disabled={!data.readyForDischarge}
                          className="btn btn-primary"
                          style={{
                            fontSize: '11px',
                            padding: '5px 12px',
                            backgroundColor: data.readyForDischarge ? '#10b981' : '#cbd5e1',
                            borderColor: data.readyForDischarge ? '#10b981' : '#cbd5e1',
                            color: data.readyForDischarge ? 'white' : 'var(--color-text-muted)',
                            cursor: data.readyForDischarge ? 'pointer' : 'not-allowed',
                            borderRadius: '6px'
                          }}
                        >
                          {data.readyForDischarge ? 'Discharge Patient' : 'Awaiting Clearances...'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          
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

      {/* Bed Control Modal */}
      <AnimatePresence>
        {selectedBed && (
          <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '24px'
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              style={{
                backgroundColor: 'white',
                border: '1px solid var(--border-light)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '460px',
                padding: '24px',
                boxShadow: 'var(--shadow-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bed size={20} color="var(--color-primary)" />
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)', margin: 0 }}>
                      Manage Bed {selectedBed.name}
                    </h3>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                      {selectedBed.wardType} Ward Resource
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedBed(null)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '6px' }}>
                    Bed Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => {
                      setEditStatus(e.target.value);
                      if (e.target.value !== 'OCCUPIED') {
                        setEditPatientId('');
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      backgroundColor: 'white',
                      color: 'var(--color-text-main)'
                    }}
                  >
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="OCCUPIED">OCCUPIED / ASSIGNED</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="RESERVED">RESERVED</option>
                  </select>
                </div>

                {editStatus === 'OCCUPIED' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '6px' }}>
                      Assign Patient
                    </label>
                    {selectedBed.status === 'OCCUPIED' && selectedBed.patient ? (
                      <div style={{ padding: '10px 12px', backgroundColor: '#f1f5f9', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{selectedBed.patient.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Linked Patient ID: {selectedBed.patientId}</div>
                        </div>
                        <button
                          onClick={() => handleQuickRelease(selectedBed.id)}
                          className="btn"
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            borderColor: '#fee2e2'
                          }}
                        >
                          Release Patient
                        </button>
                      </div>
                    ) : (
                      <select
                        value={editPatientId}
                        onChange={(e) => setEditPatientId(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          fontSize: '13px',
                          backgroundColor: 'white',
                          color: 'var(--color-text-main)'
                        }}
                      >
                        <option value="">-- Select Patient from waiting list --</option>
                        {queue
                          .filter(p => !beds.some(b => b.patientId === p.id) || p.id === selectedBed.patientId)
                          .map((patient) => {
                            const acuity = calculateAcuity(patient.vitals, patient.reason);
                            return (
                              <option key={patient.id} value={patient.id}>
                                {patient.name} (Acuity: {acuity.classification} {acuity.score}/5 - {patient.reason})
                              </option>
                            );
                          })}
                      </select>
                    )}
                  </div>
                )}

                {selectedBed.wardType === 'ICU' && editStatus === 'OCCUPIED' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fef2f2', padding: '12px', borderRadius: '8px', border: '1px solid #fecdd3' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#991b1b' }}>Ventilator Life Support</div>
                      <div style={{ fontSize: '11px', color: '#7f1d1d' }}>Toggle active auxiliary respiratory device</div>
                    </div>
                    <button
                      onClick={() => setEditVentilator(!editVentilator)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {editVentilator ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#ef4444', fontWeight: 700, fontSize: '13px' }}>
                          ON <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} style={{ width: '10px', height: '10px', backgroundColor: '#ef4444', borderRadius: '50%' }} />
                        </div>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '13px', fontWeight: 700 }}>OFF</span>
                      )}
                    </button>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '6px' }}>
                    Bed Notes / Care Instructions
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Enter special clinical notes, maintenance logs, or bed assignments details..."
                    style={{
                      width: '100%',
                      height: '80px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      resize: 'none',
                      color: 'var(--color-text-main)'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '16px', marginTop: '8px' }}>
                <button
                  onClick={() => setSelectedBed(null)}
                  className="btn btn-outline"
                  style={{ fontSize: '13px', padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBedConfig}
                  disabled={isSavingBed || (editStatus === 'OCCUPIED' && !editPatientId && !selectedBed.patientId)}
                  className="btn btn-primary"
                  style={{
                    fontSize: '13px',
                    padding: '8px 16px',
                    backgroundColor: 'var(--color-primary)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {isSavingBed ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  Save Configurations
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================
          STAFF ROSTER & SHIFT SCHEDULING PANEL
          ================================================================ */}
      <div className="card" style={{ marginTop: 'var(--space-6)', padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          backgroundColor: 'var(--color-surface-hover)',
          borderBottom: 'var(--border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} color="var(--color-primary)" />
            Live Staff Roster &amp; Shift Scheduler
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Ward Filter */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {['ALL', ...WARDS].map(w => (
                <button
                  key={w}
                  onClick={() => setStaffWardFilter(w)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: staffWardFilter === w ? 'var(--color-primary)' : 'var(--color-border)',
                    backgroundColor: staffWardFilter === w ? 'var(--color-primary-lighter)' : 'transparent',
                    color: staffWardFilter === w ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)'
                  }}
                >{w}</button>
              ))}
            </div>
            <button
              onClick={() => setShowAddShiftForm(prev => !prev)}
              className="btn btn-primary"
              style={{ fontSize: 'var(--font-size-xs)', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={14} />
              Schedule Shift
            </button>
          </div>
        </div>

        {/* Schedule Shift Form */}
        <AnimatePresence>
          {showAddShiftForm && (
            <motion.form
              onSubmit={handleScheduleShift}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                padding: 'var(--space-4) var(--space-5)',
                backgroundColor: '#f0f9ff',
                borderBottom: '1px solid #bae6fd',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                alignItems: 'end'
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Staff Member</label>
                <select
                  required
                  value={shiftForm.staffId}
                  onChange={e => setShiftForm(p => ({ ...p, staffId: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text-main)', backgroundColor: 'white' }}
                >
                  <option value="">Select staff...</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ward</label>
                <select
                  value={shiftForm.ward}
                  onChange={e => setShiftForm(p => ({ ...p, ward: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text-main)', backgroundColor: 'white' }}
                >
                  {WARDS.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Shift Start</label>
                <input
                  required type="datetime-local"
                  value={shiftForm.shiftStart}
                  onChange={e => setShiftForm(p => ({ ...p, shiftStart: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text-main)', backgroundColor: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Shift End</label>
                <input
                  required type="datetime-local"
                  value={shiftForm.shiftEnd}
                  onChange={e => setShiftForm(p => ({ ...p, shiftEnd: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text-main)', backgroundColor: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes (Optional)</label>
                <input
                  type="text" placeholder="e.g. Night cover, On-call..."
                  value={shiftForm.notes}
                  onChange={e => setShiftForm(p => ({ ...p, notes: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text-main)', backgroundColor: 'white' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" disabled={isSchedulingShift} className="btn btn-primary" style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  {isSchedulingShift ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Calendar size={13} />}
                  {isSchedulingShift ? 'Scheduling...' : 'Confirm Shift'}
                </button>
                <button type="button" onClick={() => setShowAddShiftForm(false)} className="btn btn-outline" style={{ fontSize: 'var(--font-size-xs)', padding: '8px 12px' }}>
                  Cancel
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Staff Table */}
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          {isLoadingStaff ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
              <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block' }} />
              Loading staff roster...
            </div>
          ) : (() => {
            const filtered = staffWardFilter === 'ALL'
              ? staff
              : staff.filter(s => s.shifts?.some(sh => sh.ward === staffWardFilter));

            if (filtered.length === 0) {
              return (
                <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                  <UserCheck size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.3 }} />
                  <div style={{ fontSize: 'var(--font-size-sm)' }}>No staff scheduled for today{staffWardFilter !== 'ALL' ? ` in ${staffWardFilter}` : ''}.</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', marginTop: '4px', color: 'var(--color-text-subtle)' }}>Use "Schedule Shift" to assign coverage for today.</div>
                </div>
              );
            }

            const roleIcon = (role) => {
              const icons = { NURSE: '🩺', DOCTOR: '👨‍⚕️', PHARMACIST: '💊', WARD_AIDE: '🛏️', RECEPTIONIST: '📋', SECURITY: '🔒', HOUSEKEEPING: '🧹' };
              return icons[role] || '👤';
            };

            const statusConfig = {
              SCHEDULED:  { label: 'Scheduled',  color: '#0284c7', bg: '#e0f2fe', border: '#bae6fd' },
              ON_DUTY:    { label: 'On Duty',     color: '#059669', bg: '#d1fae5', border: '#a7f3d0' },
              ON_BREAK:   { label: 'On Break',    color: '#d97706', bg: '#fef3c7', border: '#fde68a' },
              OFF_DUTY:   { label: 'Off Duty',    color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' },
              ABSENT:     { label: 'Absent',      color: '#dc2626', bg: '#fee2e2', border: '#fecaca' },
            };

            return (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ minWidth: '700px' }}>
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Role &amp; Dept.</th>
                      <th>Ward</th>
                      <th>Shift Window</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {filtered.map(member => {
                        const todayShifts = member.shifts || [];
                        if (todayShifts.length === 0) {
                          return (
                            <motion.tr key={member.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                                    {roleIcon(member.role)}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}>{member.name}</div>
                                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-subtle)' }}>{member.employeeCode}</div>
                                  </div>
                                </div>
                              </td>
                              <td><div style={{ fontSize: 'var(--font-size-xs)' }}>{member.role}</div><div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{member.department}</div></td>
                              <td colSpan={4} style={{ color: 'var(--color-text-subtle)', fontSize: 'var(--font-size-xs)', fontStyle: 'italic' }}>No shift scheduled today</td>
                            </motion.tr>
                          );
                        }
                        return todayShifts.map((shift, si) => {
                          const cfg = statusConfig[shift.status] || statusConfig.SCHEDULED;
                          const start = new Date(shift.shiftStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                          const end = new Date(shift.shiftEnd).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                          const isUpdating = isUpdatingShift === shift.id;
                          return (
                            <motion.tr key={`${member.id}-${shift.id}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: si * 0.04 }}>
                              {si === 0 && (
                                <td rowSpan={todayShifts.length}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                                      {roleIcon(member.role)}
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}>{member.name}</div>
                                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-subtle)' }}>{member.employeeCode}</div>
                                    </div>
                                  </div>
                                </td>
                              )}
                              {si === 0 && (
                                <td rowSpan={todayShifts.length}>
                                  <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{member.role}</div>
                                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{member.department}</div>
                                </td>
                              )}
                              <td>
                                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', backgroundColor: '#e0f2fe', color: '#0284c7', border: '1px solid #bae6fd' }}>
                                  {shift.ward}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                                  <Clock size={12} color="var(--color-text-subtle)" />
                                  {start} — {end}
                                </div>
                                {shift.notes && <div style={{ fontSize: '10px', color: 'var(--color-text-subtle)', marginTop: '2px' }}>{shift.notes}</div>}
                              </td>
                              <td>
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                                  padding: '3px 10px', borderRadius: 'var(--radius-full)',
                                  fontSize: 'var(--font-size-xs)', fontWeight: 600,
                                  backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`
                                }}>
                                  {shift.status === 'ON_DUTY' && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: cfg.color, display: 'inline-block', animation: 'breathe 2s ease-in-out infinite' }} />}
                                  {cfg.label}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                  {['ON_DUTY', 'ON_BREAK', 'OFF_DUTY'].filter(s => s !== shift.status).map(nextStatus => (
                                    <button
                                      key={nextStatus}
                                      onClick={() => handleUpdateShiftStatus(shift.id, nextStatus)}
                                      disabled={!!isUpdatingShift}
                                      style={{
                                        padding: '3px 8px',
                                        borderRadius: 'var(--radius-sm)',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        border: '1px solid',
                                        cursor: isUpdatingShift ? 'not-allowed' : 'pointer',
                                        opacity: isUpdatingShift ? 0.5 : 1,
                                        backgroundColor: nextStatus === 'ON_DUTY' ? '#d1fae5' : nextStatus === 'ON_BREAK' ? '#fef3c7' : '#f1f5f9',
                                        borderColor: nextStatus === 'ON_DUTY' ? '#a7f3d0' : nextStatus === 'ON_BREAK' ? '#fde68a' : '#e2e8f0',
                                        color: nextStatus === 'ON_DUTY' ? '#059669' : nextStatus === 'ON_BREAK' ? '#d97706' : '#64748b',
                                        transition: 'all var(--transition-fast)',
                                        whiteSpace: 'nowrap'
                                      }}
                                    >
                                      {isUpdating && isUpdatingShift === shift.id
                                        ? '...'
                                        : nextStatus === 'ON_DUTY' ? '✓ On Duty'
                                        : nextStatus === 'ON_BREAK' ? '☕ Break'
                                        : '⏹ Off Duty'}
                                    </button>
                                  ))}
                                </div>
                              </td>
                            </motion.tr>
                          );
                        });
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        {/* Footer Summary */}
        {staff.length > 0 && (
          <div style={{
            padding: 'var(--space-3) var(--space-5)',
            borderTop: 'var(--border-light)',
            backgroundColor: 'var(--color-surface-hover)',
            display: 'flex',
            gap: 'var(--space-6)',
            flexWrap: 'wrap'
          }}>
            {[
              { label: 'Total Rostered', value: staff.length, color: 'var(--color-primary)' },
              { label: 'On Duty', value: staff.reduce((n, s) => n + (s.shifts?.filter(sh => sh.status === 'ON_DUTY').length || 0), 0), color: '#059669' },
              { label: 'On Break', value: staff.reduce((n, s) => n + (s.shifts?.filter(sh => sh.status === 'ON_BREAK').length || 0), 0), color: '#d97706' },
              { label: 'Scheduled', value: staff.reduce((n, s) => n + (s.shifts?.filter(sh => sh.status === 'SCHEDULED').length || 0), 0), color: '#0284c7' },
              { label: 'Absent', value: staff.reduce((n, s) => n + (s.shifts?.filter(sh => sh.status === 'ABSENT').length || 0), 0), color: '#dc2626' },
            ].map(stat => (
              <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: stat.color }}>{stat.value}</span>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{stat.label}</span>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-subtle)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <RefreshCw size={11} /> Auto-refreshes every 15 seconds
            </div>
          </div>
        )}
      </div>
    </>
  );
}
