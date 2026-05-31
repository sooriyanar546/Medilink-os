/**
 * MediLink (HosOpOS) Patient Webhook Simulator CLI
 * 
 * This premium developer CLI utility simulates real-world Twilio/WhatsApp incoming payloads, 
 * sending them to the outpatient communication hub webhook endpoint.
 * 
 * Usage:
 *   node simulate_patient.js
 */

const http = require('http');
const readline = require('readline');

const BASE_URL = 'http://localhost:3000';
const WEBHOOK_PATH = '/api/messages/webhook';
const PATIENT_PHONE = '+15550193829'; // Michael Chen's phone

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const scenarios = [
  {
    num: '1',
    title: 'Adherence Logged ("TAKEN")',
    desc: 'Simulate texting "Taken". Checks the morning dosage box dynamically in the Patient Mode dashboard and logs a HIPAA audit entry.',
    body: 'Taken ✅'
  },
  {
    num: '2',
    title: 'Database Snooze ("SNOOZE")',
    desc: 'Simulate texting "Snooze 30 min". Sets a real PostgreSQL-backed reminder. The scheduler will expire this snooze in exactly 20 seconds, triggering a live dashboard alarm sound.',
    body: 'snooze'
  },
  {
    num: '3',
    title: 'Diet Request ("DIET")',
    desc: 'Ask MediBuddy about DASH diet guidelines mapped to active cardiorespiratory hypertension profiles.',
    body: 'What is my cardiometabolic diet advice?'
  },
  {
    num: '4',
    title: 'Symptom Relief / Side Effects ("DIZZY")',
    desc: 'Inquire about dizziness starting Amlodipine. Returns clinical self-care instructions.',
    body: 'I feel dizzy after Amlodipine'
  },
  {
    num: '5',
    title: 'Custom Conversational Input',
    desc: 'Type a custom question to MediBuddy to observe the AI conversational guide fallbacks.',
    body: null
  }
];

function printMenu() {
  console.clear();
  console.log('\x1b[36m====================================================================\x1b[0m');
  console.log('\x1b[36m             MEDILINK WEBHOOK COMMUNICATIONS SIMULATOR              \x1b[0m');
  console.log('\x1b[36m====================================================================\x1b[0m');
  console.log('Simulate WhatsApp messages coming from Michael Chen (+15550193829).\n');
  
  scenarios.forEach(s => {
    console.log(`  \x1b[33m[${s.num}]\x1b[0m \x1b[1m${s.title}\x1b[0m`);
    console.log(`      ${s.desc}`);
    if (s.body) console.log(`      \x1b[90mPayload Body: "${s.body}"\x1b[0m`);
    console.log('');
  });
  
  console.log('  \x1b[31m[Q] Quit Simulator\x1b[0m\n');
  promptSelection();
}

function promptSelection() {
  rl.question('Select a scenario [1-5 or Q]: ', (answer) => {
    const choice = answer.trim().toLowerCase();
    
    if (choice === 'q') {
      console.log('\nExiting simulator. Have a great day!');
      rl.close();
      process.exit(0);
    }
    
    const scenario = scenarios.find(s => s.num === choice);
    
    if (!scenario) {
      console.log('\n\x1b[31mInvalid selection. Please try again.\x1b[0m');
      setTimeout(printMenu, 1500);
      return;
    }
    
    if (choice === '5') {
      rl.question('\nEnter your custom WhatsApp message: ', (customMsg) => {
        sendWebhookPayload(customMsg.trim());
      });
    } else {
      sendWebhookPayload(scenario.body);
    }
  });
}

function sendWebhookPayload(messageText) {
  if (!messageText) {
    console.log('\x1b[31mMessage content cannot be empty.\x1b[0m');
    setTimeout(printMenu, 1500);
    return;
  }

  console.log(`\n\x1b[90m[Network] Formatting urlencoded Twilio payload...\x1b[0m`);
  
  // Twilio standard incoming message payload shape
  const postData = new URLSearchParams({
    MessageSid: 'SM' + Math.floor(100000 + Math.random() * 900000) + 'ab82910',
    From: `whatsapp:${PATIENT_PHONE}`,
    To: 'whatsapp:+14155238886', // Twilio Sandbox Number
    Body: messageText,
    NumMedia: '0',
    AccountSid: 'AC' + Math.floor(100000 + Math.random() * 900000),
    ApiVersion: '2010-04-01'
  }).toString();

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: WEBHOOK_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log(`\x1b[90m[Network] Sending POST request to http://localhost:3000${WEBHOOK_PATH}...\x1b[0m`);
  
  const req = http.request(options, (res) => {
    let responseBody = '';
    
    res.on('data', (chunk) => {
      responseBody += chunk;
    });
    
    res.on('end', () => {
      console.log('\n\x1b[32m========================= WEBHOOK RESPONSE =========================\x1b[0m');
      console.log(`Status Code: \x1b[33m${res.statusCode}\x1b[0m`);
      console.log(`Content-Type: \x1b[33m${res.headers['content-type']}\x1b[0m`);
      console.log(`XML Body:\n`);
      console.log(`\x1b[35m${responseBody}\x1b[0m`);
      console.log('\x1b[32m====================================================================\x1b[0m');
      
      console.log('\n\x1b[1m⚡ Verification Actions to Observe Live:\x1b[0m');
      if (messageText.toLowerCase().includes('taken')) {
        console.log('   - The "Morning" dosage checkbox in the Live Tracker glows green and checks.');
        console.log('   - An audit trail transaction is logged under Admin Mode -> HIPAA Trail.');
      } else if (messageText.toLowerCase().includes('snooze')) {
        console.log('   - A real PostgreSQL reminder has been inserted with status "PENDING".');
        console.log('   - Wait exactly 20 seconds for the scheduler worker to trigger the alarms.');
        console.log('   - Once triggered, the dashboard will display a red alert and play an audible chime!');
      } else {
        console.log('   - The new message reply dynamically populates under the portal\'s Chat ledger.');
      }
      
      rl.question('\nPress Enter to return to menu...', () => {
        printMenu();
      });
    });
  });

  req.on('error', (e) => {
    console.error(`\n\x1b[31m❌ Connection Error: Ensure Next.js is actively running on port 3000! (${e.message})\x1b[0m`);
    rl.question('\nPress Enter to retry...', () => {
      printMenu();
    });
  });

  // Send the payload data
  req.write(postData);
  req.end();
}

// Kick off the menu
printMenu();
