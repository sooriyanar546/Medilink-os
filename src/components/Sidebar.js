'use client';

import React from 'react';
import {
  Activity, LayoutDashboard, Users, Stethoscope, MessageSquare,
  GitBranchPlus, BarChart3, Database, FileText, Lock, Heart,
  Pill, DollarSign, BedDouble, ShieldCheck,
} from 'lucide-react';

// Nav item definitions keyed by role mode.
// Each role ONLY sees its own section — items from other roles
// are NEVER rendered in the DOM for the current user.
const NAV_CONFIG = {
  patient: {
    brand: 'My Health',
    sections: [
      {
        title: 'My Care',
        items: [
          { icon: LayoutDashboard, label: 'My Journey' },
          { icon: Heart,           label: 'Vital Tracker' },
          { icon: MessageSquare,   label: 'Hospital Messages' },
          { icon: FileText,        label: 'Lab Reports' },
        ],
      },
      {
        title: 'Secure Vault',
        items: [
          { icon: Lock,       label: 'Blockchain Locker' },
          { icon: ShieldCheck, label: 'My Consents' },
        ],
      },
    ],
  },

  doctor: {
    brand: 'Clinical Ops',
    sections: [
      {
        title: 'Clinical Ops',
        items: [
          { icon: Users,        label: 'Live Queue' },
          { icon: Stethoscope,  label: 'AI Scribe' },
          { icon: Database,     label: 'Patient History' },
          { icon: FileText,     label: 'Lab Results' },
        ],
      },
    ],
  },

  admin: {
    brand: 'Command Center',
    sections: [
      {
        title: 'Core Operations',
        items: [
          { icon: LayoutDashboard, label: 'Command Center' },
          { icon: Users,           label: 'Staff & Tasks' },
          { icon: BedDouble,       label: 'Ward Management' },
        ],
      },
      {
        title: 'Intelligence & Revenue',
        items: [
          { icon: GitBranchPlus, label: 'Ops Intelligence' },
          { icon: BarChart3,     label: 'Revenue Leakage' },
        ],
      },
    ],
  },

  nurse: {
    brand: 'Nursing Ops',
    sections: [
      {
        title: 'Patient Care',
        items: [
          { icon: Users,        label: 'Patient Queue' },
          { icon: Heart,        label: 'Vitals Entry' },
          { icon: BedDouble,    label: 'Bed Status' },
        ],
      },
    ],
  },

  pharmacist: {
    brand: 'Pharmacy',
    sections: [
      {
        title: 'Dispensing',
        items: [
          { icon: Pill,      label: 'Prescription Queue' },
          { icon: Database,  label: 'Drug Inventory' },
        ],
      },
    ],
  },

  cashier: {
    brand: 'Billing',
    sections: [
      {
        title: 'Finance',
        items: [
          { icon: DollarSign, label: 'Billing Dashboard' },
          { icon: FileText,   label: 'Claims Manager' },
        ],
      },
    ],
  },
};

/**
 * Sidebar component.
 *
 * @param {string}   activeMode   - Currently active mode
 * @param {string[]} allowedModes - Modes this user's role is permitted to see (from page.js)
 * @param {boolean}  isOpen       - Mobile nav open state
 * @param {Function} setIsOpen    - Mobile nav toggle
 * @param {object}   session      - NextAuth session (for user display)
 */
export default function Sidebar({ activeMode, allowedModes = [], isOpen, setIsOpen, session }) {
  // Derive the nav config for the current user's role.
  // If allowedModes is empty or the mode is unrecognized, render nothing sensitive.
  const primaryMode = allowedModes[0] || activeMode;
  const config = NAV_CONFIG[primaryMode];

  if (!config) {
    // Unknown role — render minimal brand sidebar with no navigation
    return (
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-logo">
            <Activity />
            <span>Medi<span style={{ fontWeight: 300 }}>Link</span></span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <div className="brand-logo">
          <Activity />
          <span>Medi<span style={{ fontWeight: 300 }}>Link</span></span>
        </div>
      </div>

      {/* Role-specific navigation — never renders items from other roles */}
      <nav className="sidebar-nav">
        {config.sections.map((section) => (
          <div key={section.title} className="nav-section">
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.label}
                  href="#"
                  className="nav-item"
                  onClick={(e) => { e.preventDefault(); setIsOpen?.(false); }}
                >
                  <Icon size={18} />
                  {item.label}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User info footer */}
      {session?.user && (
        <div style={{
          padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: 'auto', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)',
        }}>
          <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>
            {session.user.name}
          </div>
          <div style={{ textTransform: 'capitalize' }}>
            {session.user.role?.toLowerCase()} · MediLink
          </div>
        </div>
      )}
    </aside>
  );
}
