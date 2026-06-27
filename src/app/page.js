'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import PatientMode from '@/components/modes/PatientMode';
import DoctorMode from '@/components/modes/DoctorMode';
import AdminMode from '@/components/modes/AdminMode';
import NurseMode from '@/components/modes/NurseMode';
import PharmacyMode from '@/components/modes/PharmacyMode';
import CashierMode from '@/components/modes/CashierMode';
import { PageTransition } from '@/components/ui/MotionKit';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import Toast from '@/components/ui/Toast';
import { useHospitalStore } from '@/store/useHospitalStore';
import { AnimatePresence } from 'framer-motion';
import { Loader2, ShieldX } from 'lucide-react';
import { setupFetchInterceptor, syncOfflineMutations, getOfflineMutations } from '@/lib/offlineSync';
import { triggerNativeHaptic } from '@/lib/native';

// Map each role to the ONLY mode(s) that role can access.
// This is the single source of truth for frontend routing authorization.
// Any mode not listed for a role is inaccessible — the UI never renders it.
const ROLE_MODE_MAP = {
  patient:    ['patient'],
  doctor:     ['doctor'],
  admin:      ['admin'],
  nurse:      ['nurse'],
  pharmacist: ['pharmacist'],
  cashier:    ['cashier'],
};

const modeComponents = {
  patient:    <PatientMode />,
  doctor:     <DoctorMode />,
  admin:      <AdminMode />,
  nurse:      <NurseMode />,
  pharmacist: <PharmacyMode />,
  cashier:    <CashierMode />,
};

export default function DashboardContainer() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast, clearToast } = useHospitalStore();

  // Default mode from the logged-in user's role
  const [activeMode, setActiveMode] = useState(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Compute the whitelist of modes this user is allowed to access.
  // useMemo ensures this never changes unless the session role changes.
  const allowedModes = useMemo(() => {
    const role = session?.user?.role?.toLowerCase();
    return role ? (ROLE_MODE_MAP[role] || []) : [];
  }, [session?.user?.role]);

  // Service Worker & Offline/Online Listeners
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('MediLink Service Worker registered:', registration.scope);
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }

    const store = useHospitalStore.getState();
    setupFetchInterceptor(store.showToast, triggerNativeHaptic);

    const updatePendingCount = async () => {
      const pending = await getOfflineMutations();
      setPendingSyncCount(pending.length);
    };

    updatePendingCount();

    if (typeof window !== 'undefined' && window.navigator.onLine) {
      syncOfflineMutations(store.showToast, triggerNativeHaptic).then(() => {
        store.syncAll();
      });
    }

    const handleOnline = async () => {
      setIsOffline(false);
      await syncOfflineMutations(store.showToast, triggerNativeHaptic);
      store.syncAll();
    };

    const handleOffline = () => {
      setIsOffline(true);
      triggerNativeHaptic('warning');
    };

    const handleQueueChanged = async () => { await updatePendingCount(); };
    const handleSyncCompleted = () => { store.syncAll(); };

    if (typeof window !== 'undefined') {
      setIsOffline(!window.navigator.onLine);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      window.addEventListener('offline-sync-queue-changed', handleQueueChanged);
      window.addEventListener('offline-sync-completed', handleSyncCompleted);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('offline-sync-queue-changed', handleQueueChanged);
      window.removeEventListener('offline-sync-completed', handleSyncCompleted);
    };
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Auto-set mode based on role when session loads.
  // Always uses the FIRST (default) allowed mode for this role.
  useEffect(() => {
    if (session?.user?.role && allowedModes.length > 0) {
      setActiveMode(allowedModes[0]);
    }
  }, [session?.user?.role, allowedModes]);

  // RBAC-enforced mode switch: validates the target mode against the whitelist.
  // A Patient calling setActiveMode('admin') from the browser console will receive
  // no UI change — the unauthorized mode is silently rejected.
  const handleSetActiveMode = (mode) => {
    if (!allowedModes.includes(mode)) {
      console.warn(
        `[MediLink RBAC] Access denied: Role '${session?.user?.role}' cannot access mode '${mode}'.`
      );
      return; // Silent rejection — no UI feedback to avoid information disclosure
    }
    setActiveMode(mode);
    setIsMobileNavOpen(false);
  };

  // Loading state
  if (status === 'loading' || status === 'unauthenticated' || !activeMode) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f0f4f8', flexDirection: 'column', gap: 12,
      }}>
        <Loader2 size={28} color="#1e40af" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '0.875rem', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>
          Loading MediLink...
        </span>
      </div>
    );
  }

  // Safety net: if a mode is active but not in allowedModes, show access denied
  // (shouldn't happen normally but guards against race conditions)
  if (activeMode && !allowedModes.includes(activeMode)) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fef2f2', flexDirection: 'column', gap: 16,
      }}>
        <ShieldX size={48} color="#dc2626" />
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ color: '#dc2626', fontFamily: 'Inter, sans-serif', margin: 0 }}>Access Denied</h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: 8 }}>
            Your role does not have permission to view this section.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {isOffline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          backgroundColor: 'rgba(217, 119, 6, 0.92)', backdropFilter: 'blur(12px)',
          color: 'white', textAlign: 'center', padding: '10px 16px',
          fontSize: '13px', fontWeight: 600, boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '8px', animation: 'fadeIn 0.3s ease-out'
        }}>
          <span>
            ⚠️ Connection Lost: Offline Mode Active. {pendingSyncCount > 0
              ? `🔥 ${pendingSyncCount} clinical updates securely saved in local IndexedDB outbox.`
              : 'MediLink is running off cached hospital profiles.'} Live sync will resume automatically upon reconnection.
          </span>
        </div>
      )}
      <AnimatePresence>
        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={clearToast} />
        )}
      </AnimatePresence>
      <div
        className={`sidebar-overlay ${isMobileNavOpen ? 'visible' : ''}`}
        onClick={() => setIsMobileNavOpen(false)}
      />
      <Sidebar
        activeMode={activeMode}
        allowedModes={allowedModes}
        isOpen={isMobileNavOpen}
        setIsOpen={setIsMobileNavOpen}
        session={session}
      />
      <main className="main-wrapper">
        <Topbar
          activeMode={activeMode}
          setActiveMode={handleSetActiveMode}
          allowedModes={allowedModes}
          session={session}
          onSignOut={() => signOut({ callbackUrl: '/login' })}
          isMobileNavOpen={isMobileNavOpen}
          setIsMobileNavOpen={setIsMobileNavOpen}
        />
        <div className="content-area">
          <PageTransition mode={activeMode}>
            <ErrorBoundary onReset={() => window.location.reload()}>
              {modeComponents[activeMode]}
            </ErrorBoundary>
          </PageTransition>
        </div>
      </main>
    </div>
  );
}
