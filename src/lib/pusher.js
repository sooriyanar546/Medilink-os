import PusherServer from 'pusher';
import PusherClient from 'pusher-js';

// Server-side Pusher instance
export const pusherServer = process.env.PUSHER_APP_ID 
  ? new PusherServer({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER || 'us2',
      useTLS: true,
    })
  : {
      // Dummy stub if keys are missing
      trigger: async () => console.log('Pusher keys missing. Trigger simulated.'),
    };

// Client-side Pusher instance
export const getPusherClient = () => {
  if (typeof window === 'undefined') return null; // Don't run on server
  
  if (!process.env.NEXT_PUBLIC_PUSHER_KEY) {
    console.warn("Pusher keys missing. Polling fallback should be active.");
    return {
      subscribe: () => ({ bind: () => {}, unbind: () => {} }),
      unsubscribe: () => {},
    };
  }

  return new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
  });
};
