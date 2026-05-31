import { useEffect } from 'react';
import { useHospitalStore } from '@/store/useHospitalStore';

export function useHospitalQueue() {
  const { queue, isLoadingQueue, loadQueue, initializePusher } = useHospitalStore();

  useEffect(() => {
    const fetchQueueWithProfiling = async () => {
      const start = typeof window !== 'undefined' ? window.performance.now() : 0;
      try {
        await loadQueue();
      } finally {
        const end = typeof window !== 'undefined' ? window.performance.now() : 0;
        const duration = end - start;
        console.log(
          `%c[Perf Profiler] Live queue loaded in ${duration.toFixed(2)}ms`,
          'color: #0ea5e9; font-weight: bold; font-size: 11px;'
        );
      }
    };

    fetchQueueWithProfiling();
    initializePusher();
  }, [loadQueue, initializePusher]);

  return {
    queue,
    isLoadingQueue,
    loadQueue,
  };
}
