'use client';

import React, { useState, useEffect } from 'react';
import { CreditCard, CheckCircle2, DollarSign, FileText, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CashierMode() {
  const [claims, setClaims] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(null);

  const fetchClaims = async () => {
    try {
      const res = await fetch('/api/billing-claims');
      const data = await res.json();
      setClaims(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchClaims();
    // In a real environment, we'd hook this to Pusher for real-time new invoices
    const interval = setInterval(fetchClaims, 10000);
    return () => clearInterval(interval);
  }, []);

  const processPayment = async (claimId) => {
    setIsProcessing(claimId);
    try {
      await fetch('/api/billing-claims/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId })
      });
      fetchClaims();
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(null);
    }
  };

  const unpaidCount = claims.filter(c => c.paymentStatus === 'UNPAID').length;
  const totalCollectedToday = claims.filter(c => c.paymentStatus === 'PAID').reduce((acc, curr) => acc + curr.amount, 0);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard size={24} color="var(--color-primary)" /> Billing & Insurance
          </h1>
          <p className="page-description">Process outgoing patient invoices and TPA approvals.</p>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-warning)' }}>{unpaidCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Unpaid Invoices</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-success)' }}>${totalCollectedToday.toLocaleString()}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Collected Today</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px', color: 'var(--color-text-muted)' }}>
          <Loader2 size={32} className="spin" />
        </div>
      ) : claims.length === 0 ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', color: 'var(--color-text-muted)' }}>
          <FileText size={48} opacity={0.2} style={{ marginBottom: '16px' }} />
          <div style={{ fontSize: '1.25rem', fontWeight: 500 }}>No Active Claims</div>
          <div style={{ fontSize: '0.875rem' }}>Waiting for doctors to complete consultations.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--space-6)' }}>
          <AnimatePresence>
            {claims.map((claim) => (
              <motion.div 
                key={claim.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card"
                style={{ 
                  borderTop: `4px solid ${claim.paymentStatus === 'PAID' ? 'var(--color-success)' : 'var(--color-warning)'}`,
                  opacity: claim.paymentStatus === 'PAID' ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-main)', margin: 0 }}>
                      {claim.visit?.patient?.name || 'Unknown Patient'}
                    </h3>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      Invoice #{claim.id.slice(-6).toUpperCase()}
                    </div>
                  </div>
                  <span className={`badge ${claim.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}`}>
                    {claim.paymentStatus}
                  </span>
                </div>

                <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Consultation Fee</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>$150.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>AI-Detected Medications</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>${(claim.amount - 150).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 600 }}>Total Balance</span>
                    <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-primary)' }}>${claim.amount.toLocaleString()}</span>
                  </div>
                </div>

                {claim.paymentStatus === 'UNPAID' ? (
                  <button 
                    onClick={() => processPayment(claim.id)} 
                    disabled={isProcessing === claim.id}
                    className="btn btn-primary" 
                    style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                  >
                    {isProcessing === claim.id ? <RefreshCw size={16} className="spin" /> : <DollarSign size={16} />}
                    Collect Payment
                  </button>
                ) : (
                  <button disabled className="btn" style={{ width: '100%', backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'not-allowed', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={16} /> Paid & Discharged
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
