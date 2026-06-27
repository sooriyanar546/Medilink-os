'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, User, HeartPulse, ShieldAlert, Eye, EyeOff, Loader2 } from 'lucide-react';

const DEMO_ROLES = [
  {
    role: 'patient',
    label: 'Patient',
    icon: User,
    email: 'patient@medilink.com',
    password: 'patient123',
    color: '#0284c7',
    bg: '#e0f2fe',
    description: 'View your journey, reports & messages',
  },
  {
    role: 'doctor',
    label: 'Doctor',
    icon: HeartPulse,
    email: 'doctor@medilink.com',
    password: 'doctor123',
    color: '#059669',
    bg: '#d1fae5',
    description: 'AI Scribe, live queue & patient context',
  },
  {
    role: 'admin',
    label: 'Admin',
    icon: ShieldAlert,
    email: 'admin@medilink.com',
    password: 'admin123',
    color: '#7c3aed',
    bg: '#ede9fe',
    description: 'Command center & operational intelligence',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);

  const fillDemo = (demo) => {
    setSelectedRole(demo.role);
    setEmail(demo.email);
    setPassword(demo.password);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid credentials. Try a demo account below.');
        setLoading(false);
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f766e 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: 'Inter, -apple-system, sans-serif',
    }}>

      {/* Ambient background blobs */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', top: '-10%', right: '-5%',
            width: 500, height: 500, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
          }}
        />
        <motion.div
          animate={{ x: [0, -20, 0], y: [0, 30, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', bottom: '-10%', left: '-5%',
            width: 600, height: 600, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(15,118,110,0.15) 0%, transparent 70%)',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '3rem', alignItems: 'center', maxWidth: 960, width: '100%', position: 'relative' }}>

        {/* Left — Branding */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          style={{ flex: 1, color: 'white' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '2rem' }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 24px rgba(59,130,246,0.4)',
            }}>
              <Activity size={24} color="white" />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>MediLink</span>
          </div>

          <h1 style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: '1rem' }}>
            The Operating System<br />for Modern Hospitals
          </h1>
          <p style={{ fontSize: '1.0625rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, marginBottom: '2rem' }}>
            Operational calm. Predictive intelligence.<br />
            Invisible coordination for patients, doctors, and administrators.
          </p>

          {/* Stats */}
          <div style={{ display: 'flex', gap: '2rem' }}>
            {[
              { value: '248', label: 'Patients today' },
              { value: '18m', label: 'Avg wait time' },
              { value: '92', label: 'Experience score' },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#60a5fa' }}>{stat.value}</div>
                <div style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.45)' }}>{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Right — Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
          style={{
            width: 400,
            background: 'rgba(255,255,255,0.97)',
            borderRadius: 20,
            padding: '2rem',
            boxShadow: '0 32px 64px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem', letterSpacing: '-0.02em' }}>
            Sign in to MediLink
          </h2>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            Use a demo account to explore the platform
          </p>

          {/* Demo Role Selectors */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginBottom: 4 }}>
              Quick Demo Access
            </p>
            {DEMO_ROLES.map((demo) => {
              const Icon = demo.icon;
              const isSelected = selectedRole === demo.role;
              return (
                <motion.button
                  key={demo.role}
                  onClick={() => fillDemo(demo)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 10,
                    border: `1.5px solid ${isSelected ? demo.color : '#e2e8f0'}`,
                    background: isSelected ? demo.bg : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: isSelected ? demo.color : '#f1f5f9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'all 0.15s ease',
                  }}>
                    <Icon size={16} color={isSelected ? 'white' : '#64748b'} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: isSelected ? demo.color : '#334155' }}>
                      {demo.label}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{demo.description}</div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email..."
                required
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  fontSize: '0.9375rem', fontFamily: 'inherit', outline: 'none',
                  transition: 'border-color 0.15s', color: '#0f172a',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password..."
                  required
                  style={{
                    width: '100%', padding: '10px 40px 10px 12px',
                    border: '1px solid #e2e8f0', borderRadius: 8,
                    fontSize: '0.9375rem', fontFamily: 'inherit', outline: 'none',
                    color: '#0f172a', boxSizing: 'border-box',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{
                    padding: '8px 12px', background: '#fee2e2',
                    border: '1px solid #fecaca', borderRadius: 8,
                    fontSize: '0.8125rem', color: '#dc2626',
                  }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.01 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
              style={{
                width: '100%', padding: '11px',
                background: loading
                  ? '#94a3b8'
                  : 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
                color: 'white', border: 'none', borderRadius: 10,
                fontSize: '0.9375rem', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginTop: 4, boxShadow: loading ? 'none' : '0 4px 16px rgba(30,64,175,0.3)',
                transition: 'background 0.2s',
              }}
            >
              {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in...</> : 'Sign In to MediLink'}
            </motion.button>
          </form>

          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', marginTop: '1rem' }}>
            Demo platform · Not for clinical use
          </p>
        </motion.div>
      </div>
    </div>
  );
}
