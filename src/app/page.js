'use client';

import React, { useState, useEffect } from 'react';
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
import { Loader2 } from 'lucide-react';

const modeComponents = {
  patient: <PatientMode />,
  doctor: <DoctorMode />,
  admin: <AdminMode />,
  nurse: <NurseMode />,
  pharmacist: <PharmacyMode />,
  cashier: <CashierMode />,
};

export default function DashboardContainer() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast, clearToast } = useHospitalStore();

  // Default mode from the logged-in user's role
  const [activeMode, setActiveMode] = useState('patient');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Service Worker Registration and Network Online/Offline Listeners
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('MediLink Service Worker registered with scope:', registration.scope);
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    if (typeof window !== 'undefined') {
      setIsOffline(!window.navigator.onLine);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Auto-set mode based on role when session loads
  useEffect(() => {
    if (session?.user?.role) {
      setActiveMode(session.user.role);
    }
  }, [session]);

  const handleSetActiveMode = (mode) => {
    setActiveMode(mode);
    setIsMobileNavOpen(false);
  };

  // Show loading screen while session is being determined
  if (status === 'loading' || status === 'unauthenticated') {
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

  return (
    <div className="app-container">
      {isOffline && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          backgroundColor: 'rgba(217, 119, 6, 0.92)',
          backdropFilter: 'blur(12px)',
          color: 'white',
          textAlign: 'center',
          padding: '10px 16px',
          fontSize: '13px',
          fontWeight: 600,
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <span>⚠️ Connection Lost: Offline Mode Active. MediLink is running off cached hospital profiles. Live sync will resume automatically.</span>
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
      <Sidebar activeMode={activeMode} isOpen={isMobileNavOpen} setIsOpen={setIsMobileNavOpen} />
      <main className="main-wrapper">
        <Topbar
          activeMode={activeMode}
          setActiveMode={handleSetActiveMode}
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
