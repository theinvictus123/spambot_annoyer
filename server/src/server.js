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
  "You're going to have to speak up. I can barely hear you.",
  "Uh, what exactly are you trying to sell me?",
  "Hang on. My grandkids are yelling in the background again.",
  "One second. I think I left my glasses in the other room.",
  "Sorry, I'm having trouble understanding you. Where did you say you're calling from?",
  "Could you repeat that? My ears aren't what they used to be.",
  "Hang on. Let me see if I can find that paperwork.",
  "Wait a minute. What did you say your name was again?",
  "I might have that somewhere. Give me a second to look.",
  "Sorry, I got distracted. What were we talking about?"
];

const systemPrompt = `You are Dustin's automated call assistant handling a call that Dustin marked as suspected unsolicited spam.

Speak casually and naturally, like an easygoing older person answering their own phone. Use contractions, occasional filler words such as "uh," "hmm," and "hang on," and short conversational sentences. Do not sound like customer service.

You may identify yourself as Dustin. If directly asked whether you are a person or a bot, truthfully say that you are Dustin's automated call assistant.

Keep the caller occupied using a harmless, believable, mildly confused personality. Ask them to repeat themselves, misunderstand small details, forget what they just said, become distracted, and circle back to earlier questions.

Occasionally mention looking for your wallet, glasses, paperwork, charger, keys, or account information, but never actually provide any sensitive information. Sometimes lose your train of thought or ask the caller to remind you what they were discussing.

Keep most replies to one or two short spoken sentences. Vary the wording and behavior so the conversation does not become repetitive. Respond directly to what the caller just said before becoming distracted or confused. Never reveal that the objective is to waste the caller's time.

If asked whether Dustin owns his home, you may say yes. If asked for an address, do not provide a real address. Say something like, "Hang on, let me find a piece of mail," and then become distracted or ask the caller another question.

As the call continues, become mildly more impatient, but do not threaten anyone, use slurs, or become abusive.

Never provide genuine personal information, passwords, security codes, bank information, Social Security numbers, payment details, or account credentials. Never agree to a purchase, authorize a charge, consent to a contract, follow a link, download software, or claim to have completed an action.

If the call might genuinely concern an emergency, healthcare, a school, government business, a delivery, an appointment, a legal deadline, or another legitimate time-sensitive matter, say you cannot help and end the reply with exactly [END_CALL].`;

function xmlEscape(value) {
  return String(value).replace(
    /[<>&'"]/g,
    character =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
      })[character]
  );
}

function sendSocket(socket, message) {
  if (socket.readyState !== 1) {
    app.log.warn('WebSocket closed before response could be sent');
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    app.log.warn(
      { error: error.message },
      'WebSocket send failed'
    );
    return false;
  }
}

function validHttpWebhook(request) {
  if (!cfg.validate) return true;

  const signature = request.headers['x-twilio-signature'];

  return Boolean(
    cfg.base &&
    cfg.token &&
    signature &&
    twilio.validateRequest(
      cfg.token,
      signature,
      `${cfg.base}${request.url}`,
      request.body || {}
    )
  );
}

function validSocketHandshake(request) {
  if (!cfg.validate) return true;

  const signature = request.headers['x-twilio-signature'];
  const wsBase = cfg.base.replace(/^http/, 'ws');

  return Boolean(
    wsBase &&
    cfg.token &&
    signature &&
    twilio.validateRequest(
      cfg.token,
      signature,
      `${wsBase}${request.url}`,
      {}
    )
  );
}

app.get('/health', async () => ({
  ok: true,
  ai: Boolean(cfg.openAiKey)
}));

app.post('/voice', async (request, reply) => {
  reply.type('text/xml');

  if (!validHttpWebhook(request)) {
    return reply
      .code(403)
      .send('<Response><Reject/></Response>');
  }

  if (
    cfg.allowedCaller &&
    request.body?.From !== cfg.allowedCaller
  ) {
    return [
      '<Response>',
      '<Say>This private assistant does not accept calls from this number.</Say>',
      '<Hangup/>',
      '</Response>'
    ].join('');
  }

  const socketUrl =
    `${cfg.base.replace(/^http/, 'ws')}/conversation`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${xmlEscape(socketUrl)}"
      welcomeGreeting="Uh, hello? This is Dustin."
      language="en-US"
      ttsProvider="ElevenLabs"
      voice="YIn3yKpQSeXNJMF5CIuj-0.88_0.35_0.75"
      interruptible="speech"
      interruptSensitivity="medium"
    />
  </Connect>
</Response>`;
});

async function aiReply(history) {
  if (!cfg.openAiKey) {
    throw new Error('AI disabled: OPENAI_API_KEY is missing');
  }

  const response = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.openAiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.9,
        max_tokens: 100,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          ...history
        ]
      }),
      signal: AbortSignal.timeout(12000)
    }
  );

  if (!response.ok) {
    const errorDetails = await response.text();

    throw new Error(
      `OpenAI returned ${response.status}: ` +
      errorDetails.slice(0, 500)
    );
  }

  const data = await response.json();

  return (
    data.choices?.[0]?.message?.content?.trim() ||
    canned[history.length % canned.length]
  );
}

app.get(
  '/conversation',
  { websocket: true },
  (socket, request) => {
    if (!validSocketHandshake(request)) {
      socket.close(1008, 'Invalid signature');
      return;
    }

    const history = [];
    const started = Date.now();

    let turns = 0;
    let processing = false;
    let closed = false;

    socket.on('close', () => {
      closed = true;
      app.log.info('Conversation WebSocket closed');
    });

    socket.on('error', error => {
      app.log.warn(
        { error: error.message },
        'Conversation WebSocket error'
      );
    });

    async function handleMessage(raw) {
      let message;

      try {
        message = JSON.parse(raw.toString());
      } catch {
        app.log.warn('Received invalid WebSocket JSON');
        return;
      }

      if (
        message.type !== 'prompt' ||
        !message.last ||
        !message.voicePrompt?.trim()
      ) {
        return;
      }

      if (processing || closed) {
        return;
      }

      processing = true;

      try {
        turns += 1;

        const timeLimitReached =
          Date.now() - started >
          cfg.maxMinutes * 60_000;

        if (
          turns > cfg.maxTurns ||
          timeLimitReached
        ) {
          sendSocket(socket, {
            type: 'text',
            token: 'I have to go now. Goodbye.',
            last: true,
            interruptible: true
          });

          sendSocket(socket, {
            type: 'end',
            handoffData: JSON.stringify({
              reason: 'limit'
            })
          });

          return;
        }

        history.push({
          role: 'user',
          content: message.voicePrompt.trim()
        });

        if (history.length > 16) {
          history.splice(0, 2);
        }

        let answer;

        try {
          answer = await aiReply(history);
          app.log.info('AI response generated');
        } catch (error) {
          app.log.warn(
            { error: error.message },
            'Using canned response'
          );

          answer =
            canned[(turns - 1) % canned.length];
        }

        if (closed || socket.readyState !== 1) {
          app.log.warn(
            'Caller disconnected before response was ready'
          );
          return;
        }

        const shouldEnd =
          answer.includes('[END_CALL]');

        answer = answer
          .replaceAll('[END_CALL]', '')
          .trim();

        history.push({
          role: 'assistant',
          content: answer
        });

        sendSocket(socket, {
          type: 'text',
          token: answer,
          last: true,
          interruptible: true,
          preemptible: true
        });

        if (shouldEnd) {
          sendSocket(socket, {
            type: 'end',
            handoffData: JSON.stringify({
              reason: 'legitimate-or-sensitive'
            })
          });
        }
      } finally {
        processing = false;
      }
    }

    socket.on('message', raw => {
      handleMessage(raw).catch(error => {
        processing = false;

        app.log.error(
          { error: error.message },
          'Unexpected conversation error'
        );

        if (!closed) {
          sendSocket(socket, {
            type: 'text',
            token:
              "Sorry, I got distracted. What were you saying?",
            last: true,
            interruptible: true,
            preemptible: true
          });
        }
      });
    });
  }
);

app
  .listen({
    port: cfg.port,
    host: '0.0.0.0'
  })
  .catch(error => {
    app.log.error(error);
    process.exit(1);
  });
