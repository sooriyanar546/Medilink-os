'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, MessageCircle, FileText, Lock, ChevronRight, ShieldCheck, CheckCircle2, Navigation, HeartHandshake, BellRing, Sparkles, Loader2, Smartphone, RefreshCw, AlertTriangle } from 'lucide-react';
import { useHospitalStore } from '@/store/useHospitalStore';

import { triggerNativeHaptic } from '@/lib/native';
import { Send, X, Smartphone as BotIcon } from 'lucide-react';

const mockPrescriptions = [
  { drugName: "Amlodipine 5mg", dosage: "1 Tablet", frequency: "QD", duration: "14 days", sig: "Once daily in the morning" },
  { drugName: "Paracetamol 500mg", dosage: "1 Tablet", frequency: "TID", duration: "3 days", sig: "Three times daily (Morning, Noon & Night) after meals" },
];

const translateSig = (sigCode) => {
  const code = sigCode.toUpperCase();
  if (code.includes("BID") || code.includes("Q12H")) return "Twice daily (Morning & Night) after meals";
  if (code.includes("TID") || code.includes("Q8H")) return "Three times daily (Morning, Noon & Night) after meals";
  if (code.includes("QID") || code.includes("Q6H")) return "Four times daily at regular intervals";
  if (code.includes("QD") || code.includes("Q24H") || code.includes("ONCE")) return "Once daily in the morning before meals";
  if (code.includes("PRN")) return "As needed under physical stress or symptoms";
  if (code.includes("HS")) return "Once daily at bedtime";
  return "Take as instructed by your clinical care practitioner";
};

const localDietitians = [
  {
    name: "Dr. Ananya Sen, RD",
    rating: "4.9 (120+ reviews)",
    specialty: "Clinical Nutrition & Cardiovascular Health",
    address: "MediLink Health Center, Block C, Metro Region",
    phone: "+1 (555) 019-3829",
    timeSlots: ["10:30 AM", "2:00 PM", "4:30 PM"],
    img: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=200&auto=format&fit=crop"
  },
  {
    name: "Marcus Vance, PhD, CNS",
    rating: "4.8 (85+ reviews)",
    specialty: "Renal & Diabetic Medical Nutrition Therapy",
    address: "Vance Care Clinic, Suite 402, Metro Region",
    phone: "+1 (555) 018-8833",
    timeSlots: ["11:00 AM", "1:30 PM", "3:00 PM"],
    img: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?q=80&w=200&auto=format&fit=crop"
  }
];

const conditionDiets = {
  hypertension: {
    title: "DASH Diet Plan (Cardiorespiratory Care)",
    points: [
      "Limit sodium intake strictly to less than 1,500mg per day.",
      "Incorporate high-potassium foods daily (bananas, spinach, sweet potatoes).",
      "Focus on whole grains, poultry, fish, and rich dietary fiber.",
      "Avoid processed meats, high-fat dairy products, and heavy salt seasonings."
    ],
    avoid: "Aged cheese, pickles, soy sauce, table salt, packaged soups."
  },
  fever: {
    title: "Hydration & Soft-Recovery Diet Plan (Pediatric/General)",
    points: [
      "Focus primarily on continuous fluid intake (coconut water, warm broths).",
      "Consume soft carbohydrates like steamed rice, clear lentil stews, and banana mash.",
      "Introduce immune-support vit C juices (diluted orange or fresh lemon).",
      "Avoid heavy fats, fried spices, cold items, and processed sugar sweets."
    ],
    avoid: "Ice creams, rich chocolates, deep-fried snacks, soft drinks."
  },
  migraine: {
    title: "Headache Care & High-Magnesium Intake Plan (Neurology)",
    points: [
      "Incorporate foods rich in Magnesium and Riboflavin (almonds, leafy greens, quinoa).",
      "Eat regular meals at identical times daily to keep blood sugar stable.",
      "Drink at least 3 liters of plain water throughout the day.",
      "Avoid common triggers like tyramine, monosodium glutamate (MSG), and artificial sweeteners."
    ],
    avoid: "Aged foods, heavy caffeine, zero-sugar soda, dark chocolate."
  },
  general: {
    title: "Balanced Daily Wellness Recovery Diet Plan",
    points: [
      "Maintain a 50% plate ratio of colorful vegetables and high-fiber fruits.",
      "Eat lean protein sources (grilled chicken, lentils, paneer, fish) twice daily.",
      "Drink 8-10 glasses of mineral-rich water to aid detoxification.",
      "Reduce processed refined carbs and limit sugar intake."
    ],
    avoid: "Refined sugar, packaged bakery goods, trans fats."
  }
};

export default function PatientMode() {
  const { data: session } = useSession();
  const { queue, messages, loadMessages, isLoadingMessages, showToast } = useHospitalStore();
  const patientId = session?.user?.patientId || session?.user?.id || 'pt_michael_chen';
  const [isStressReduction, setIsStressReduction] = useState(false);
  const [translatedReport, setTranslatedReport] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [pharmacyAlert, setPharmacyAlert] = useState(null);

  const [isSimulatingLab, setIsSimulatingLab] = useState(false);
  const [complianceLogs, setComplianceLogs] = useState({
    morning: false,
    afternoon: false,
    evening: false
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([
    { sender: 'bot', text: 'Hi Michael! I am MediBuddy, your personal health guide. How can I support your wellness journey today? Feel free to ask any questions, click for tailored diet advice, or book an appointment with local clinical dietitians.', time: new Date() }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [showDietitians, setShowDietitians] = useState(false);
  const [snoozeActive, setSnoozeActive] = useState(false);

  const [preventiveHabits, setPreventiveHabits] = useState({
    lowSodium: false,
    hydration: false,
    cardioWalk: false,
    migraineRest: false
  });

  const completedHabitsCount = Object.values(preventiveHabits).filter(Boolean).length;
  const longevityScore = 88 + (completedHabitsCount * 2);
  const activeStreak = 5 + (completedHabitsCount === 4 ? 1 : 0);

  const [scheduledScreenings, setScheduledScreenings] = useState({
    cardio: false,
    metabolic: false,
    retinopathy: false
  });

  // Dynamic visit reason mapping
  const myIndex = queue.findIndex(p => p.id === patientId);
  const myVisit = myIndex !== -1 ? queue[myIndex] : null;
  const activeReason = (myVisit?.reason || 'General').toLowerCase();

  let activeConditionKey = 'general';
  if (activeReason.includes('palpitations') || activeReason.includes('hypertension') || activeReason.includes('chest pain')) {
    activeConditionKey = 'hypertension';
  } else if (activeReason.includes('fever') || activeReason.includes('flu') || activeReason.includes('cold')) {
    activeConditionKey = 'fever';
  } else if (activeReason.includes('headache') || activeReason.includes('migraine')) {
    activeConditionKey = 'migraine';
  }

  const currentDiet = conditionDiets[activeConditionKey];

  const handleToggleCompliance = (timeOfDay) => {
    setComplianceLogs(prev => {
      const updated = { ...prev, [timeOfDay]: !prev[timeOfDay] };
      const val = updated[timeOfDay];
      if (val) {
        showToast(`Adherence logged: You marked your ${timeOfDay} dosage as taken! Keep up the good work.`, "success");
        triggerNativeHaptic('success');
      }
      return updated;
    });
  };

  const handleSendMessage = (text = null) => {
    const userMsg = text || chatInput;
    if (!userMsg.trim()) return;

    // Add user message
    setChatHistory(prev => [...prev, { sender: 'user', text: userMsg, time: new Date() }]);
    setChatInput("");

    // Generate bot reply with delay
    setTimeout(() => {
      const lower = userMsg.toLowerCase();
      let reply = "";
      if (lower.includes("diet") || lower.includes("nutrition") || lower.includes("food") || lower.includes("eat")) {
        reply = `Based on your active cardiorespiratory record (Hypertension risk), we highly recommend the following dietary layout (${currentDiet.title}):
- ${currentDiet.points.join('\n- ')}

⚠️ Avoid: ${currentDiet.avoid}

If you would like a personalized clinical meal plan, you can book an appointment with highly qualified dietitians in your region by clicking the 'Book Dietitian' option below!`;
      } else if (lower.includes("dizzy") || lower.includes("side effect") || lower.includes("sleepy") || lower.includes("amlodipine")) {
        reply = `Michael, a mild feeling of dizziness or fatigue can occasionally occur when starting Amlodipine as your blood vessels relax. We highly recommend resting, hydrating with a glass of water, and avoiding quick standing movements. If this deepens, let's instantly alert Dr. Patel's nursing team.`;
      } else if (lower.includes("headache") || lower.includes("migraine")) {
        reply = `For migraine management, focus on high-magnesium items (almonds, leafy spinach) and drink at least 3 liters of water today. Please rest in a quiet, dark room and avoid heavy caffeine or zero-sugar drinks.`;
      } else if (lower.includes("thank") || lower.includes("cool") || lower.includes("nice")) {
        reply = `You're very welcome, Michael! It is my pleasure to keep you feeling cared for and secure. I am here for you throughout your recovery. Let me know if you need anything else!`;
      } else {
        reply = `I hear you, Michael. To help you feel completely supported, let's keep your recovery simple: take your medications on time, rest, and consult our dietitian circle if you'd like custom metabolic meal plans. Let me know how else I can help!`;
      }

      setChatHistory(prev => [...prev, { sender: 'bot', text: reply, time: new Date() }]);
    }, 800);
  };

  const handleTriggerWhatsappReminder = async () => {
    showToast("Simulating WhatsApp automated medication reminder...", "info");
    try {
      await fetch('/api/messages/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: patientId,
          content: "💊 MediLink Care Reminder: Hi Michael, it is time to take your Amlodipine 5mg as prescribed by Dr. Jenkins. Please select an option to update your clinical logs.",
          channel: "WHATSAPP"
        })
      });
    } catch (err) {
      console.error("Failed to trigger WhatsApp message", err);
    }
  };

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
    showToast("Triggering lab report request to LIMS...", "info");
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
        showToast("New blood test results received from LIMS!", "info");
        setTimeout(() => {
          showToast("AI Pathology translation complete!", "success");
        }, 1500);
      } else {
        showToast("Failed to compile lab results.", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("Error fetching lab reports.", "error");
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

    channel.bind('compliance-checked', (data) => {
      console.log('Compliance checked real-time event:', data);
      const slot = data.timeOfDay || 'morning';
      setComplianceLogs(prev => ({ ...prev, [slot]: data.checked }));
      showToast(`Adherence Logged: Your ${slot} dosage was marked taken via WhatsApp!`, "success");
    });

    channel.bind('compliance-snoozed', (data) => {
      console.log('Compliance snoozed real-time event:', data);
      setSnoozeActive(true);
      showToast(`Medication reminder successfully snoozed for ${data.delayMinutes} minutes!`, "info");
    });

    channel.bind('compliance-reminded', (data) => {
      console.log('Adherence alarm received:', data);
      setSnoozeActive(false); // Snooze expired, alarm is live
      showToast(`🔔 Adherence Alert: It is time to take your ${data.medicationName}!`, "error");
      triggerNativeHaptic('error');
      
      // Try playing a friendly clinical chime to grab patient's attention
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-120.wav');
        audio.volume = 0.4;
        audio.play().catch(e => console.log('Audio autoplay blocked or failed'));
      } catch (e) {
        console.error('Audio chime error:', e);
      }
    });

    return () => {
      channel.unbind('message-received');
      channel.unbind('prescription-ready');
      channel.unbind('compliance-checked');
      channel.unbind('compliance-snoozed');
      channel.unbind('compliance-reminded');
      pusher.unsubscribe(channelName);
    };
  }, [patientId]);
  
  // Find current user in the queue
  const queuePosition = myIndex !== -1 ? myIndex + 1 : 0;
  const isConsulting = myIndex === 0 && queue[0].status === 'consulting';
  const isComplete = myIndex === -1; // If not in queue, assumed complete
  
  // Calculate wait time (just summing wait times of people ahead for simplicity, or using their defined waitTime)
  const waitTime = myIndex !== -1 ? queue[myIndex].waitTime : 0;
  const isDelayed = waitTime > 15 && !isConsulting && !isComplete;

  const handlePrintPrescription = () => {
    const printWindow = window.open('', '_blank');
    const printContent = `
      <html>
        <head>
          <title>Official Medical Prescription - MediLink</title>
          <style>
            body { font-family: 'Inter', sans-serif; color: #1e293b; padding: 40px; line-height: 1.6; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #1e40af; padding-bottom: 20px; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #1e40af; }
            .hospital-info { text-align: right; font-size: 12px; color: #64748b; }
            .title { text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; color: #1e3a8a; letter-spacing: 1px; }
            .patient-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; margin-bottom: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px; }
            .section-title { font-size: 14px; font-weight: bold; color: #1e40af; border-bottom: 1px dashed #cbd5e1; padding-bottom: 6px; margin-bottom: 12px; text-transform: uppercase; }
            .rx-symbol { font-size: 32px; font-weight: bold; color: #1e40af; font-family: 'Times New Roman', serif; margin-bottom: 10px; }
            .medication-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            .medication-table th { background: #f1f5f9; text-align: left; padding: 10px; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
            .medication-table td { padding: 12px 10px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
            .signature-area { margin-top: 60px; display: flex; justify-content: space-between; font-size: 14px; }
            .signature-box { border-top: 1px solid #94a3b8; width: 200px; text-align: center; padding-top: 8px; margin-top: 40px; }
            .barcode { font-family: 'Courier', monospace; font-size: 11px; text-align: center; color: #94a3b8; margin-top: 60px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="logo">MEDILINK METRO CLINIC</div>
              <div style="font-size: 12px; color: #64748b;">Outpatient Operations System</div>
            </div>
            <div class="hospital-info">
              <strong>Address:</strong> 100 Medical Plaza, Floor 4<br/>
              <strong>Contact:</strong> +1 (555) 019-3829 | care@medilink.com
            </div>
          </div>

          <div class="title">Official Outpatient Prescription</div>

          <div class="patient-card">
            <div><strong>Patient Name:</strong> Michael Chen</div>
            <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
            <div><strong>Age / Gender:</strong> 34 Y / Male</div>
            <div><strong>Rx ID:</strong> RX-${Math.floor(100000 + Math.random() * 900000)}</div>
            <div><strong>Consulting Physician:</strong> Dr. Sarah Jenkins, MD</div>
            <div><strong>Department:</strong> Cardiorespiratory Care</div>
          </div>

          <div class="rx-symbol">Rₓ</div>

          <table class="medication-table">
            <thead>
              <tr>
                <th>Medication & Strength</th>
                <th>Dosage</th>
                <th>Frequency</th>
                <th>Duration</th>
                <th>Instructions / Sig</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Amlodipine 5mg</strong></td>
                <td>1 Tablet</td>
                <td>QD (Once Daily)</td>
                <td>14 Days</td>
                <td>Take 1 tablet once daily in the morning before meals</td>
              </tr>
              <tr>
                <td><strong>Paracetamol 500mg</strong></td>
                <td>1 Tablet</td>
                <td>TID (Three Times Daily)</td>
                <td>3 Days</td>
                <td>Take 1 tablet three times daily after meals as needed for headache</td>
              </tr>
            </tbody>
          </table>

          <div class="section-title">Clinical SOAP Assessments & Directions</div>
          <p style="font-size: 14px; color: #334155; margin-bottom: 40px; line-height: 1.6;">
            <strong>Diagnosis:</strong> Essential Hypertension (ICD-10: I10) with occasional tension headache symptoms. Vitals stable.<br/>
            <strong>Directions:</strong> Limit sodium intake strictly to less than 1,500mg/day. Adhere strictly to the cardiorespiratory DASH dietary layout. Drink at least 3 liters of plain water daily. Rest in a dark, quiet room during acute cephalalgic episodes.
          </p>

          <div class="signature-area">
            <div class="signature-box">
              Patient Signature
            </div>
            <div class="signature-box">
              <strong>Dr. Sarah Jenkins, MD</strong><br/>
              License No: MD-92813-A
            </div>
          </div>

          <div class="barcode">
            ||||| | |||| ||| || |||||| | ||| ||||<br/>
            SECURITY SECURE VERIFICATION CODE: ABHA-M-9021-X-442A
          </div>

          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(printContent);
    printWindow.document.close();
    showToast("Prescription print queue initialized!", "success");
  };

  const handleToggleHabit = (habitKey, label) => {
    setPreventiveHabits(prev => {
      const updated = { ...prev, [habitKey]: !prev[habitKey] };
      if (updated[habitKey]) {
        showToast(`🍏 Preventive Habit Logged: "${label}" successfully registered! Great choice for cardiorespiratory health.`, "success");
        triggerNativeHaptic('light');
      }
      return updated;
    });
  };

  const handleScheduleScreening = (screeningKey, title) => {
    setScheduledScreenings(prev => ({ ...prev, [screeningKey]: true }));
    showToast(`📅 Preventative check scheduled: "${title}" is successfully booked! A confirmation text was sent to your phone.`, "success");
  };

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

          {/* Daily Medication Tracker & Discharge Timeline */}
          <div className="card" style={{ borderLeft: '4px solid var(--color-success)', background: 'linear-gradient(to right, #f0fdf4, #ffffff)', padding: cardPadding }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: isStressReduction ? '1.3rem' : 'var(--font-size-base)' }}>
                <CheckCircle2 color="var(--color-success)" size={20} />
                Daily Medication Tracker & Discharge Timeline
              </div>
              <button 
                onClick={handlePrintPrescription}
                className="btn btn-outline" 
                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', borderColor: '#10b981', color: '#15803d' }}
              >
                <FileText size={12} /> Print Official Rx
              </button>
            </div>
            
            <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {!isStressReduction && (
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                  Following your clinical check-out, please log your medication adherence daily. Clinical abbreviations have been translated to plain English for your safety.
                </p>
              )}
              
              {/* Prescriptions List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {mockPrescriptions.map((med, idx) => (
                  <div key={idx} style={{ padding: '10px 12px', backgroundColor: 'white', border: '1px solid #d1fae5', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)', color: '#166534' }}>{med.drugName}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: '#065f46', marginTop: '2px' }}>
                        Dosage: {med.dosage} • {med.duration} • <span style={{ textTransform: 'uppercase', fontWeight: 'bold' }}>{med.frequency}</span>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: '#374151', fontStyle: 'italic', marginTop: '4px' }}>
                        Instructions: {translateSig(med.frequency)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Adherence check */}
              <div style={{ borderTop: '1px dashed #d1fae5', paddingTop: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#15803d', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
                  TODAY'S DOSAGE CHECKLIST
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    padding: '8px 12px', 
                    backgroundColor: complianceLogs.morning ? '#d1fae5' : '#f8fafc',
                    border: complianceLogs.morning ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: complianceLogs.morning ? '#065f46' : '#64748b',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={complianceLogs.morning} 
                      onChange={() => handleToggleCompliance('morning')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    Morning
                  </label>

                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    padding: '8px 12px', 
                    backgroundColor: complianceLogs.afternoon ? '#d1fae5' : '#f8fafc',
                    border: complianceLogs.afternoon ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: complianceLogs.afternoon ? '#065f46' : '#64748b',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={complianceLogs.afternoon} 
                      onChange={() => handleToggleCompliance('afternoon')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    Afternoon
                  </label>

                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    padding: '8px 12px', 
                    backgroundColor: complianceLogs.evening ? '#d1fae5' : '#f8fafc',
                    border: complianceLogs.evening ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: complianceLogs.evening ? '#065f46' : '#64748b',
                    fontWeight: 600,
                    transition: 'all 0.2s'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={complianceLogs.evening} 
                      onChange={() => handleToggleCompliance('evening')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    Evening
                  </label>

                </div>
              </div>
            </div>
          </div>

          {/* Preventative Care & Longevity Wellness Hub */}
          <div className="card" style={{ borderLeft: '4px solid #10b981', background: 'linear-gradient(to right, #f0fdf4, #ffffff)', padding: cardPadding }}>
            <div className="card-header" style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: isStressReduction ? '1.3rem' : 'var(--font-size-base)', fontWeight: 600 }}>
                <HeartHandshake color="#10b981" size={20} />
                Preventative Care & Longevity Hub
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Proactive Risk Stratification Profile */}
              <div style={{ backgroundColor: '#f0fdf4', padding: '14px 16px', borderRadius: '8px', border: '1px solid #bbf7d0', transition: 'all 0.3s ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#166534', textTransform: 'uppercase' }}>Clinical Health Score</span>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#15803d', transition: 'all 0.3s ease' }}>Optimal ({longevityScore}/100)</span>
                </div>
                <div style={{ height: '8px', width: '100%', backgroundColor: '#e2e8f0', borderRadius: '50px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${longevityScore}%`, backgroundColor: '#10b981', borderRadius: '50px', transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                </div>
                <p style={{ fontSize: '11px', color: '#166534', margin: '8px 0 0 0', lineHeight: 1.4 }}>
                  Based on your vital stats (BP: 120/80) and active cardiorespiratory profile, your cardiovascular risk is low. Maintain healthy habits to protect your longevity.
                </p>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed #bbf7d0', fontSize: '11px', color: '#15803d' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                    🔥 Longevity Streak: {activeStreak} Days
                  </span>
                  <span>
                    Habits logged: <strong>{completedHabitsCount}/4</strong>
                  </span>
                </div>

                {completedHabitsCount === 4 && (
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '8px 12px', 
                    backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                    border: '1px solid #10b981', 
                    borderRadius: '6px', 
                    fontSize: '11px', 
                    color: '#065f46', 
                    fontWeight: 600,
                    animation: 'pulse 2s infinite',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    🎉 Perfect Day achieved! Streaks and cardiovascular vitality boosted!
                  </div>
                )}
              </div>

              {/* Preventative Screening Recommendations */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#15803d', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
                  RECOMMENDED SCREENINGS & PROCEDURES
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Screening 1 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: 'white', border: '1px solid #d1fae5', borderRadius: '8px' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e293b' }}>Comprehensive Metabolic Panel (CMP)</div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Preventive test recommended annually for adults.</div>
                    </div>
                    <button
                      onClick={() => handleScheduleScreening('metabolic', 'Comprehensive Metabolic Panel (CMP)')}
                      disabled={scheduledScreenings.metabolic}
                      className="btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: scheduledScreenings.metabolic ? '#f0fdf4' : '#10b981',
                        color: scheduledScreenings.metabolic ? '#166534' : 'white',
                        border: scheduledScreenings.metabolic ? '1px solid #bbf7d0' : 'none',
                        borderRadius: '6px',
                        cursor: scheduledScreenings.metabolic ? 'default' : 'pointer'
                      }}
                    >
                      {scheduledScreenings.metabolic ? '✓ Booked' : 'Book Screening'}
                    </button>
                  </div>

                  {/* Screening 2 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: 'white', border: '1px solid #d1fae5', borderRadius: '8px' }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e293b' }}>Hypertensive Retinopathy Screening</div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Preventive eye check for patients with cardiorespiratory risk.</div>
                    </div>
                    <button
                      onClick={() => handleScheduleScreening('retinopathy', 'Hypertensive Retinopathy Screening')}
                      disabled={scheduledScreenings.retinopathy}
                      className="btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: scheduledScreenings.retinopathy ? '#f0fdf4' : '#10b981',
                        color: scheduledScreenings.retinopathy ? '#166534' : 'white',
                        border: scheduledScreenings.retinopathy ? '1px solid #bbf7d0' : 'none',
                        borderRadius: '6px',
                        cursor: scheduledScreenings.retinopathy ? 'default' : 'pointer'
                      }}
                    >
                      {scheduledScreenings.retinopathy ? '✓ Booked' : 'Book Screening'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Preventive Habits & Longevity Goals */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#15803d', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
                  DAILY LONGEVITY HABIT CHECKLIST
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {/* Habit 1 */}
                  <label style={{ 
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', 
                    backgroundColor: preventiveHabits.lowSodium ? '#d1fae5' : '#f8fafc',
                    border: preventiveHabits.lowSodium ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
                    color: preventiveHabits.lowSodium ? '#065f46' : '#64748b', fontWeight: 600
                  }}>
                    <input 
                      type="checkbox" 
                      checked={preventiveHabits.lowSodium} 
                      onChange={() => handleToggleHabit('lowSodium', 'Low-Sodium DASH Meal Logged')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    🍏 DASH Meal Logged
                  </label>

                  {/* Habit 2 */}
                  <label style={{ 
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', 
                    backgroundColor: preventiveHabits.hydration ? '#d1fae5' : '#f8fafc',
                    border: preventiveHabits.hydration ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
                    color: preventiveHabits.hydration ? '#065f46' : '#64748b', fontWeight: 600
                  }}>
                    <input 
                      type="checkbox" 
                      checked={preventiveHabits.hydration} 
                      onChange={() => handleToggleHabit('hydration', '3L Hydration Completed')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    💧 3L Water Logged
                  </label>

                  {/* Habit 3 */}
                  <label style={{ 
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', 
                    backgroundColor: preventiveHabits.cardioWalk ? '#d1fae5' : '#f8fafc',
                    border: preventiveHabits.cardioWalk ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
                    color: preventiveHabits.cardioWalk ? '#065f46' : '#64748b', fontWeight: 600
                  }}>
                    <input 
                      type="checkbox" 
                      checked={preventiveHabits.cardioWalk} 
                      onChange={() => handleToggleHabit('cardioWalk', '30 min brisk cardiovascular walk completed')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    🚶 30m Cardio Walk
                  </label>

                  {/* Habit 4 */}
                  <label style={{ 
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', 
                    backgroundColor: preventiveHabits.migraineRest ? '#d1fae5' : '#f8fafc',
                    border: preventiveHabits.migraineRest ? '1px solid #10b981' : '1px solid var(--border-light)',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '11px',
                    color: preventiveHabits.migraineRest ? '#065f46' : '#64748b', fontWeight: 600
                  }}>
                    <input 
                      type="checkbox" 
                      checked={preventiveHabits.migraineRest} 
                      onChange={() => handleToggleHabit('migraineRest', 'Screen-free rest duration logged')}
                      style={{ accentColor: '#10b981', cursor: 'pointer' }}
                    />
                    🧠 Screen-free Rest
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* WhatsApp Medication Compliance Simulator */}
          <div className="card" style={{ borderLeft: '4px solid #0ea5e9', background: 'linear-gradient(to right, #f0f9ff, #ffffff)', padding: cardPadding }}>
            <div className="card-header" style={{ marginBottom: '8px' }}>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-base)', fontWeight: 600 }}>
                <Smartphone color="#0ea5e9" size={20} />
                Compliance & WhatsApp Integration Test
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                Test the hospital's automated WhatsApp compliance and interactive alert systems. Triggering the alert pushes a simulated care message directly into your live communications feed below.
              </p>
              <button 
                onClick={handleTriggerWhatsappReminder}
                className="btn btn-outline"
                style={{ 
                  borderColor: '#0ea5e9', 
                  color: '#0284c7', 
                  padding: '8px 12px', 
                  fontSize: '12px',
                  fontWeight: 600,
                  justifyContent: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <BotIcon size={14} /> Simulate WhatsApp Medication Alert
              </button>
            </div>
          </div>

          {/* Quick Actions (Always visible, enlarged in Stress Mode) */}
          <div className="card" style={{ padding: cardPadding }}>
            <div className="card-header">
              <div className="card-title" style={{ fontSize: isStressReduction ? '1.3rem' : 'var(--font-size-base)' }}><MessageCircle size={20} style={{ marginRight: '8px' }} /> I need help with...</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
              <button onClick={() => showToast("Navigation active! Room 402 is on Floor 4.", "info")} className="btn btn-outline" style={{ justifyContent: 'center', padding: '12px', fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Finding Room 402</button>
              <button onClick={() => showToast("Wheelchair assistance request dispatched to Front Desk.", "success")} className="btn btn-outline" style={{ justifyContent: 'center', padding: '12px', fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Wheelchair Request</button>
              <button onClick={() => showToast("Triage Nurse alerted! A support staff will navigate to your seat shortly.", "success")} className="btn btn-outline" style={{ justifyContent: 'center', padding: '12px', fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Talk to a Nurse</button>
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
                  messages.map((msg, i) => {
                    const isAdherenceReminder = msg.content.includes("MediLink Care Reminder");
                    return (
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
                          maxWidth: '95%',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                          border: isAdherenceReminder ? '2px solid #22c55e' : '1px solid rgba(0,0,0,0.05)',
                        }}
                      >
                        <div style={{ fontSize: '0.9375rem', color: '#0f172a', lineHeight: 1.4, fontWeight: isAdherenceReminder ? 500 : 'normal' }}>
                          {msg.content}
                        </div>
                        
                        {isAdherenceReminder && (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', borderTop: '1px dashed #a7f3d0', paddingTop: '8px' }}>
                            <button
                              onClick={async () => {
                                setComplianceLogs(prev => ({ ...prev, morning: true }));
                                showToast("Compliance Logged! Amlodipine marked as taken via WhatsApp.", "success");
                                try {
                                  // Send patient taken reply
                                  await fetch('/api/messages/trigger', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      patientId: patientId,
                                      content: "Amlodipine 5mg has been taken. Adherence checklist updated.",
                                      channel: "WHATSAPP"
                                    })
                                  });
                                  // Send automated hospital acknowledgement
                                  setTimeout(async () => {
                                    await fetch('/api/messages/trigger', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        patientId: patientId,
                                        content: "✅ Thank you, Michael! Your check-in has been logged in our secure HIPAA compliance ledger. Keep up your healthy adherence!",
                                        channel: "WHATSAPP"
                                      })
                                    });
                                  }, 800);
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              style={{ 
                                flex: 1, 
                                backgroundColor: '#10b981', 
                                border: 'none', 
                                borderRadius: '6px', 
                                color: 'white', 
                                padding: '6px', 
                                fontSize: '11px', 
                                fontWeight: 'bold', 
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px'
                              }}
                            >
                              Mark Taken ✅
                            </button>
                            <button
                              onClick={async () => {
                                setSnoozeActive(true);
                                showToast("Medication reminder snoozed in database! Polling scheduler will fire alarm in 20 seconds.", "info");
                                try {
                                  // Send patient snooze reply
                                  await fetch('/api/messages/trigger', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      patientId: patientId,
                                      content: "⏰ Snooze reminder scheduled in database for 20 seconds.",
                                      channel: "WHATSAPP"
                                    })
                                  });
                                  
                                  // Send automated response
                                  setTimeout(async () => {
                                    await fetch('/api/messages/trigger', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        patientId: patientId,
                                        content: "⏰ Snoozed. We will ping you again shortly! Make sure to take Amlodipine 5mg.",
                                        channel: "WHATSAPP"
                                      })
                                    });
                                  }, 800);

                                  // Call real snooze API to schedule in database
                                  await fetch('/api/messages/snooze', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      patientId: patientId,
                                      medicationName: 'Amlodipine 5mg',
                                      delaySeconds: 20
                                    })
                                  });

                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              style={{ 
                                flex: 1, 
                                backgroundColor: '#f59e0b', 
                                border: 'none', 
                                borderRadius: '6px', 
                                color: 'white', 
                                padding: '6px', 
                                fontSize: '11px', 
                                fontWeight: 'bold', 
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px'
                              }}
                            >
                              Snooze 30m ⏰
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.6875rem', color: '#64748b' }}>
                          <span>{msg.channel}</span>
                          <span>
                            {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })
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
                <button onClick={() => showToast("Diabetes Screening scheduled! A confirmation SMS has been sent to your phone.", "success")} className="btn btn-primary" style={{ flex: 1, fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Yes, Book Now</button>
                <button onClick={() => showToast("Diabetes screening reminder postponed by 2 weeks.", "info")} className="btn btn-outline" style={{ flex: 1, fontSize: isStressReduction ? '1.1rem' : 'var(--font-size-sm)' }}>Remind Me Later</button>
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
          {/* MediBuddy Floating Calm Care Chatbot */}
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 999 }}>
        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              style={{
                width: '360px',
                height: '480px',
                backgroundColor: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(16px)',
                borderRadius: '16px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                border: '1px solid rgba(226, 232, 240, 0.8)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                marginBottom: '12px'
              }}
            >
              {/* Chat Header */}
              <div style={{ backgroundColor: 'var(--color-primary)', padding: '16px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🤖</div>
                    <div style={{ position: 'absolute', bottom: 0, right: 0, width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', border: '2px solid var(--color-primary)' }}></div>
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold' }}>MediBuddy Care Guide</div>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Calming Empathy Companion</div>
                  </div>
                </div>
                <button 
                  onClick={() => setIsChatOpen(false)} 
                  style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Chat Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#f8fafc' }}>
                {showDietitians ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase' }}>LOCAL DIETITIANS MATCHED</span>
                      <button 
                        onClick={() => setShowDietitians(false)}
                        style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        ← Back to Chat
                      </button>
                    </div>
                    
                    {localDietitians.map((d, i) => (
                      <div key={i} style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', display: 'flex', gap: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <img src={d.img} alt={d.name} style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#1e293b' }}>{d.name}</span>
                          <span style={{ fontSize: '10px', color: '#eab308', display: 'flex', alignItems: 'center', gap: '2px' }}>⭐ {d.rating}</span>
                          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{d.specialty}</span>
                          <span style={{ fontSize: '9px', color: '#64748b' }}>📍 {d.address}</span>
                          
                          <div style={{ marginTop: '8px', borderTop: '1px dashed #e2e8f0', paddingTop: '8px' }}>
                            <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>AVAILABLE SLOTS TOMORROW:</div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {d.timeSlots.map((slot, sIdx) => (
                                <button
                                  key={sIdx}
                                  onClick={async () => {
                                    showToast(`Booking request submitted for ${slot}!`, "info");
                                    setShowDietitians(false);
                                    setChatHistory(prev => [...prev, { 
                                      sender: 'bot', 
                                      text: `📅 Booking Confirmed! Your tele-consultation with ${d.name} has been scheduled for tomorrow at ${slot}. We have shared your active metabolic lab history and clinical record with them securely.`,
                                      time: new Date() 
                                    }]);
                                    
                                    // Send WhatsApp confirmation text
                                    try {
                                      await fetch('/api/messages/trigger', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          patientId: patientId,
                                          content: `📅 Appointment Booked: Hi Michael, your tele-consultation with dietitian ${d.name} is successfully scheduled for tomorrow at ${slot}. Link to consult: https://medilink.care/live-consult`,
                                          channel: "WHATSAPP"
                                        })
                                      });
                                    } catch (e) {
                                      console.error(e);
                                    }
                                  }}
                                  style={{
                                    padding: '2px 6px',
                                    fontSize: '9px',
                                    backgroundColor: '#eff6ff',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '4px',
                                    color: '#1e40af',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {slot}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {chatHistory.map((chat, idx) => (
                      <div 
                        key={idx} 
                        style={{ 
                          alignSelf: chat.sender === 'user' ? 'flex-end' : 'flex-start',
                          maxWidth: '85%',
                          backgroundColor: chat.sender === 'user' ? 'var(--color-primary)' : 'white',
                          color: chat.sender === 'user' ? 'white' : 'var(--color-text-main)',
                          padding: '10px 12px',
                          borderRadius: '12px',
                          borderBottomLeftRadius: chat.sender === 'bot' ? '2px' : '12px',
                          borderBottomRightRadius: chat.sender === 'user' ? '2px' : '12px',
                          fontSize: '12px',
                          lineHeight: 1.4,
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                          border: chat.sender === 'bot' ? '1px solid #e2e8f0' : 'none'
                        }}
                      >
                        {chat.text}
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Chat Input & Option Chips */}
              {!showDietitians && (
                <div style={{ padding: '12px', borderTop: '1px solid #e2e8f0', backgroundColor: 'white', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Prompt Chips */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button 
                      onClick={() => handleSendMessage("🍏 Diet Advice")}
                      style={{ padding: '3px 8px', fontSize: '10px', borderRadius: '50px', border: '1px solid #bfdbfe', backgroundColor: '#eff6ff', color: '#1e40af', fontWeight: 500, cursor: 'pointer' }}
                    >
                      🍏 Diet Advice
                    </button>
                    <button 
                      onClick={() => handleSendMessage("💊 Side effects")}
                      style={{ padding: '3px 8px', fontSize: '10px', borderRadius: '50px', border: '1px solid #fecdd3', backgroundColor: '#fff1f2', color: '#be123c', fontWeight: 500, cursor: 'pointer' }}
                    >
                      💊 Side effects?
                    </button>
                    <button 
                      onClick={() => setShowDietitians(true)}
                      style={{ padding: '3px 8px', fontSize: '10px', borderRadius: '50px', border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', color: '#166534', fontWeight: 500, cursor: 'pointer' }}
                    >
                      👩‍⚕️ Book Dietitian
                    </button>
                  </div>

                  {/* Text Input Row */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Ask MediBuddy anything..."
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '20px', border: '1px solid #cbd5e1', fontSize: '12px', outline: 'none' }}
                    />
                    <button 
                      onClick={() => handleSendMessage()}
                      style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--color-primary)', border: 'none', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Bubble Icon */}
        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            boxShadow: '0 4px 10px rgba(30, 64, 175, 0.3)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            transition: 'all 0.2s',
            outline: 'none'
          }}
          onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
          onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
        >
          {isChatOpen ? <X size={24} /> : <MessageCircle size={24} />}
        </button>
      </div>

        </div>
      </div>
    </div>
  );
}
