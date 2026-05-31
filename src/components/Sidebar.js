'use client';

import React from 'react';
import { Activity, LayoutDashboard, Users, Stethoscope, MessageSquare, GitBranchPlus, BarChart3, Database, FileText, Lock } from 'lucide-react';

export default function Sidebar({ activeMode, isOpen }) {
  
  if (activeMode === 'patient') {
    return (
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-logo">
            <Activity />
            <span>Medi<span style={{ fontWeight: 300 }}>Link</span></span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">My Care</div>
            <a href="#" className="nav-item active"><LayoutDashboard size={18} /> My Journey</a>
            <a href="#" className="nav-item"><MessageSquare size={18} /> Hospital Messages</a>
            <a href="#" className="nav-item"><FileText size={18} /> Lab Reports</a>
          </div>
          <div className="nav-section">
            <div className="nav-section-title">Secure Vault</div>
            <a href="#" className="nav-item"><Lock size={18} /> Blockchain Locker</a>
          </div>
        </nav>
      </aside>
    );
  }

  if (activeMode === 'doctor') {
    return (
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-logo">
            <Activity />
            <span>Medi<span style={{ fontWeight: 300 }}>Link</span></span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Clinical Ops</div>
            <a href="#" className="nav-item active"><Users size={18} /> Live Queue</a>
            <a href="#" className="nav-item"><Stethoscope size={18} /> AI Scribe (Invisible Doc)</a>
            <a href="#" className="nav-item"><Database size={18} /> Patient History</a>
          </div>
        </nav>
      </aside>
    );
  }

  // Admin Mode (Default/Enterprise)
  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <div className="brand-logo">
          <Activity />
          <span>Medi<span style={{ fontWeight: 300 }}>Link</span></span>
        </div>
      </div>
      
      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">Core Operations</div>
          <a href="#" className="nav-item active"><LayoutDashboard size={18} /> Command Center</a>
          <a href="#" className="nav-item"><Users size={18} /> Staff & Tasks</a>
        </div>
        
        <div className="nav-section">
          <div className="nav-section-title">Intelligence & Revenue</div>
          <a href="#" className="nav-item"><GitBranchPlus size={18} /> Ops Intelligence (Twin)</a>
          <a href="#" className="nav-item"><BarChart3 size={18} /> Revenue Leakage</a>
        </div>
      </nav>
    </aside>
  );
}
