'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, User, HeartPulse, ShieldAlert, Eye, EyeOff,
  Loader2, UserPlus, LogIn, CheckCircle2,
} from 'lucide-react';

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

const inputStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid #e2e8f0', borderRadius: 8,
  fontSize: '0.9375rem', fontFamily: 'inherit', outline: 'none',
  transition: 'border-color 0.15s', color: '#0f172a',
  boxSizing: 'border-box', background: 'white',
};

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState('login');            // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);

  // Signup-specific state
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupDob, setSignupDob] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const fillDemo = (demo) => {
    setSelectedRole(demo.role);
    setEmail(demo.email);
    setPassword(demo.password);
    setError('');
  };

  // ─── Login Handler ────────────────────────────────────────────
  const handleLogin = async (e) => {
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

  // ─── Signup Handler ───────────────────────────────────────────
  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signupName,
          email: signupEmail,
          phone: signupPhone,
          password: signupPassword,
          dob: signupDob || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Signup failed. Please try again.');
        setLoading(false);
        return;
      }

      // Account created — auto-sign in
      setSignupSuccess(true);
      setTimeout(async () => {
        const result = await signIn('credentials', {
          email: signupEmail,
          password: signupPassword,
          redirect: false,
        });
        if (result?.error) {
          // Fallback: redirect to login tab to sign in manually
          setTab('login');
          setEmail(signupEmail);
          setPassword('');
          setLoading(false);
        } else {
          router.push('/');
          router.refresh();
        }
      }, 1500);
    } catch {
      setError('Connection error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f766e 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', fontFamily: 'Inter, -apple-system, sans-serif',
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

        {/* Right — Auth Card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
          style={{
            width: 400, background: 'rgba(255,255,255,0.97)',
            borderRadius: 20, padding: '2rem',
            boxShadow: '0 32px 64px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          {/* Tab switcher */}
          <div style={{
            display: 'flex', background: '#f1f5f9', borderRadius: 10,
            padding: 4, marginBottom: '1.5rem', gap: 4,
          }}>
            {[
              { id: 'login',  label: 'Sign In',  icon: LogIn    },
              { id: 'signup', label: 'Register',  icon: UserPlus },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setTab(id); setError(''); }}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                  fontSize: '0.875rem', fontWeight: 600, fontFamily: 'inherit',
                  background: tab === id ? 'white' : 'transparent',
                  color: tab === id ? '#0f172a' : '#94a3b8',
                  boxShadow: tab === id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* ─── LOGIN TAB ────────────────────────────────── */}
            {tab === 'login' && (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem', letterSpacing: '-0.02em' }}>
                  Sign in to MediLink
                </h2>
                <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
                  Use a demo account to explore the platform
                </p>

                {/* Demo Role Selectors */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.25rem' }}>
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
                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Email</label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter email..."
                      required
                      style={inputStyle}
                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password..."
                        required
                        style={{ ...inputStyle, paddingRight: 40 }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
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
                        style={{ padding: '8px 12px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, fontSize: '0.8125rem', color: '#dc2626' }}
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
                      background: loading ? '#94a3b8' : 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
                      color: 'white', border: 'none', borderRadius: 10,
                      fontSize: '0.9375rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      marginTop: 4, boxShadow: loading ? 'none' : '0 4px 16px rgba(30,64,175,0.3)',
                    }}
                  >
                    {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in...</> : 'Sign In to MediLink'}
                  </motion.button>
                </form>
              </motion.div>
            )}

            {/* ─── SIGNUP TAB ───────────────────────────────── */}
            {tab === 'signup' && (
              <motion.div
                key="signup"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                {signupSuccess ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    style={{ textAlign: 'center', padding: '2rem 1rem' }}
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <CheckCircle2 size={48} color="#059669" style={{ margin: '0 auto 1rem' }} />
                    </motion.div>
                    <h3 style={{ color: '#059669', fontSize: '1.125rem', fontWeight: 700, marginBottom: 8 }}>
                      Account Created!
                    </h3>
                    <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                      Signing you in automatically...
                    </p>
                    <Loader2 size={20} color="#059669" style={{ animation: 'spin 1s linear infinite', marginTop: 16 }} />
                  </motion.div>
                ) : (
                  <>
                    <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem', letterSpacing: '-0.02em' }}>
                      Create Patient Account
                    </h2>
                    <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
                      Register as a patient to access your health records
                    </p>

                    <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { id: 'reg-name',     label: 'Full Name',      type: 'text',     value: signupName,     setter: setSignupName,     placeholder: 'Your full name', required: true  },
                        { id: 'reg-email',    label: 'Email Address',  type: 'email',    value: signupEmail,    setter: setSignupEmail,    placeholder: 'you@example.com', required: true },
                        { id: 'reg-phone',    label: 'Phone Number',   type: 'tel',      value: signupPhone,    setter: setSignupPhone,    placeholder: '+91 98765 43210', required: true },
                        { id: 'reg-dob',      label: 'Date of Birth',  type: 'date',     value: signupDob,      setter: setSignupDob,      placeholder: '', required: false },
                      ].map(({ id, label, type, value, setter, placeholder, required }) => (
                        <div key={id}>
                          <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                            {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
                          </label>
                          <input
                            id={id}
                            type={type}
                            value={value}
                            onChange={(e) => setter(e.target.value)}
                            placeholder={placeholder}
                            required={required}
                            style={inputStyle}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                          />
                        </div>
                      ))}

                      <div>
                        <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                          Password <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            id="reg-password"
                            type={showSignupPassword ? 'text' : 'password'}
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            placeholder="Min. 8 characters"
                            required
                            minLength={8}
                            style={{ ...inputStyle, paddingRight: 40 }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                          />
                          <button type="button" onClick={() => setShowSignupPassword(!showSignupPassword)}
                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                            {showSignupPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -4, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            style={{ padding: '8px 12px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, fontSize: '0.8125rem', color: '#dc2626' }}
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
                          background: loading ? '#94a3b8' : 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                          color: 'white', border: 'none', borderRadius: 10,
                          fontSize: '0.9375rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          marginTop: 4, boxShadow: loading ? 'none' : '0 4px 16px rgba(5,150,105,0.3)',
                        }}
                      >
                        {loading
                          ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating account...</>
                          : <><UserPlus size={16} /> Create Patient Account</>
                        }
                      </motion.button>

                      <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
                        Accounts are created as <strong>Patient</strong> role only.
                        Staff accounts are provisioned by administrators.
                      </p>
                    </form>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', marginTop: '1rem' }}>
            Demo platform · Not for clinical use
          </p>
        </motion.div>
      </div>
    </div>
  );
}
