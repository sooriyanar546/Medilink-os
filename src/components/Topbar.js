'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Bell, Settings, User, HeartPulse, ShieldAlert, LogOut } from 'lucide-react';
import { PulseDot } from '@/components/ui/MotionKit';

const modes = [
  { id: 'patient', label: 'Patient', icon: User, color: '#0284c7' },
  { id: 'doctor', label: 'Doctor', icon: HeartPulse, color: '#059669' },
  { id: 'admin', label: 'Admin', icon: ShieldAlert, color: '#7c3aed' },
];

const avatarGradients = {
  patient: 'linear-gradient(135deg, #0284c7, #38bdf8)',
  doctor: 'linear-gradient(135deg, #059669, #34d399)',
  admin: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
};

export default function Topbar({ activeMode, setActiveMode, session, onSignOut }) {
  const role = session?.user?.role || activeMode;
  const userName = session?.user?.name || 'Guest';
  const userDept = session?.user?.department || '';
  const userInitials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <header className="topbar">

      {/* Premium Mode Toggle */}
      <div style={{
        display: 'flex',
        gap: '3px',
        backgroundColor: 'var(--color-background)',
        padding: '4px',
        borderRadius: 'var(--radius-xl)',
        border: 'var(--border-light)',
        position: 'relative',
      }}>
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeMode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: 'var(--radius-lg)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? mode.color : 'var(--color-text-muted)',
                background: 'transparent',
                transition: 'color 0.2s ease',
                zIndex: 1,
              }}
            >
              {/* Sliding pill background */}
              {isActive && (
                <motion.div
                  layoutId="activeModePill"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'var(--color-surface)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <Icon size={15} style={{ position: 'relative', zIndex: 1 }} />
              <span style={{ position: 'relative', zIndex: 1 }}>{mode.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="topbar-search" style={{ marginLeft: 'var(--space-6)', flex: 1, maxWidth: 320 }}>
        <Search size={15} color="var(--color-text-subtle)" />
        <input type="text" placeholder="Search patients, tasks, operations..." />
      </div>

      {/* Right Actions */}
      <div className="topbar-actions" style={{ marginLeft: 'auto' }}>

        {/* Live System Status */}
        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #a7f3d0',
            borderRadius: 'var(--radius-full)',
            marginRight: 'var(--space-2)',
          }}
        >
          <PulseDot color="#10b981" size={7} />
          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: '#059669' }}>
            All Systems Live
          </span>
        </motion.div>

        <button className="icon-btn">
          <Bell size={18} />
        </button>
        <button className="icon-btn">
          <Settings size={18} />
        </button>

        {/* Animated User Profile */}
        <AnimatePresence mode="wait">
          <motion.div
            key={userName}
            className="user-profile"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            style={{ marginLeft: 'var(--space-2)', borderLeft: 'var(--border-light)', paddingLeft: 'var(--space-4)' }}
          >
            <motion.div
              className="avatar"
              style={{ background: avatarGradients[role] || avatarGradients.patient }}
              layoutId="userAvatar"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              {userInitials}
            </motion.div>
            <div className="user-info">
              <span className="user-name">{userName}</span>
              <span className="user-role">{userDept}</span>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Sign Out */}
        {onSignOut && (
          <motion.button
            className="icon-btn"
            onClick={onSignOut}
            title="Sign out"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ marginLeft: 4, color: 'var(--color-text-muted)' }}
          >
            <LogOut size={17} />
          </motion.button>
        )}
      </div>

    </header>
  );
}
