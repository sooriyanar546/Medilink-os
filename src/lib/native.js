// Universal Native Mobile Bridge (iOS / Android / Browser)
// Fully guarded against Server-Side Rendering (SSR) crashes

let Haptics = null;
let Dialog = null;
let LocalNotifications = null;

// Only initialize plugins on the client-side
if (typeof window !== 'undefined') {
  try {
    // Dynamic runtime check: are we running inside a Capacitor Webview?
    const isCapacitor = window.Capacitor !== undefined;
    
    if (isCapacitor) {
      // Lazy load plugins so they do not error on SSR or standard browser builds
      const { Haptics: CapHaptics } = require('@capacitor/haptics');
      const { Dialog: CapDialog } = require('@capacitor/dialog');
      const { LocalNotifications: CapNotifications } = require('@capacitor/local-notifications');
      
      Haptics = CapHaptics;
      Dialog = CapDialog;
      LocalNotifications = CapNotifications;
      console.log('📱 Capacitor Native Mobile Shell Detected. Hardware bridge activated.');
    } else {
      console.log('💻 Desktop Web Browser Mode Active. Standard fallbacks active.');
    }
  } catch (err) {
    console.warn('Capacitor plugins not available. Browser fallbacks loaded.', err);
  }
}

/**
 * Fires a tactile haptic vibration feedback on the device.
 * @param {string} style - 'light', 'medium', 'heavy', or 'success', 'warning', 'error'
 */
export async function triggerNativeHaptic(style = 'light') {
  if (typeof window === 'undefined') return;
  
  if (Haptics) {
    try {
      if (style === 'light') {
        await Haptics.impact({ style: 'LIGHT' });
      } else if (style === 'medium') {
        await Haptics.impact({ style: 'MEDIUM' });
      } else if (style === 'heavy') {
        await Haptics.impact({ style: 'HEAVY' });
      } else if (style === 'success') {
        await Haptics.notification({ type: 'SUCCESS' });
      } else if (style === 'warning') {
        await Haptics.notification({ type: 'WARNING' });
      } else if (style === 'error') {
        await Haptics.notification({ type: 'ERROR' });
      }
    } catch (e) {
      console.warn('Failed to trigger native haptic:', e);
    }
  } else {
    // Desktop Web browser fallback
    try {
      if (navigator.vibrate) {
        if (style === 'light') navigator.vibrate(15);
        else if (style === 'medium') navigator.vibrate(40);
        else if (style === 'heavy') navigator.vibrate(100);
        else if (style === 'error') navigator.vibrate([100, 50, 100]);
      }
    } catch (e) {}
  }
}

/**
 * Shows a native system alert dialog or confirmation sheet.
 */
export async function triggerNativeAlert(title, message) {
  if (typeof window === 'undefined') return;

  if (Dialog) {
    try {
      await Dialog.alert({ title, message });
    } catch (e) {
      console.warn('Native dialog failed, falling back to alert', e);
      window.alert(`${title}: ${message}`);
    }
  } else {
    window.alert(`${title}: ${message}`);
  }
}

/**
 * Schedules a local device push notification alert.
 */
export async function scheduleLocalNotification(title, body, delaySeconds = 5) {
  if (typeof window === 'undefined') return;

  if (LocalNotifications) {
    try {
      // Request notification permissions if not already granted
      const permRes = await LocalNotifications.requestPermissions();
      if (permRes.display === 'granted') {
        await LocalNotifications.schedule({
          notifications: [
            {
              title,
              body,
              id: Math.floor(Math.random() * 1000000),
              schedule: { at: new Date(Date.now() + delaySeconds * 1000) },
              sound: null,
              attachments: null,
              actionTypeId: "",
              extra: null
            }
          ]
        });
        console.log(`✅ Local notification scheduled in ${delaySeconds}s.`);
      }
    } catch (e) {
      console.warn('Failed to schedule local notification:', e);
    }
  } else {
    console.log(`[Browser Notification Trigger] ${title} - ${body}`);
  }
}
