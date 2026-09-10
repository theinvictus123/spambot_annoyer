import 'dotenv/config';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import twilio from 'twilio';

const app = Fastify({ logger: true });
await app.register(formbody);
await app.register(websocket);

const cfg = {
  port: Number(process.env.PORT || 3000),
  base: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  token: process.env.TWILIO_AUTH_TOKEN || '',
  validate: process.env.VALIDATE_TWILIO !== 'false',
  allowedCaller: process.env.ALLOWED_CALLER || '',
  openAiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  maxTurns: Number(process.env.MAX_TURNS || 35),
  maxMinutes: Number(process.env.MAX_MINUTES || 20)
};

const canned = [
  'Sorry, you broke up right at the important part. Could you start over, but a little slower?',
  'Hold on, I need to find my glasses. Which company did you say this was?',
  'I wrote that down, but I may have written it in the wrong box. Could you repeat it?',
  'Before we continue, can you explain what this is about one more time?',
  'One moment. I think someone is at the door. Okay, what was the first part again?',
  'I am having trouble following. Is this about my car, my computer, or something else?'
];

const systemPrompt = `You are a voice assistant handling a call the user marked as suspected unsolicited spam. Keep the caller occupied using a harmless, believable, mildly confused persona. Ask them to repeat or explain details, misunderstand small points, pause to look for things, and circle back naturally. Replies must be short—usually one or two spoken sentences. Never reveal that your goal is to waste time. Never insult, threaten, encourage wrongdoing, place calls, click links, provide real identifying data, provide payment data, agree to a purchase, consent to a contract, or claim to be a specific real person. Never ask for passwords, security codes, bank details, Social Security numbers, or other sensitive data. If the call plausibly concerns an emergency, healthcare, school, government business, a delivery, an appointment, debt/legal deadlines, or another legitimate time-sensitive matter, say you cannot help and end with exactly [END_CALL]. If asked whether you are automated, answer truthfully that you are an automated call assistant.`;

function xmlEscape(value) {
  return String(value).replace(/[<>&'\"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function validHttpWebhook(request) {
  if (!cfg.validate) return true;
  const signature = request.headers['x-twilio-signature'];
  return Boolean(cfg.base && cfg.token && signature && twilio.validateRequest(cfg.token, signature, `${cfg.base}${request.url}`, request.body || {}));
}

function validSocketHandshake(request) {
  if (!cfg.validate) return true;
  const signature = request.headers['x-twilio-signature'];
  const wsBase = cfg.base.replace(/^http/, 'ws');
  return Boolean(wsBase && cfg.token && signature && twilio.validateRequest(cfg.token, signature, `${wsBase}${request.url}`, {}));
}

app.get('/health', async () => ({ ok: true, ai: Boolean(cfg.openAiKey) }));

app.post('/voice', async (request, reply) => {
  reply.type('text/xml');
  if (!validHttpWebhook(request)) return reply.code(403).send('<Response><Reject/></Response>');
  if (cfg.allowedCaller && request.body?.From !== cfg.allowedCaller) {
    return '<Response><Say>This private assistant does not accept calls from this number.</Say><Hangup/></Response>';
  }
  const socketUrl = `${cfg.base.replace(/^http/, 'ws')}/conversation`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${xmlEscape(socketUrl)}" welcomeGreeting="Hello? Who is calling, please?" language="en-US" interruptible="speech" /></Connect></Response>`;
});

async function aiReply(history) {
  if (!cfg.openAiKey) throw new Error('AI disabled');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.openAiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.9,
      max_tokens: 100,
      messages: [{ role: 'system', content: systemPrompt }, ...history]
    }),
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || canned[history.length % canned.length];
}

app.get('/conversation', { websocket: true }, (socket, request) => {
  if (!validSocketHandshake(request)) return socket.close(1008, 'Invalid signature');
  const history = [];
  let turns = 0;
  const started = Date.now();

  socket.on('message', async raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== 'prompt' || !message.last || !message.voicePrompt?.trim()) return;

    turns += 1;
    if (turns > cfg.maxTurns || Date.now() - started > cfg.maxMinutes * 60_000) {
      socket.send(JSON.stringify({ type: 'text', token: 'I have to go now. Goodbye.', last: true, interruptible: true }));
      socket.send(JSON.stringify({ type: 'end', handoffData: JSON.stringify({ reason: 'limit' }) }));
      return;
    }

    history.push({ role: 'user', content: message.voicePrompt.trim() });
    if (history.length > 16) history.splice(0, 2);
    let answer;
    try { answer = await aiReply(history); }
    catch (error) {
      app.log.warn({ error: error.message }, 'Using canned response');
      answer = canned[(turns - 1) % canned.length];
    }
    const shouldEnd = answer.includes('[END_CALL]');
    answer = answer.replace('[END_CALL]', '').trim();
    history.push({ role: 'assistant', content: answer });
    socket.send(JSON.stringify({ type: 'text', token: answer, last: true, interruptible: true, preemptible: true }));
    if (shouldEnd) socket.send(JSON.stringify({ type: 'end', handoffData: JSON.stringify({ reason: 'legitimate-or-sensitive' }) }));
  });
});

app.listen({ port: cfg.port, host: '0.0.0.0' }).catch(error => {
  app.log.error(error);
  process.exit(1);
});

