/**
 * POST /api/auth/signup
 *
 * Creates a new Patient user account atomically:
 *   1. Validate input + check for duplicate email/phone
 *   2. Hash password with bcrypt (12 rounds)
 *   3. Create User (role: PATIENT) + Patient record in one transaction
 *   4. Return safe user object (no password hash)
 *
 * Rate limit: 5 signups per IP per hour (prevents account farming)
 * No authentication required (public endpoint)
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit';

export async function POST(request) {
  // ─── Rate Limit ──────────────────────────────────────────────
  const rl = checkRateLimit(request, { limit: 5, windowMs: 60 * 60 * 1000, prefix: 'signup' });
  if (!rl.allowed) return rateLimitExceededResponse(rl.resetAt);

  try {
    const body = await request.json();
    const { name, email, phone, password, dob, bloodGroup } = body;

    // ─── Input Validation ─────────────────────────────────────
    if (!name || !email || !password || !phone) {
      return NextResponse.json(
        { error: 'name, email, phone, and password are required.' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long.' },
        { status: 422 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 422 });
    }

    // ─── Hash Password ───────────────────────────────────────
    // 12 rounds = ~400ms on a modern server (OWASP 2024 recommendation)
    const hashedPassword = await bcrypt.hash(password, 12);

    // ─── Atomic Transaction ───────────────────────────────────
    // Create User + Patient together so neither exists without the other.
    const result = await prisma.$transaction(async (tx) => {
      // Check for existing email
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        throw Object.assign(new Error('Email already registered'), { code: 'DUPLICATE_EMAIL' });
      }

      // Check for existing phone number
      const existingPatient = await tx.patient.findUnique({ where: { phone } });
      if (existingPatient) {
        throw Object.assign(new Error('Phone number already registered'), { code: 'DUPLICATE_PHONE' });
      }

      // Create Patient profile first
      const patient = await tx.patient.create({
        data: {
          name,
          phone,
          email,
          dob: dob ? new Date(dob) : new Date('1990-01-01'), // Default DOB if not provided
          bloodGroup: bloodGroup || null,
        },
      });

      // Create User account linked to the Patient profile
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: 'PATIENT',             // Default role — cannot be escalated via signup
          patientId: patient.id,
        },
      });

      return { user, patient };
    });

    // Return safe user object (no password hash, no internal IDs beyond what's needed)
    return NextResponse.json(
      {
        success: true,
        message: 'Account created successfully. Please sign in.',
        user: {
          id:        result.user.id,
          name:      result.user.name,
          email:     result.user.email,
          role:      result.user.role,
          patientId: result.user.patientId,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error.code === 'DUPLICATE_EMAIL') {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }
    if (error.code === 'DUPLICATE_PHONE') {
      return NextResponse.json({ error: 'An account with this phone number already exists.' }, { status: 409 });
    }
    // Prisma unique constraint (backup check)
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'This email or phone is already registered.' }, { status: 409 });
    }
    console.error('POST /api/auth/signup error:', error);
    return NextResponse.json({ error: 'Failed to create account. Please try again.' }, { status: 500 });
  }
}
