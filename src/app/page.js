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
import { PageTransition } from '@/components/ui/MotionKit';
import { Loader2 } from 'lucide-react';

const modeComponents = {
  patient: <PatientMode />,
  doctor: <DoctorMode />,
  admin: <AdminMode />,
  nurse: <NurseMode />,
  pharmacist: <PharmacyMode />,
};

export default function DashboardContainer() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Default mode from the logged-in user's role
  const [activeMode, setActiveMode] = useState('patient');

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
      <Sidebar activeMode={activeMode} />
      <main className="main-wrapper">
        <Topbar
          activeMode={activeMode}
          setActiveMode={setActiveMode}
          session={session}
          onSignOut={() => signOut({ callbackUrl: '/login' })}
        />
        <div className="content-area">
          <PageTransition mode={activeMode}>
            {modeComponents[activeMode]}
          </PageTransition>
        </div>
      </main>
    </div>
  );
}
