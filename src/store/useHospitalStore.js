import { create } from 'zustand';

export const useHospitalStore = create((set, get) => ({
  // ── State ─────────────────────────────────────────────────────
  queue: [],
  messages: [],
  adminMetrics: {
    totalActivePatients: 0,
    revenueProtected: 0,
    consultationsCompletedToday: 0,
    flaggedClaims: 0,
    experienceScore: 100,
  },
  isLoadingQueue: false,
  isLoadingMetrics: false,
  isLoadingMessages: false,
  lastSyncAt: null,
  toast: null,

  // ── OPTION A: Load queue from database ──────────────────────
  loadQueue: async () => {
    set({ isLoadingQueue: true });
    try {
      const res = await fetch('/api/visits');
      if (!res.ok) throw new Error('Failed to fetch queue');
      const visits = await res.json();

      // Map DB visit format → Zustand queue format
      const queue = visits.map((v) => ({
        visitId: v.id,
        id: v.patient?.id || v.patientId,
        name: v.patient?.name || 'Unknown',
        status: v.status === 'CONSULTING' ? 'consulting' : 'waiting',
        reason: v.reason || 'General',
        waitTime: v.waitTime || 0,
        critical: v.isCritical || false,
        queuePosition: v.queuePosition,
        bloodGroup: v.patient?.bloodGroup || '—',
        doctorId: v.doctorId,
        vitals: v.vitals,
        patient: v.patient,
      }));

      set({ queue, isLoadingQueue: false, lastSyncAt: new Date() });
    } catch (err) {
      console.warn('Queue load failed, using fallback state:', err.message);
      // Graceful fallback — keep whatever state is already in the store
      set({ isLoadingQueue: false });
    }
  },

  // Initialize Pusher for real-time queue sync
  initializePusher: () => {
    // Prevent multiple initializations
    if (get()._pusherSubscribed) return;
    set({ _pusherSubscribed: true });

    const { getPusherClient } = require('@/lib/pusher');
    const pusher = getPusherClient();
    
    // FAULT TOLERANCE: Fallback to polling if Pusher keys are missing
    if (!pusher || !pusher.subscribe) {
      console.warn('Pusher disabled. Falling back to 5-second polling for queue.');
      setInterval(() => {
        get().loadQueue();
        get().loadMetrics();
      }, 5000);
      return;
    }

    const channel = pusher.subscribe('hospital-queue');
    channel.bind('queue-updated', (data) => {
      console.log('Real-time queue update received via Pusher!', data);
      get().loadQueue();
      get().loadMetrics();
    });
  },

  // ── OPTION A: Load metrics from database ──────────────────────
  loadMetrics: async () => {
    set({ isLoadingMetrics: true });
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error('Failed to fetch metrics');
      const data = await res.json();
      set({
        adminMetrics: {
          totalActivePatients: data.totalActivePatients || 0,
          revenueProtected: data.revenueProtected || 0,
          consultationsCompletedToday: data.consultationCount || 0,
          flaggedClaims: data.flaggedClaims || 0,
          experienceScore: data.experienceScore || 100,
        },
        isLoadingMetrics: false,
      });
    } catch (err) {
      console.warn('Metrics load failed, using fallback state:', err.message);
      set({ isLoadingMetrics: false });
    }
  },

  // ── OPTION C: Load patient messages from database ───────────────
  loadMessages: async (patientId) => {
    if (!patientId) return;
    set({ isLoadingMessages: true });
    try {
      const res = await fetch(`/api/messages?patientId=${patientId}`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      const messages = await res.json();
      set({ messages, isLoadingMessages: false });
    } catch (err) {
      console.warn('Messages load failed:', err.message);
      set({ isLoadingMessages: false });
    }
  },

  // ── OPTION C: Optimistically add a message ──────────────────────
  addMessage: (message) => set((state) => ({
    messages: [message, ...state.messages]
  })),

  // ── OPTION A: Complete consultation — persists to database ────
  completeConsultation: async (emergencyBypass = false) => {
    const { queue } = get();
    if (queue.length === 0) return;

    const currentVisit = queue[0];

    // Optimistic UI update first (instant feedback)
    set((state) => {
      const updatedQueue = [...state.queue];
      updatedQueue.shift();
      if (updatedQueue.length > 0) {
        updatedQueue[0] = { ...updatedQueue[0], status: 'consulting' };
      }
      return {
        queue: updatedQueue,
        adminMetrics: {
          ...state.adminMetrics,
          totalActivePatients: Math.max(0, state.adminMetrics.totalActivePatients - 1),
          revenueProtected: state.adminMetrics.revenueProtected + 1500,
          consultationsCompletedToday: state.adminMetrics.consultationsCompletedToday + 1,
        },
      };
    });

    // Persist to database in the background
    if (currentVisit.visitId) {
      try {
        await fetch(`/api/visits/${currentVisit.visitId}/complete`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emergencyBypass })
        });
      } catch (err) {
        console.warn('Failed to persist visit completion to DB:', err.message);
        // UI already updated — non-blocking failure
      }
    }
  },

  // ── Add a new patient to queue (optimistic) ───────────────────
  addPatient: (patient) => set((state) => ({
    queue: [...state.queue, patient],
    adminMetrics: {
      ...state.adminMetrics,
      totalActivePatients: state.adminMetrics.totalActivePatients + 1,
    },
  })),

  // ── Manual sync (pull latest from DB) ─────────────────────────
  syncAll: () => {
    get().loadQueue();
    get().loadMetrics();
  },

  // ── Toast Notifications ───────────────────────────────────────
  showToast: (message, type = 'success') => {
    set({ toast: { message, type } });
    setTimeout(() => {
      const current = get().toast;
      if (current && current.message === message) {
        set({ toast: null });
      }
    }, 4000);
  },
  clearToast: () => set({ toast: null }),
}));
