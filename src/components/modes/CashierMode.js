'use client';

import React, { useState, useEffect } from 'react';
import { CreditCard, CheckCircle2, DollarSign, FileText, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHospitalStore } from '@/store/useHospitalStore';

export default function CashierMode() {
  const { showToast } = useHospitalStore();
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
      showToast("Settling claim with TPA and bank...", "info");
      const res = await fetch('/api/billing-claims/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId })
      });
      if (res.ok) {
        fetchClaims();
        showToast("Claim settled and paid successfully!", "success");
      } else {
        showToast("Failed to process payment.", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("Error processing payment.", "error");
    } finally {
      setIsProcessing(null);
    }
  };

  const handlePrintInvoice = (claim) => {
    const printWindow = window.open('', '_blank');
    const invoiceNum = claim.id.slice(-6).toUpperCase();
    const patientName = claim.visit?.patient?.name || 'Michael Chen';
    const amountVal = claim.amount;
    const printContent = `
      <html>
        <head>
          <title>Billing Receipt - Invoice #${invoiceNum}</title>
          <style>
            body { font-family: 'Inter', sans-serif; color: #1e293b; padding: 40px; line-height: 1.6; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #10b981; }
            .hospital-info { text-align: right; font-size: 12px; color: #64748b; }
            .title { text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; color: #0f766e; letter-spacing: 1px; }
            .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px; margin-bottom: 30px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; }
            .item-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            .item-table th { background: #f1f5f9; text-align: left; padding: 10px; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
            .item-table td { padding: 12px 10px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
            .item-table .right-align { text-align: right; }
            .total-section { float: right; width: 300px; margin-bottom: 40px; }
            .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
            .total-row.grand { border-top: 2px solid #10b981; font-weight: bold; font-size: 18px; color: #0f766e; padding-top: 12px; }
            .footer { clear: both; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 60px; }
            .status-badge { display: inline-block; padding: 4px 12px; border-radius: 50px; font-weight: bold; font-size: 12px; text-transform: uppercase; }
            .status-paid { background: #d1fae5; color: #065f46; }
            .status-unpaid { background: #fef3c7; color: #92400e; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="logo">MEDILINK HOSOPOS</div>
              <div style="font-size: 12px; color: #64748b;">Hospital Operations Billing Suite</div>
            </div>
            <div class="hospital-info">
              <strong>Receipt No:</strong> REC-${invoiceNum}<br/>
              <strong>Date:</strong> ${new Date().toLocaleDateString()}<br/>
              <strong>TPA Insurance Network:</strong> ${claim.tpaName || 'National Health Insurance'}
            </div>
          </div>

          <div class="title">Official Inpatient / Outpatient Receipt</div>

          <div class="details-grid">
            <div><strong>Patient Name:</strong> ${patientName}</div>
            <div><strong>Identity Ref (ABHA):</strong> ABHA-M-9021-X-442A</div>
            <div><strong>Billing Status:</strong> <span class="status-badge ${claim.paymentStatus === 'PAID' ? 'status-paid' : 'status-unpaid'}">${claim.paymentStatus}</span></div>
            <div><strong>Department:</strong> OPD Cardiology Care</div>
          </div>

          <table class="item-table">
            <thead>
              <tr>
                <th>Service / Item Description</th>
                <th>Standard Code (ICD-10/RxNorm)</th>
                <th class="right-align">Unit Price</th>
                <th class="right-align">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Consultation Fee (Dr. Sarah Jenkins)</strong></td>
                <td>ICD-10: I10 (Hypertension)</td>
                <td class="right-align">$150.00</td>
                <td class="right-align">$150.00</td>
              </tr>
              <tr>
                <td><strong>Medication Bundle (Amlodipine 5mg, Paracetamol)</strong></td>
                <td>RxNorm: 197361, RxNorm: 322238</td>
                <td class="right-align">$${(amountVal - 150).toFixed(2)}</td>
                <td class="right-align">$${(amountVal - 150).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <div class="total-section">
            <div class="total-row">
              <span>Gross Claim Amount:</span>
              <span>$${amountVal.toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>TPA Insurance Approved (80%):</span>
              <span>-$${(amountVal * 0.8).toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>Patient Copay Contribution (20%):</span>
              <span>$${(amountVal * 0.2).toFixed(2)}</span>
            </div>
            <div class="total-row grand">
              <span>Total Paid:</span>
              <span>$${claim.paymentStatus === 'PAID' ? `$${(amountVal * 0.2).toFixed(2)}` : '$0.00'}</span>
            </div>
          </div>

          <div class="footer">
            Thank you for choosing MediLink Care. For any insurance claims queries, please contact billing@medilink.com.<br/>
            ||||| | |||| ||| || |||||| | ||| ||||<br/>
            SECURED HIPAA COMPLIANT BARCODE TRANSACTION REGISTERED
          </div>

          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(printContent);
    printWindow.document.close();
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
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => processPayment(claim.id)} 
                      disabled={isProcessing === claim.id}
                      className="btn btn-primary" 
                      style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                    >
                      {isProcessing === claim.id ? <RefreshCw size={16} className="spin" /> : <DollarSign size={16} />}
                      Collect Payment
                    </button>
                    <button 
                      onClick={() => handlePrintInvoice(claim)}
                      className="btn btn-outline" 
                      style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}
                      title="Print Pre-authorization Invoice"
                    >
                      <FileText size={16} /> Print
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button disabled className="btn" style={{ flex: 1, backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', cursor: 'not-allowed', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle2 size={16} /> Paid & Discharged
                    </button>
                    <button 
                      onClick={() => handlePrintInvoice(claim)}
                      className="btn btn-outline" 
                      style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '4px', borderColor: '#10b981', color: '#10b981' }}
                      title="Print Official Payment Receipt"
                    >
                      <FileText size={16} /> Print
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
