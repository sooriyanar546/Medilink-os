import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * GET /api/health
 * Docker healthcheck endpoint — verifies app + DB connectivity.
 * Returns 200 if healthy, 503 if DB is unreachable.
 * Does NOT require authentication (intentionally — healthchecks must work before auth).
 */
export async function GET() {
  const start = Date.now();
  try {
    // Lightweight DB ping — single-row query on the smallest table
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;

    return NextResponse.json({
      status: 'healthy',
      service: 'medilink-clinical-platform',
      version: process.env.npm_package_version || '1.0.0',
      db: 'connected',
      dbLatencyMs: latencyMs,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Health] DB connectivity check failed:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'medilink-clinical-platform',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
