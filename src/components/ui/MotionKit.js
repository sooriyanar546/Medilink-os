'use client';
// Central animation components for MediLink
// All motion primitives live here to maintain consistency

import { motion, AnimatePresence } from 'framer-motion';

// ----------------------------------------------------------------
// SHARED ANIMATION VARIANTS
// ----------------------------------------------------------------

export const fadeInUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const fadeInScale = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
};

export const slideInLeft = {
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
};

export const slideInRight = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 8 },
};

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

export const transitions = {
  spring: { type: 'spring', stiffness: 400, damping: 30 },
  springBounce: { type: 'spring', stiffness: 500, damping: 28 },
  ease: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
  slow: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
};

// ----------------------------------------------------------------
// PAGE TRANSITION — wraps mode content (Patient/Doctor/Admin)
// ----------------------------------------------------------------
export function PageTransition({ children, mode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -8, filter: 'blur(2px)' }}
        transition={transitions.slow}
        style={{ height: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ----------------------------------------------------------------
// ANIMATED CARD — staggered entrance for dashboard cards
// ----------------------------------------------------------------
export function AnimatedCard({ children, delay = 0, className = '', style = {} }) {
  return (
    <motion.div
      className={`card ${className}`}
      style={style}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        ...transitions.spring,
        delay,
      }}
      whileHover={{
        y: -2,
        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08), 0 4px 8px rgba(15, 23, 42, 0.04)',
        transition: { duration: 0.2 },
      }}
    >
      {children}
    </motion.div>
  );
}

// ----------------------------------------------------------------
// ANIMATED STAT CARD — with number counting effect
// ----------------------------------------------------------------
export function StatCard({ label, value, trend, icon, color = 'primary', delay = 0 }) {
  const colorMap = {
    primary: { bg: '#dbeafe', text: '#1e40af', border: 'rgba(30,64,175,0.15)' },
    success: { bg: '#d1fae5', text: '#059669', border: 'rgba(5,150,105,0.15)' },
    warning: { bg: '#fef3c7', text: '#d97706', border: 'rgba(217,119,6,0.15)' },
    danger: { bg: '#fee2e2', text: '#dc2626', border: 'rgba(220,38,38,0.15)' },
  };
  const c = colorMap[color] || colorMap.primary;

  return (
    <motion.div
      className="card"
      style={{ borderTop: `3px solid ${c.text}`, padding: 'var(--space-4)' }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transitions.spring, delay }}
      whileHover={{
        y: -3,
        boxShadow: '0 16px 32px rgba(15, 23, 42, 0.1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="stat-label">{label}</div>
          <motion.div
            className="stat-value"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transitions.spring, delay: delay + 0.1 }}
          >
            {value}
          </motion.div>
          {trend && (
            <div className={`stat-trend ${trend.direction}`}>
              {trend.label}
            </div>
          )}
        </div>
        {icon && (
          <motion.div
            style={{
              width: 40, height: 40,
              backgroundColor: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: c.text,
            }}
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...transitions.springBounce, delay: delay + 0.15 }}
          >
            {icon}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------
// ANIMATED LIST ITEM — for queue items (slides + fades on enter/exit)
// ----------------------------------------------------------------
export function AnimatedQueueItem({ children, id }) {
  return (
    <motion.div
      key={id}
      layout
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, height: 0, overflow: 'hidden' }}
      transition={transitions.spring}
    >
      {children}
    </motion.div>
  );
}

// ----------------------------------------------------------------
// LIVE PULSE DOT — ambient listening / live status indicator
// ----------------------------------------------------------------
export function PulseDot({ color = '#10b981', size = 8 }) {
  return (
    <div style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      <motion.div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          backgroundColor: color,
          opacity: 0.5,
        }}
        animate={{ scale: [1, 2.2, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        backgroundColor: color,
        position: 'relative',
        zIndex: 1,
      }} />
    </div>
  );
}

// ----------------------------------------------------------------
// STAGGER GROUP — wraps children with staggered entrance
// ----------------------------------------------------------------
export function StaggerGroup({ children, className = '', style = {} }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {children}
    </motion.div>
  );
}

// ----------------------------------------------------------------
// ANIMATED BADGE — pops in with a spring
// ----------------------------------------------------------------
export function AnimatedBadge({ children, className = '' }) {
  return (
    <motion.span
      className={`badge ${className}`}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={transitions.springBounce}
    >
      {children}
    </motion.span>
  );
}

// ----------------------------------------------------------------
// COUNTER — animated number counter
// ----------------------------------------------------------------
export function AnimatedCounter({ value, prefix = '', suffix = '' }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={value}
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -12, opacity: 0 }}
        transition={{ ...transitions.spring }}
        style={{ display: 'inline-block' }}
      >
        {prefix}{value}{suffix}
      </motion.span>
    </AnimatePresence>
  );
}
