import { useEffect } from 'react';
import { useHospitalStore } from '@/store/useHospitalStore';

export function useOperationalMetrics() {
  const { adminMetrics, isLoadingMetrics, loadMetrics } = useHospitalStore();

  useEffect(() => {
    const fetchMetricsWithProfiling = async () => {
      const start = typeof window !== 'undefined' ? window.performance.now() : 0;
      try {
        await loadMetrics();
      } finally {
        const end = typeof window !== 'undefined' ? window.performance.now() : 0;
        const duration = end - start;
        console.log(
          `%c[Perf Profiler] Operational metrics loaded in ${duration.toFixed(2)}ms`,
          'color: #8b5cf6; font-weight: bold; font-size: 11px;'
        );
      }
    };

    fetchMetricsWithProfiling();
  }, [loadMetrics]);

  return {
    adminMetrics,
    isLoadingMetrics,
    loadMetrics,
  };
}
