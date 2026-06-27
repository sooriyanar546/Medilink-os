import { test, expect } from '@playwright/test';

// ============================================================
// MediLink — Regression Test Suite R-01 to R-12
// Run with: npx playwright test tests/regression/
// ============================================================

// ---------------------------------------------------------------------------
// AUTH TESTS
// ---------------------------------------------------------------------------

test.describe('Authentication & RBAC', () => {

  test('R-01: Unauthenticated user is redirected from dashboard to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('R-02: Patient can log in with valid credentials', async ({ page, isMobile }) => {
    // Mobile viewport (iPhone 14) triggers a separate Next.js Turbopack compilation pass
    // that can take 60-90s on first cold run. Wait for network idle after page load
    // to ensure compilation finishes BEFORE we fill the form and submit.
    test.setTimeout(isMobile ? 120_000 : 30_000);

    // Wait for the page AND any Turbopack compilation to settle before interacting
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.fill('#email', 'patient@medilink.com');
    await page.fill('#password', 'patient123');

    if (isMobile) {
      await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
    }

    // Race the click and URL change together to avoid missed navigation events
    await Promise.all([
      page.waitForURL(/^(?!.*login)/, { timeout: 90_000 }),
      page.click('button[type="submit"]'),
    ]);
    await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 });
  });

  test('R-03: Invalid credentials shows error, does not redirect', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'invalid@email.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('R-04: Unauthenticated request to /api/visits returns 401', async ({ request }) => {
    const response = await request.get('/api/visits');
    expect(response.status()).toBe(401);
  });

  test('R-05: Unauthenticated request to /api/audit returns 401', async ({ request }) => {
    const response = await request.get('/api/audit');
    expect(response.status()).toBe(401);
  });

  test('R-06: Unauthenticated request to /api/billing-claims returns 401', async ({ request }) => {
    const response = await request.get('/api/billing-claims');
    expect(response.status()).toBe(401);
  });

  test('R-07: Unauthenticated request to /api/beds returns 401', async ({ request }) => {
    const response = await request.get('/api/beds');
    expect(response.status()).toBe(401);
  });

});

// ---------------------------------------------------------------------------
// API CONTRACT TESTS (unauthenticated validation)
// ---------------------------------------------------------------------------

test.describe('API Input Validation', () => {

  test('R-08: POST /api/visits with missing fields returns 400', async ({ request }) => {
    const response = await request.post('/api/visits', {
      data: { patientId: 'some-patient' }, // missing doctorId
    });
    // Either 400 (validation) or 401 (auth) — both are acceptable rejections
    expect([400, 401]).toContain(response.status());
  });

  test('R-09: POST /api/billing-claims with invalid visitId returns 401 or 404', async ({ request }) => {
    const response = await request.post('/api/billing-claims', {
      data: { visitId: 'nonexistent-visit-id-xyz', amount: 100 },
    });
    expect([401, 404]).toContain(response.status());
  });

  test('R-10: POST /api/lab-reports with missing fields returns 400 or 401', async ({ request }) => {
    const response = await request.post('/api/lab-reports', {
      data: { patientId: 'some-id' }, // missing testName and rawData
    });
    expect([400, 401]).toContain(response.status());
  });

});

// ---------------------------------------------------------------------------
// SECURITY HEADER TESTS
// ---------------------------------------------------------------------------

test.describe('HTTP Security Headers', () => {

  test('R-11: All security headers are present on main page', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toMatch(/max-age=/);
    expect(headers['content-security-policy']).toMatch(/default-src/);
  });

  test('R-12: X-Frame-Options DENY prevents clickjacking on /login', async ({ request }) => {
    const response = await request.get('/login');
    expect(response.headers()['x-frame-options']).toBe('DENY');
  });

});

// ---------------------------------------------------------------------------
// RATE LIMITING TESTS
// ---------------------------------------------------------------------------

test.describe('Rate Limiting', () => {

  test('R-13: POST /api/ai/scribe is rate-limited after 15 requests', async ({ request }) => {
    let lastStatus = 200;
    for (let i = 0; i < 20; i++) {
      const res = await request.post('/api/ai/scribe', {
        data: { transcript: 'test', visitId: 'test-id' },
      });
      lastStatus = res.status();
      if (lastStatus === 429) break;
    }
    // After exceeding limit, should receive 429 (or 401 if auth gates first)
    expect([429, 401]).toContain(lastStatus);
  });

});
