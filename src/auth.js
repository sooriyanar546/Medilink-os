// src/auth.js — NextAuth v5 configuration
// Uses Credentials provider for role-based login (Patient / Doctor / Admin)

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      name: 'MediLink Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        });

        if (!user || !user.password) return null;

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);

        if (!isPasswordValid) return null;

        // Return the user object that gets encoded into the JWT
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role.toLowerCase(), // Ensure 'patient', 'doctor', 'admin' casing
          department: user.department,
          patientId: user.patientId,
          doctorId: user.doctorId,
        };
      },
    }),
  ],
});
