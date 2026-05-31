export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startScheduler } = await import('./lib/scheduler');
      await startScheduler();
    } catch (err) {
      console.error('❌ Failed to boot Background Task Scheduler in instrumentation:', err);
    }
  }
}
