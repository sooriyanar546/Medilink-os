'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, ShieldAlert, X } from 'lucide-react';

const toastConfig = {
  success: {
    bg: 'rgba(240, 253, 244, 0.9)',
    border: '1px solid #bbf7d0',
    color: '#15803d',
    icon: CheckCircle2,
    shadow: '0 10px 25px -5px rgba(22, 163, 74, 0.1), 0 8px 10px -6px rgba(22, 163, 74, 0.05)',
  },
  error: {
    bg: 'rgba(254, 242, 242, 0.9)',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    icon: AlertCircle,
    shadow: '0 10px 25px -5px rgba(220, 38, 38, 0.1), 0 8px 10px -6px rgba(220, 38, 38, 0.05)',
  },
  warning: {
    bg: 'rgba(255, 251, 235, 0.9)',
    border: '1px solid #fde68a',
    color: '#b45309',
    icon: ShieldAlert,
    shadow: '0 10px 25px -5px rgba(217, 119, 6, 0.1), 0 8px 10px -6px rgba(217, 119, 6, 0.05)',
  },
  info: {
    bg: 'rgba(240, 249, 255, 0.9)',
    border: '1px solid #bae6fd',
    color: '#0369a1',
    icon: Info,
    shadow: '0 10px 25px -5px rgba(2, 132, 199, 0.1), 0 8px 10px -6px rgba(2, 132, 199, 0.05)',
  },
};

export default function Toast({ message, type = 'success', onClose }) {
  const config = toastConfig[type] || toastConfig.success;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.9, x: 20 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -10, transition: { duration: 0.15 } }}
      style={{
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 20px',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: config.bg,
        border: config.border,
        color: config.color,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: config.shadow,
        fontFamily: 'var(--font-family)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 600,
        maxWidth: '380px',
      }}
    >
      <Icon size={18} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, lineHeight: 1.4 }}>{message}</span>
      <button
        onClick={onClose}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'inherit',
          opacity: 0.6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2px',
          borderRadius: '4px',
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
      >
        <X size={15} />
      </button>
    </motion.div>
  );
}
